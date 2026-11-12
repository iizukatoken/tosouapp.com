/**
 * @file attendance.day.controller.js
 * @description Xử lý các API chỉnh sửa dữ liệu chấm công theo ngày (segment, daily record).
 *
 * Các API trong file này:
 *   - getDay          → Lấy tất cả segment + lịch sử ra ngoài của 1 ngày
 *   - getDaily        → Lấy bản ghi daily (kubun, break, work type...) của 1 ngày
 *   - putDaily        → Cập nhật kubun, giờ nghỉ, loại làm việc cho 1 ngày
 *   - putDay          → Cập nhật giờ check-in/check-out cho 1 segment cụ thể
 *   - addSegment      → Thêm 1 segment check-in/check-out mới cho ngày
 *   - deleteSegment   → Xóa 1 segment
 *   - submitDay       → Đánh dấu toàn bộ segment ngày là đã submit
 *
 * Kết nối:
 *   attendance.repository.js → Đọc/ghi DB các bản ghi chấm công
 *   attendance.utils.js      → resolveTargetUserId, assertMonthWritable, syncPaidLeaveByKubun
 *   notices.repository.js    → Gửi thông báo admin khi có thay đổi punch
 *   users/user.repository.js → Lấy tên nhân viên để hiển thị thông báo
 */
'use strict';

// ─── Dependencies ─────────────────────────────────────────────────────────────
const repo       = require('./attendance.repository');       // Đọc/ghi DB chấm công
const userRepo   = require('../users/user.repository');      // Lấy thông tin nhân viên
const noticesRepo = require('../notices/notices.repository'); // Gửi thông báo admin
const db         = require('../../core/database/mysql');     // Query trực tiếp (DELETE segment)
const {
  syncPaidLeaveByKubun,  // Đồng bộ phép năm khi kubun thay đổi
  resolveTargetUserId,   // Kiểm tra RBAC: ai được xem/sửa của ai
  isEditableMonth,       // Nhân viên chỉ sửa được tháng hiện tại
  getMonthStatusValue,   // Lấy trạng thái tháng (draft/submitted/approved)
  assertMonthWritable,   // Chặn sửa nếu tháng đã approved/locked
} = require('./attendance.utils');
const { isEmployee, changesSavedTime, hasSavedTime, LOCK_MESSAGE } = require('./attendance.punchLock');

// ─── Helper nội bộ: Gửi thông báo admin khi có punch mới ─────────────────────
async function notifyPunch(userId, timeStr, type) {
  try {
    const u = await userRepo.getUserById(userId);
    const name = u ? (u.username || u.email || '従業員') : '従業員';
    const msg = type === 'in'
      ? `${name}さんが出勤打刻をしました（${timeStr}）`
      : `${name}さんが退勤打刻をしました（${timeStr}）`;
    await noticesRepo.createAdminNotification({
      kind: 'attendance_punch', title: '打刻通知', message: msg,
      linkUrl: '/admin/attendance', createdBy: userId, audience: 'admin_manager',
    });
  } catch (e) { /* thông báo không quan trọng, bỏ qua lỗi */ }
}

// ─── Helper nội bộ: Cập nhật trạng thái tháng → submitted sau khi sửa ────────
async function touchMonthStatus(userId, y, m, requesterId) {
  try {
    const st = await getMonthStatusValue(userId, y, m);
    if (st !== 'approved') await repo.setMonthStatus(userId, y, m, 'submitted', requesterId);
  } catch (e) { /* không bắt buộc, bỏ qua lỗi */ }
}

