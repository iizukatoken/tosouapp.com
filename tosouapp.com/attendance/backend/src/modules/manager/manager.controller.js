const attendanceService = require('../attendance/attendance.service');
const userRepo = require('../users/user.repository');
const deptChange = require('../departments/department.change.service');
const salaryService = require('../salary/salary.service');
const refreshRepo = require('../auth/refresh.repository');
const db = require('../../core/database/mysql');
const { pickProfileChangeFields } = require('../employee/profileChange.fields');

function normalizeUserListResult(rows, limit, offset) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const parsedLimit = Number.parseInt(String(limit ?? normalizedRows.length ?? 0), 10);
  const parsedOffset = Number.parseInt(String(offset ?? 0), 10);
  return {
    rows: normalizedRows,
    total: normalizedRows.length,
    limit: Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : normalizedRows.length,
    offset: Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0
  };
}
// Controller quản lý: báo cáo nhóm, quản lý ca làm
exports.groupReport = async (req, res) => {
  try {
    const { userIds, from, to } = req.query;
    if (!userIds || !from || !to) {
      return res.status(400).json({ message: 'Missing userIds/from/to' });
    }
    const ids = String(userIds).split(',').map(s => s.trim()).filter(Boolean);
    const reports = [];
    for (const id of ids) {
      const r = await attendanceService.timesheet(id, from, to);
      reports.push({ userId: id, ...r });
    }
    const total = reports.reduce((acc, r) => {
      acc.regularMinutes += r.total.regularMinutes;
      acc.overtimeMinutes += r.total.overtimeMinutes;
      acc.nightMinutes += r.total.nightMinutes;
      return acc;
    }, { regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0 });
    res.status(200).json({ reports, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.assignShift = async (req, res) => {
  try {
    // Placeholder: yêu cầu tạo bảng user_shift_assignments trước khi dùng
    res.status(501).json({ message: 'Not Implemented: create table user_shift_assignments first' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Liệt kê toàn bộ nhân viên (manager chỉ xem được employee)
exports.listMyDepartment = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = req.query.limit;
    const offset = req.query.offset;
    // RBAC: Manager chỉ được phép thấy employee (role=3)
    const role = 'employee';
    const employmentStatus = req.query.employmentStatus != null ? String(req.query.employmentStatus || '').trim() : null;
    const usePaged = q || limit != null || offset != null || role || employmentStatus;
    if (usePaged) {
      const r = await userRepo.listUsersPaged({ q, role: role, departmentId: null, employmentStatus: employmentStatus, limit, offset, tenantId: req.tenantId || null });
      res.status(200).json(r);
    } else {
      // Always filter by tenantId to prevent cross-tenant data leakage
      let rows = req.tenantId
        ? await userRepo.listUsersByTenant(req.tenantId)
        : [];
      rows = (rows || []).filter(u => String(u.role || '').toLowerCase() === 'employee');
      res.status(200).json(normalizeUserListResult(rows, limit, offset));
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Danh sách phòng ban (cho manager)
exports.listDepartments = async (req, res) => {
  try {
    const rows = await userRepo.getAllDepartments(req.tenantId || null);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Cập nhật thông tin nhân viên (manager quản lý toàn công ty, chỉ với employee)
exports.updateEmployeeInfo = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId) return res.status(400).json({ message: 'Missing id' });
    const target = await userRepo.getUserById(targetId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (String(target.role).toLowerCase() !== 'employee') {
      return res.status(403).json({ message: 'Managers can only update employees' });
    }
    const b = req.body || {};
    // 部署を変えたときは異動履歴も自動で記録する
    await deptChange.saveWithDepartmentChange({
      before: target, toDepartmentId: b.departmentId, effectiveDate: b.departmentEffectiveDate,
      actorId: req.user?.id || null, tenantId: req.tenantId || null,
      save: () => userRepo.updateUser(targetId, {
      username: b.username,
      email: b.email,
      departmentId: b.departmentId ?? target.departmentId,
      employmentType: b.employmentType,
      lang: b.lang,
      region: b.region,
      timezone: b.timezone,
      address: b.address,
      contractType: b.contractType,
      visaNumber: b.visaNumber,
      visaExpiry: b.visaExpiry,
      insuranceNumber: b.insuranceNumber,
      employmentStatus: b.employmentStatus
    })
    });
    res.status(200).json({ id: targetId });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// Xem trước bảng lương cho toàn bộ nhân viên (manager)
exports.salaryPreviewDepartment = async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    if (!month) return res.status(400).json({ message: 'Missing month' });
    // Always filter by tenantId to prevent cross-tenant salary data leakage
    const all = req.tenantId
      ? await userRepo.listUsersByTenant(req.tenantId)
      : [];
    const ids = all.filter(u => String(u.role).toLowerCase() === 'employee').map(u => u.id);
    const { employees } = await salaryService.computePayslips(ids, month, req.tenantId || null);
    res.status(200).json({ month, employees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Xử lý nghỉ việc: chuyển trạng thái và revoke tokens (manager toàn công ty, chỉ employee)
exports.resignEmployee = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId) return res.status(400).json({ message: 'Missing id' });
    const target = await userRepo.getUserById(targetId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (String(target.role).toLowerCase() !== 'employee') {
      return res.status(403).json({ message: 'Managers can only deactivate employees' });
    }
    await userRepo.updateUser(targetId, { employmentStatus: 'inactive' });
    await refreshRepo.deleteUserTokens(targetId);
    res.status(200).json({ id: targetId, status: 'inactive' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// === Phê duyệt yêu cầu cập nhật hồ sơ của nhân viên ===
// Table user_change_requests is created by bootstrap migration 20260714_03
let _profileTableEnsured = false;
async function ensureProfileChangeTable() {
  if (_profileTableEnsured) return;
  _profileTableEnsured = true;
  // Safety fallback — bootstrap should have created this table already
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_change_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      fields_json TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME NULL,
      approved_by BIGINT UNSIGNED NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
exports.listProfileChangePending = async (req, res) => {
  try {
    await ensureProfileChangeTable();
    const tid = req.tenantId || null;
    let sql = `SELECT ucr.* FROM user_change_requests ucr LEFT JOIN users u ON u.id = ucr.user_id WHERE ucr.status='pending'`;
    const params = [];
    if (tid != null) { sql += ` AND u.tenant_id = ?`; params.push(tid); }
    sql += ` ORDER BY ucr.created_at DESC`;
    const [rows] = await db.query(sql, params);
    const cache = new Map();
    const result = [];
    for (const r of rows) {
      if (!cache.has(r.user_id)) cache.set(r.user_id, await userRepo.getUserById(r.user_id));
      const target = cache.get(r.user_id);
      result.push({
        id: r.id,
        userId: r.user_id,
        username: target?.username || '',
        email: target?.email || '',
        departmentId: target?.departmentId || null,
        status: r.status,
        createdAt: r.created_at,
        fields: (() => { try { return JSON.parse(r.fields_json); } catch { return {}; } })()
      });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.getProfileChange = async (req, res) => {
  try {
    await ensureProfileChangeTable();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const tid = req.tenantId || null;
    let sql = `SELECT ucr.* FROM user_change_requests ucr LEFT JOIN users u ON u.id = ucr.user_id WHERE ucr.id = ?`;
    const params = [id];
    if (tid != null) { sql += ` AND u.tenant_id = ?`; params.push(tid); }
    sql += ` LIMIT 1`;
    const [rows] = await db.query(sql, params);
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Not found' });
    const target = await userRepo.getUserById(row.user_id);
    res.status(200).json({
      id: row.id,
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      fields: (() => { try { return JSON.parse(row.fields_json); } catch { return {}; } })(),
      user: { id: target.id, username: target.username, email: target.email, departmentId: target.departmentId }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.approveProfileChange = async (req, res) => {
  try {
    await ensureProfileChangeTable();
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!id || !status) return res.status(400).json({ message: 'Missing id/status' });
    const tid = req.tenantId || null;
    let sql = `SELECT ucr.* FROM user_change_requests ucr LEFT JOIN users u ON u.id = ucr.user_id WHERE ucr.id = ?`;
    const params = [id];
    if (tid != null) { sql += ` AND u.tenant_id = ?`; params.push(tid); }
    sql += ` LIMIT 1`;
    const [rows] = await db.query(sql, params);
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Not found' });
    if (row.status !== 'pending') return res.status(409).json({ message: 'Already processed' });
    if (String(status).toLowerCase() === 'approved') {
      // Không ai được tự duyệt yêu cầu của chính mình.
      if (String(row.user_id) === String(req.user?.id)) {
        return res.status(403).json({ message: '自分の申請は承認できません' });
      }
      let raw = {};
      try { raw = JSON.parse(row.fields_json) || {}; } catch (e) { /* silently ignored */ }
      // Chỉ áp dụng thông tin cá nhân — yêu cầu cũ có thể còn chứa role / lương / phòng ban.
      const fields = pickProfileChangeFields(raw);
      if (!Object.keys(fields).length) {
        return res.status(422).json({ message: '承認できる項目がありません（権限・給与・部署は社員管理画面で変更してください）' });
      }
      await userRepo.updateUser(row.user_id, fields);
      await db.query(`UPDATE user_change_requests SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?`, [req.user.id, id]);
      return res.status(200).json({ id, status: 'approved' });
    } else if (String(status).toLowerCase() === 'rejected') {
      await db.query(`UPDATE user_change_requests SET status='rejected', approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?`, [req.user.id, id]);
      return res.status(200).json({ id, status: 'rejected' });
    }
    return res.status(400).json({ message: 'Invalid status' });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};
