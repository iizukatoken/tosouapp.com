'use strict';

const repo = require('./attendance.repository');
const db = require('../../core/database/mysql');
const noticesRepo = require('../notices/notices.repository');
const userRepo = require('../users/user.repository');
const auditRepo = require('../audit/audit.repository');
const log = require('../../core/logger');
const leaveRepo = require('../leave/leave.repository');
const { reportSwallowed } = require('../../core/errorReporter');
const { nowJSTMySQL } = require('../../utils/dateTime');
const { timesheetMaxDays } = require('../../config/env');
const {
  resolveTargetUserId,
  getMonthStatusValue,
  assertMonthWritable,
} = require('./attendance.utils');

// Liệt kê các (year, month) mà khoảng ngày [startDate, endDate] đi qua, để
// kiểm tra từng tháng có đang bị khóa (attendance_month_status='approved')
// không trước khi cho tạo/xóa phân ca. endDate=null (chưa xác định ngày kết
// thúc) chỉ cần kiểm tra tới tháng hiện tại — tháng tương lai chưa thể
// 'approved' nên không có gì để khóa.
function enumerateMonths(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const end = endDate ? new Date(`${endDate}T00:00:00Z`) : nowJST;
  const months = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

// ─── Định nghĩa ca làm việc ──────────────────────────────────────────────────

exports.listShiftDefinitions = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const tid = req.tenantId || null;
    const rows = await repo.listShiftDefinitions({ tenantId: tid });
    res.status(200).json(rows || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.postShiftDefinition = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const start_time = String(b.start_time || '').trim();
    const end_time = String(b.end_time || '').trim();
    const break_minutes = b.break_minutes == null ? 60 : parseInt(String(b.break_minutes), 10);
    const working_days = b.working_days == null ? null : String(b.working_days);
    if (!name || !/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
      return res.status(400).json({ message: 'Invalid name/start_time/end_time' });
    }
    if (start_time === end_time) {
      return res.status(400).json({ message: 'start_time and end_time must differ' });
    }
    const tid = req.tenantId || null;

    // upsertShiftDefinition ghép theo `name` — nếu đã tồn tại và giờ/nghỉ
    // giải lao thay đổi, đây là một EDIT có thể làm sai lệch công/lương đã
    // tính cho những tháng đã chốt (attendance_month_status='approved'),
    // vì giờ ca được tính "live" mỗi lần xem chứ không lưu cố định theo
    // từng bản ghi chấm công. Chặn lại, yêu cầu mở khóa tháng trước.
    const existing = await repo.getShiftByName(name, { tenantId: tid }).catch(() => null);
    const isTimingChange = existing && (
      existing.start_time !== start_time ||
      existing.end_time !== end_time ||
      Number(existing.break_minutes) !== Number(break_minutes || 0)
    );
    if (isTimingChange) {
      const conflicts = await repo.findLockedMonthConflictsForShift(existing.id, { tenantId: tid });
      if (conflicts.length) {
        return res.status(423).json({
          message: 'このシフトは確定済みの月に使用されています。編集する前に対象の月を解除してください。',
          lockedMonths: conflicts.map(c => ({ userId: c.userId, username: c.username, email: c.email, year: c.year, month: c.month }))
        });
      }
    }

    const row = await repo.upsertShiftDefinition({ name, start_time, end_time, break_minutes, working_days, tenantId: tid });
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: existing ? 'shift_definition_update' : 'shift_definition_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: existing ? JSON.stringify(existing) : null, afterData: JSON.stringify(row) });
    } catch (e) { /* silently ignored */ }
    res.status(200).json(row);
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ message: err.message });
  }
};

exports.deleteShiftDefinition = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const id = parseInt(String(req.params?.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const tid = req.tenantId || null;
    const r = await repo.deleteShiftDefinitionById(id, { tenantId: tid });
    if (r?.notFound) return res.status(404).json({ message: 'Not found' });
    if (r?.inUse) return res.status(409).json({ message: 'Shift is in use', assignedCount: r.assignedCount ?? null });
    if (!r || !r.deleted) return res.status(500).json({ message: 'Delete failed' });
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'shift_definition_delete', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id }), afterData: null });
    } catch (e) { /* silently ignored */ }
    res.status(200).json({ ok: true, deleted: r.deleted });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Phân ca cho nhân viên ───────────────────────────────────────────────────