// ─── API: Lấy tất cả segment + go-out của 1 ngày ─────────────────────────────
// GET /api/attendance/date/:date
exports.getDay = async (req, res) => {
  try {
    const userId = req.user?.id;
    const date   = req.params.date;
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    const [rows, goOuts] = await Promise.all([
      repo.listByUserBetween(userId, date, date),
      repo.getGoOutRecords(userId, date, { tenantId: req.tenantId || null }),
    ]);
    const currentGoOut = goOuts.find(g => !g.return_time) || null;
    res.status(200).json({ date, segments: rows, goOuts, currentGoOut });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── API: Lấy bản ghi daily (kubun, break...) của 1 ngày ─────────────────────
// GET /api/attendance/date/:date/daily
exports.getDaily = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const date = String(req.params.date || '').slice(0, 10);
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    const daily = await repo.getDaily(userId, date);
    res.status(200).json({ date, daily });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── API: Cập nhật kubun/break/workType cho 1 ngày ───────────────────────────
// PUT /api/attendance/date/:date/daily
exports.putDaily = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const date = String(req.params.date || '').slice(0, 10);
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    const y = parseInt(date.slice(0, 4), 10);
    const m = parseInt(date.slice(5, 7), 10);
    await assertMonthWritable(req, userId, y, m);
    if (req.user.role === 'employee' && !isEditableMonth(y, m)) {
      return res.status(403).json({ message: 'Forbidden: cannot edit past months' });
    }
    await repo.upsertDaily(userId, date, req.body || {});
    const daily = await repo.getDaily(userId, date);
    // Đồng bộ phép năm nếu kubun thay đổi sang 有給休暇
    try {
      await syncPaidLeaveByKubun(userId, date, String(daily?.kubun || req.body?.kubun || '').trim(), 'from_attendance', req.tenantId || null);
    } catch (e) { /* không bắt buộc, bỏ qua lỗi */ }
    await touchMonthStatus(userId, y, m, req.user?.id);
    res.status(200).json({ date, daily });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// ─── API: Cập nhật giờ check-in/out cho 1 segment ────────────────────────────
// PUT /api/attendance/date/:date
exports.putDay = async (req, res) => {
  try {
    const userId = req.user?.id;
    const date   = req.params.date;
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    const y = parseInt(date.slice(0, 4), 10), m = parseInt(date.slice(5, 7), 10);
    await assertMonthWritable(req, userId, y, m);
    if (req.user.role === 'employee' && !isEditableMonth(y, m)) {
      return res.status(403).json({ message: 'Forbidden: cannot edit past months' });
    }
    const { attendanceId, checkIn, checkOut, location, memo, notes } = req.body || {};
    if (!attendanceId) return res.status(400).json({ message: 'Missing attendanceId' });
    const row = await repo.getById(attendanceId);
    if (!row || String(row.userId) !== String(userId)) {
      return res.status(404).json({ message: 'Attendance not found' });
    }
    // 改ざん防止: 従業員は保存済みの時刻を変更・消去できない（空欄を埋めるのは可）
    if (isEmployee(req) && changesSavedTime(row,
      typeof checkIn === 'undefined' ? undefined : (checkIn || null),
      typeof checkOut === 'undefined' ? undefined : (checkOut || null))) {
      return res.status(403).json({ message: LOCK_MESSAGE });
    }
    const nextIn  = typeof checkIn  === 'undefined' ? row.checkIn  : (checkIn  || null);
    const nextOut = typeof checkOut === 'undefined' ? row.checkOut : (checkOut || null);
    const inChanged  = nextIn  && (!row.checkIn  || new Date(nextIn).getTime()  !== new Date(row.checkIn).getTime());
    const outChanged = nextOut && (!row.checkOut || new Date(nextOut).getTime() !== new Date(row.checkOut).getTime());
    await repo.updateTimes(attendanceId, nextIn, nextOut);
    // Cập nhật thêm location/memo/notes nếu có
    const colUpdates = [], colParams = [];
    if (typeof location !== 'undefined') { colUpdates.push('location = ?'); colParams.push(location || null); }
    if (typeof memo     !== 'undefined') { colUpdates.push('memo = ?');     colParams.push(memo     || null); }
    if (typeof notes    !== 'undefined') { colUpdates.push('notes = ?');    colParams.push(notes    || null); }
    if (colUpdates.length) {
      const tid = req.tenantId || null;
      let updSql = `UPDATE attendance SET ${colUpdates.join(', ')} WHERE id = ?`;
      const updParams = [...colParams, attendanceId];
      if (tid != null) { updSql += ` AND tenant_id = ?`; updParams.push(tid); }
      await db.query(updSql, updParams);
    }
    // Thông báo admin nếu giờ punch thay đổi
    if (inChanged)  await notifyPunch(userId, String(nextIn).slice(11, 16),  'in');
    else if (outChanged) await notifyPunch(userId, String(nextOut).slice(11, 16), 'out');
    await touchMonthStatus(userId, y, m, req.user?.id);
    res.status(200).json({ id: attendanceId });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// ─── API: Thêm segment mới cho ngày ──────────────────────────────────────────
// POST /api/attendance/date/:date/segments
exports.addSegment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const date   = req.params.date;
    const { checkIn, checkOut } = req.body || {};
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    if (!checkIn && !checkOut) return res.status(400).json({ message: 'Missing checkIn and checkOut' });
    const y = parseInt(date.slice(0, 4), 10), m = parseInt(date.slice(5, 7), 10);
    await assertMonthWritable(req, userId, y, m);
    if (req.user.role === 'employee' && !isEditableMonth(y, m)) {
      return res.status(403).json({ message: 'Forbidden: cannot edit past months' });
    }
    let id;
    if (!checkIn && checkOut) {
      // Chỉ có checkout → tạo bản ghi missing_checkin
      id = await repo.createMissingCheckIn(userId, checkOut, null, null, 'missing_checkin');
    } else {
      id = await repo.createCheckInTx(userId, checkIn, null, null);
      if (!id) id = (await repo.getOpenAttendanceForUser(userId, date))?.id;
      if (id && checkOut) await repo.setCheckOut(id, checkOut, null, null);
    }
    if (checkIn)  await notifyPunch(userId, String(checkIn).slice(11, 16),  'in');
    if (checkOut) await notifyPunch(userId, String(checkOut).slice(11, 16), 'out');
    await touchMonthStatus(userId, y, m, req.user?.id);
    res.status(201).json({ id });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// ─── API: Xóa 1 segment ──────────────────────────────────────────────────────
// DELETE /api/attendance/segment/:id
exports.deleteSegment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const id = parseInt(req.params.id, 10);
    if (!userId || !id) return res.status(400).json({ message: 'Missing id' });
    const row = await repo.getById(id);
    if (!row || String(row.userId) !== String(userId)) {
      return res.status(404).json({ message: 'Attendance not found' });
    }
    // 改ざん防止: 従業員は時刻が入った行を削除できない
    if (isEmployee(req) && hasSavedTime(row)) {
      return res.status(403).json({ message: LOCK_MESSAGE });
    }
    // Kiểm tra tháng có thể sửa không
    const ds = String(row.checkIn || row.checkOut || '').slice(0, 10);
    const y  = parseInt(ds.slice(0, 4), 10);
    const m  = parseInt(ds.slice(5, 7), 10);
    if (y && m) {
      try { await assertMonthWritable(req, userId, y, m); }
      catch (e) { return res.status(Number(e?.status || 500)).json({ message: e.message }); }
    }
    await db.query(`DELETE FROM attendance WHERE id = ?${req.tenantId != null ? ' AND tenant_id = ?' : ''}`, req.tenantId != null ? [id, req.tenantId] : [id]);
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── API: Đánh dấu segment ngày đã submit ────────────────────────────────────
// POST /api/attendance/date/:date/submit
exports.submitDay = async (req, res) => {
  try {
    const userId = req.user?.id;
    const date   = req.params.date;
    if (!userId || !date) return res.status(400).json({ message: 'Missing date' });
    const rows = await repo.listByUserBetween(userId, date, date);
    const tid = req.tenantId || null;
    for (const r of rows) {
      let labelSql = `UPDATE attendance SET labels = CONCAT_WS(',', labels, 'submitted') WHERE id = ?`;
      const labelParams = [r.id];
      if (tid != null) { labelSql += ` AND tenant_id = ?`; labelParams.push(tid); }
      await db.query(labelSql, labelParams);
    }
    res.status(200).json({ submitted: rows.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