exports.getShiftAssignments = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const from = String(req.query?.from || '1900-01-01').slice(0, 10);
    const to = String(req.query?.to || '2999-12-31').slice(0, 10);
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const tid = req.tenantId || null;
    const assigns = await repo.listShiftAssignmentsBetween(userId, from, to, { tenantId: tid }).catch(() => []);
    const shiftDefs = await repo.listShiftDefinitions({ tenantId: tid }).catch(() => []);
    const shiftById = new Map((shiftDefs || []).map(s => [String(s.id), s]));
    const shiftByName = new Map((shiftDefs || []).map(s => [String(s.name), s]));
    const resolveDefForAssign = (a) => {
      let def = shiftById.get(a?.shiftId != null ? String(a.shiftId) : '') || null;
      if (!def) def = shiftByName.get(a?.shift != null ? String(a.shift) : '') || null;
      return def;
    };
    const items = (assigns || []).map(a => {
      const def = resolveDefForAssign(a);
      return { id: a?.id || null, start_date: String(a?.start_date || '').slice(0, 10) || null, end_date: a?.end_date ? String(a.end_date).slice(0, 10) : null, shift: def ? { id: def.id, name: def.name, start_time: def.start_time, end_time: def.end_time, break_minutes: def.break_minutes, standard_minutes: def.standard_minutes } : null };
    });
    res.status(200).json({ userId, from, to, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.postShiftAssignment = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const b = req.body || {};
    const shiftId = parseInt(String(b.shiftId || ''), 10);
    const startDate = String(b.startDate || '').slice(0, 10);
    const endDate = b.endDate == null || b.endDate === '' ? null : String(b.endDate).slice(0, 10);
    if (!userId || !shiftId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ message: 'Missing userId/shiftId/startDate' });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ message: 'Invalid endDate' });
    }
    if (endDate && endDate < startDate) {
      return res.status(400).json({ message: 'endDate must be on or after startDate' });
    }
    const tid = req.tenantId || null;

    // Không cho gán ca chồng lên khoảng ngày đã có ca khác của cùng nhân viên.
    const overlaps = await repo.findOverlappingAssignments(userId, startDate, endDate, { tenantId: tid });
    if (overlaps.length) {
      return res.status(409).json({
        message: 'この従業員は既にこの期間にシフトが割り当てられています',
        conflicts: overlaps.map(o => ({ id: o.id, shiftId: o.shiftId, start_date: o.start_date, end_date: o.end_date }))
      });
    }

    // Không cho tạo/đổi phân ca chạm vào tháng đã chốt (attendance_month_status='approved').
    for (const { year, month } of enumerateMonths(startDate, endDate)) {
      await assertMonthWritable(req, userId, year, month);
    }

    await repo.assignShiftToUser(userId, shiftId, startDate, endDate, { tenantId: tid });
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'shift_assignment_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ userId, shiftId, startDate, endDate }) });
    } catch (e) { /* silently ignored */ }
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ message: err.message });
  }
};

// Gán 1 ca cho nhiều nhân viên cùng lúc. Áp dụng đúng các kiểm tra như gán
// từng người (trùng ca, tháng đã chốt) — một người bị lỗi không chặn các
// người còn lại, kết quả trả về theo từng userId để biết ai thành công/lỗi.
exports.postShiftAssignmentBulk = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const b = req.body || {};
    const userIds = Array.isArray(b.userIds) ? b.userIds.map(v => parseInt(String(v), 10)).filter(Boolean) : [];
    const shiftId = parseInt(String(b.shiftId || ''), 10);
    const startDate = String(b.startDate || '').slice(0, 10);
    const endDate = b.endDate == null || b.endDate === '' ? null : String(b.endDate).slice(0, 10);
    if (!userIds.length || !shiftId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ message: 'Missing userIds/shiftId/startDate' });
    }
    if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate)) {
      return res.status(400).json({ message: 'Invalid endDate' });
    }
    if (userIds.length > 200) {
      return res.status(400).json({ message: 'Too many userIds (max 200)' });
    }
    const tid = req.tenantId || null;
    const months = enumerateMonths(startDate, endDate);
    const results = [];

    for (const userId of userIds) {
      try {
        // Luôn xác minh user thuộc đúng tenant, kể cả với admin — tránh
        // gán nhầm/gán vào tài khoản của công ty (tenant) khác nếu userId
        // bị đoán trúng. Với manager, giới hạn thêm chỉ nhân viên (employee).
        const target = await userRepo.getUserById(userId, tid);
        if (!target) {
          throw Object.assign(new Error('User not found'), { status: 404 });
        }
        if (role === 'manager' && String(target.role || '').toLowerCase() !== 'employee') {
          throw Object.assign(new Error('Forbidden'), { status: 403 });
        }
        const overlaps = await repo.findOverlappingAssignments(userId, startDate, endDate, { tenantId: tid });
        if (overlaps.length) {
          throw Object.assign(new Error('Overlapping assignment'), { status: 409 });
        }
        for (const { year, month } of months) {
          await assertMonthWritable(req, userId, year, month);
        }
        await repo.assignShiftToUser(userId, shiftId, startDate, endDate, { tenantId: tid });
        results.push({ userId, ok: true });
      } catch (e) {
        results.push({ userId, ok: false, message: e.message, status: e.status || 500 });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'shift_assignment_bulk_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ shiftId, startDate, endDate, userIds, okCount }) });
    } catch (e) { /* silently ignored */ }

    res.status(200).json({ ok: true, succeeded: okCount, failed: results.length - okCount, results });
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ message: err.message });
  }
};

exports.deleteShiftAssignment = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const id = parseInt(String(req.params.id), 10);
    if (!userId || !id) return res.status(400).json({ message: 'Missing userId/id' });
    const tid = req.tenantId || null;

    const existing = await repo.getAssignmentById(id, userId, { tenantId: tid });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    for (const { year, month } of enumerateMonths(String(existing.start_date).slice(0, 10), existing.end_date ? String(existing.end_date).slice(0, 10) : null)) {
      await assertMonthWritable(req, userId, year, month);
    }

    const r = await repo.deleteShiftAssignment(id, userId, { tenantId: tid });
    if (!r?.ok) return res.status(404).json({ message: 'Not found' });
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'shift_assignment_delete', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(existing), afterData: null });
    } catch (e) { /* silently ignored */ }
    res.status(200).json(r);
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ message: err.message });
  }
};

// ─── Lưu hàng loạt / duyệt / bảng ca ─────────────────────────────────────────

exports.postShiftsBulk = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const tid = req.tenantId || null;
    const { month, shifts } = req.body || {};
    if (!month || !Array.isArray(shifts)) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const shift of shifts) {
        if (!shift.date) continue;
        await conn.query(`
          INSERT INTO shift_requests (userId, date, status, leaveType, reason, detail, tenant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status), leaveType = VALUES(leaveType), reason = VALUES(reason), detail = VALUES(detail)
        `, [userId, shift.date, shift.status || 'OFF', shift.leaveType || null, shift.reason || null, shift.detail || null, tid]);
      }
      await conn.query(`
        INSERT INTO shift_month_status (userId, month, status, tenant_id) VALUES (?, ?, 'PENDING', ?)
        ON DUPLICATE KEY UPDATE status = 'PENDING'
      `, [userId, month, tid]);
      await conn.commit();
      res.status(200).json({ success: true, message: 'Shifts saved successfully', data: { submission_status: 'PENDING' } });
      try {
        const u = await userRepo.getUserById(userId).catch(() => null);
        const userName = u ? (u.username || u.email || '従業員') : '従業員';
        await noticesRepo.createAdminNotification({ kind: 'shift_submit', title: 'シフト提出', message: `${userName} さんが${month}のシフトを提出しました`, linkUrl: '/admin/attendance/shifts-approvals', payload: { source: 'shift', userId, month }, createdBy: userId, audience: 'admin_manager' });
      } catch (e) { /* bỏ qua nếu lỗi */ }
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[postShiftsBulk]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getShiftApprovals = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { month } = req.query || {};
    if (!month) return res.status(400).json({ message: 'Missing month' });
    const tid = req.tenantId || null;
    const where = ['s.month = ?', 'u.role NOT IN (?)', 'u.employment_status = ?'];
    const params = [month, ['admin', 'manager'], 'active'];
    if (tid != null) { where.push('u.tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`
      SELECT s.id, s.userId, s.month, s.status, s.updated_at, u.username, u.email, u.employee_code, u.employment_type, d.name as departmentName
      FROM shift_month_status s
      JOIN users u ON s.userId = u.id
      LEFT JOIN departments d ON u.departmentId = d.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.updated_at DESC
    `, params);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getShiftMatrix = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { month, department, limit, offset } = req.query || {};
    if (!month) return res.status(400).json({ message: 'Missing month' });
    const tid = req.tenantId || null;
    const userBranchId = req.user?.branchId || null;
    const branchFilter = (role === 'manager' && userBranchId) ? userBranchId : null;

    let userQuery = `
      SELECT u.id, u.username, u.email, u.employee_code, u.employment_type, d.name as departmentName, s.status as submission_status, s.updated_at as submission_updated_at
      FROM users u
      LEFT JOIN departments d ON u.departmentId = d.id
      LEFT JOIN shift_month_status s ON u.id = s.userId AND s.month = ?
      WHERE u.role NOT IN ('admin', 'manager') AND u.employment_status = 'active'
    `;
    const userParams = [month];
    if (tid != null) { userQuery += ` AND u.tenant_id = ?`; userParams.push(tid); }
    if (branchFilter) { userQuery += ` AND u.branch_id = ?`; userParams.push(branchFilter); }
    if (department) { userQuery += ` AND d.name = ?`; userParams.push(String(department)); }
    userQuery += ` ORDER BY CASE WHEN d.name = '工事部' THEN 1 ELSE 2 END, d.name, u.employment_type, u.id`;
    if (limit) {
      const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
      const off = Math.max(parseInt(offset, 10) || 0, 0);
      userQuery += ` LIMIT ? OFFSET ?`;
      userParams.push(lim, off);
    }
    const [users] = await db.query(userQuery, userParams);

    let shifts = [];
    if (users.length > 0) {
      const userIds = users.map(u => u.id);
      try {
        const placeholders = userIds.map(() => '?').join(',');
        const [rows1] = await db.query(`SELECT userId, date, status, leaveType, reason, detail FROM shift_requests WHERE userId IN (${placeholders}) AND date LIKE ?`, [...userIds, `${month}-%`]);
        shifts = rows1.map(r => ({ ...r, date: String(r.date).slice(0, 10) }));
      } catch (e1) {
        try {
          const placeholders = userIds.map(() => '?').join(',');
          const [rows2] = await db.query(`SELECT user_id as userId, start_date as date, 'WORKING' as status FROM user_shift_assignments WHERE user_id IN (${placeholders}) AND start_date LIKE ?`, [...userIds, `${month}-%`]);
          shifts = rows2.map(r => ({ ...r, date: String(r.date).slice(0, 10) }));
        } catch (e2) {
          console.warn('Fallback query failed too:', e2.message);
        }
      }
    }

    const matrix = users.map(u => {
      const schedule = {};
      shifts.filter(s => s.userId === u.id).forEach(s => { schedule[s.date] = s; });
      return { id: u.id, username: u.username || u.email, employee_code: u.employee_code, employment_type: u.employment_type, departmentName: u.departmentName, submission_status: u.submission_status, submission_updated_at: u.submission_updated_at || null, schedule };
    });
    res.status(200).json(matrix);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAllEmployeeShifts = async (req, res) => {
  try {
    const { month } = req.query || {};
    if (!month) return res.status(400).json({ message: 'Missing month' });
    const tid = req.tenantId || null;

    let userSql = `
      SELECT u.id, u.username, u.email, u.employee_code, u.employment_type, d.name as departmentName
      FROM users u
      LEFT JOIN departments d ON u.departmentId = d.id
      WHERE u.employment_status = 'active' AND u.role NOT IN ('admin', 'manager')
    `;
    const userParams = [];
    if (tid != null) { userSql += ` AND u.tenant_id = ?`; userParams.push(tid); }
    userSql += ` ORDER BY CASE WHEN d.name = '工事部' THEN 1 ELSE 2 END, u.employee_code ASC, u.id ASC`;
    const [users] = await db.query(userSql, userParams);
    if (!users || users.length === 0) return res.status(200).json([]);

    const userIds = users.map(u => u.id);
    const [shifts] = await db.query(`SELECT userId, date, status, leaveType FROM shift_requests WHERE userId IN (?) AND date LIKE ?`, [userIds, `${month}-%`]);

    const matrix = users.map(u => {
      const schedule = {};
      shifts.filter(s => s.userId === u.id).forEach(s => { schedule[s.date] = s; });
      return { id: u.id, username: u.username || u.email, employee_code: u.employee_code, employment_type: u.employment_type, departmentName: u.departmentName, schedule };
    });
    res.status(200).json(matrix);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.approveShiftMonth = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { userId, month, status } = req.body || {};
    if (!userId || !month || !status) return res.status(400).json({ message: 'Missing fields' });
    const validStatuses = ['APPROVED', 'REJECTED', 'PENDING', 'draft'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const tid = req.tenantId || null;
    // Kiểm tra userId thuộc đúng tenant
    if (tid != null) {
      const [userRows] = await db.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1', [userId, tid]);
      if (!userRows || userRows.length === 0) return res.status(404).json({ message: 'User not found in tenant' });
    }
    // 承認・差戻しは処理者を記録（申請一覧の「処理者」）。未処理に戻すときは消す
    const decided = status === 'APPROVED' || status === 'REJECTED';
    try {
      await db.query(`UPDATE shift_month_status SET status = ?, processed_by = ? WHERE userId = ? AND month = ?`, [status, decided ? (req.user?.id || null) : null, userId, month]);
    } catch (e) {
      // processed_by 列が無い DB（マイグレーション未適用）でも承認自体は通す
      if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054))) throw e;
      await db.query(`UPDATE shift_month_status SET status = ? WHERE userId = ? AND month = ?`, [status, userId, month]);
    }

    // シフト承認 = 有給承認: ngày 有給 trong ca thành đơn 有給 (hiện ở 申請一覧). Chỉ ghi leave_requests,
    // không ghi bảng tháng (xem quy tắc cứng bên dưới). Lỗi ở đây không chặn việc duyệt ca.
    let paidLeaveSync = null;
    try {
      const [leaveRows] = await db.query(
        `SELECT date, leaveType FROM shift_requests WHERE userId = ? AND date LIKE ? AND status = 'LEAVE' AND leaveType IN ('paid', 'paid_half')`,
        [userId, `${month}-%`]
      );
      paidLeaveSync = await leaveRepo.syncShiftPaidLeaves({
        userId, month, shiftStatus: status, tenantId: tid, approverId: req.user?.id || null,
        paidDays: (leaveRows || []).map(r => ({ date: String(r.date).slice(0, 10), type: r.leaveType })),
      });
    } catch (e) {
      reportSwallowed('shift.approve.syncPaidLeave', e);
    }

    // 差戻し: 社員に再提出を促す（以前は承認時しか通知されず、差戻しに気づけなかった）
    if (status === 'REJECTED') {
      try {
        await noticesRepo.createNotice({
          targetUserId: userId,
          targetDate: null,
          targetMonth: month,
          message: `${month.replace('-', '年')}月のシフトが差戻しされました。内容を確認して再提出してください。`,
          createdBy: req.user?.id || null,
          kind: 'shift_rejected',
          title: 'シフト差戻し',
          audience: 'all',
          tenantId: req.tenantId || null,
        });
      } catch (e) {
        log.warn('shift_reject_notice_failed', { userId, month, error_message: e.message });
      }
    }

    // ⚠️ QUY TẮC CỨNG: Hành động APPROVED シフト CHỈ cập nhật trạng thái lịch (shift_month_status / shift_requests)
    //                     Tuyệt đối KHÔNG được tác động gì vào bảng attendance_daily (bảng tháng nhân viên).
    //                     Dữ liệu bảng tháng nhân viên chỉ được sửa trực tiếp tại màn hình bảng tháng (putMonthBulk / putDay).
    if (status === 'APPROVED') {
      try {
        // Lấy danh sách ngày OFF để hiển thị trong thông báo gửi cho nhân viên
        const [shifts] = await db.query(
          `SELECT date, status, leaveType FROM shift_requests WHERE userId = ? AND date LIKE ?`,
          [userId, `${month}-%`]
        );
        const offDates = [];
        for (const s of (shifts || [])) {
          if (s.status === 'OFF') {
            const d = String(s.date).slice(0, 10);
            offDates.push(d);
          }
        }
        // Gửi thông báo cho nhân viên nếu có ngày OFF
        if (offDates.length > 0) {
          const u = await userRepo.getUserById(userId).catch(() => null);
          const userName = u ? (u.username || u.email || '従業員') : '従業員';
          const datesStr = offDates.length <= 3
            ? offDates.map(d => d.slice(5).replace('-', '/')).join(', ')
            : offDates.slice(0, 3).map(d => d.slice(5).replace('-', '/')).join(', ') + ` 他${offDates.length - 3}日`;
          await noticesRepo.createNotice({
            targetUserId: userId,
            targetDate: null,
            targetMonth: month,
            message: `${month.replace('-', '年')}月のシフトが承認されました。休日: ${datesStr}`,
            createdBy: req.user?.id || null,
            kind: 'shift_approved',
            title: 'シフト承認',
            audience: 'all',
            tenantId: req.tenantId || null,
          });
        }
      } catch (e) {
        log.warn('shift_approve_auto_kubun_failed', { userId, month, error_message: e.message });
      }
    }

    res.status(200).json({ success: true, paidLeaveSync });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUserShiftsForMonth = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { userId, month } = req.query || {};
    if (!userId || !month) return res.status(400).json({ message: 'Missing fields' });
    const tid = req.tenantId || null;
    if (tid != null) {
      const [userRows] = await db.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1', [userId, tid]);
      if (!userRows || userRows.length === 0) return res.status(404).json({ message: 'User not found in tenant' });
    }
    const [rows] = await db.query(`SELECT date, status, leaveType, reason, detail FROM shift_requests WHERE userId = ? AND date LIKE ?`, [userId, `${month}-%`]);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyMonthlyShifts = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    const { month } = req.params || {};
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!month) return res.status(400).json({ message: 'Missing month' });
    // Khi xem dữ liệu của người khác thì kiểm tra userId thuộc đúng tenant
    const tid = req.tenantId || null;
    if (tid != null && String(userId) !== String(req.user?.id)) {
      const [userRows] = await db.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1', [userId, tid]);
      if (!userRows || userRows.length === 0) return res.status(404).json({ message: 'User not found in tenant' });
    }

    let submission_status = 'draft';
    try {
      const [statusRows] = await db.query(`SELECT status FROM shift_month_status WHERE userId = ? AND month = ?`, [userId, month]);
      if (statusRows && statusRows.length > 0) submission_status = statusRows[0].status;
    } catch (e) { /* bảng có thể chưa tồn tại */ }

    let schedule = {};
    try {
      const [shiftRows] = await db.query(`SELECT date, status, leaveType, reason, detail FROM shift_requests WHERE userId = ? AND date LIKE ?`, [userId, `${month}-%`]);
      shiftRows.forEach(r => { schedule[String(r.date).slice(0, 10)] = r; });
    } catch (e) { /* bảng có thể chưa tồn tại */ }

    res.status(200).json({ success: true, data: { submission_status, schedule } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
