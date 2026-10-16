const repo = require('./adjust.repository');
const attendanceRepo = require('../attendance/attendance.repository');
const noticesRepo = require('../notices/notices.repository');
const summaryRepo = require('../attendance/attendance.summary.repository');
const db = require('../../core/database/mysql');
const { isHolidayWorkDay, getUserOffDaySet } = require('../attendance/attendance.utils');

// Sau khi duyệt 調整申請: tính lại 遅刻/早退 của ngày đó theo giờ chấm công mới
// (cùng quy tắc với màn hình: 遅刻 = 出勤 đầu tiên - giờ bắt đầu ca, 早退 = giờ kết thúc ca - 退勤 cuối cùng,
//  ca mặc định 08:00-17:00, 正社員 đi làm ngày nghỉ thì không tính).
// Nếu không làm vậy, 遅刻 cũ (vd 298分 tính từ lần 打刻 13:58) vẫn còn dù giờ đã sửa thành 08:50.
async function recomputeDailyLateEarly(reqRow, tid) {
  const ds = String(reqRow.requestedCheckIn || reqRow.requestedCheckOut || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  const userId = reqRow.userId;
  const [[daily]] = await db.query('SELECT id, kubun, early_minutes FROM attendance_daily WHERE userId = ? AND date = ? LIMIT 1', [userId, ds]);
  if (!daily) return;
  const [[span]] = await db.query(
    `SELECT DATE_FORMAT(MIN(checkIn), '%H:%i') AS firstIn, DATE_FORMAT(MAX(checkOut), '%H:%i') AS lastOut,
            DATE_FORMAT(MAX(checkOut), '%Y-%m-%d') AS lastOutDate
       FROM attendance WHERE userId = ? AND DATE(checkIn) = ?`,
    [userId, ds]
  );
  const [[user]] = await db.query('SELECT employment_type FROM users WHERE id = ? LIMIT 1', [userId]);
  const offSet = await getUserOffDaySet(parseInt(ds.slice(0, 4), 10), userId, tid || 0).catch(() => new Set());
  if (isHolidayWorkDay({ kubun: daily.kubun, isOffDay: offSet.has(ds), employmentType: user?.employment_type })) {
    await db.query('UPDATE attendance_daily SET late_minutes = NULL, early_minutes = NULL WHERE id = ?', [daily.id]);
    return;
  }
  let shiftStart = '08:00';
  let shiftEnd = '17:00';
  try {
    // Cùng cách chọn ca như GET month detail (attendance.monthdetail.controller.js shiftForDate)
    const [defs, assigns] = await Promise.all([
      attendanceRepo.listShiftDefinitions().catch(() => []),
      attendanceRepo.listShiftAssignmentsBetween(userId, ds, ds).catch(() => []),
    ]);
    let best = null;
    for (const a of assigns || []) {
      const sd = String(a?.start_date || '').slice(0, 10);
      if (!sd || sd > ds) continue;
      const ed = a?.end_date ? String(a.end_date).slice(0, 10) : '';
      if (ed && ed < ds) continue;
      best = a;
    }
    if (best) {
      const def = (defs || []).find(s => best.shiftId != null && String(s.id) === String(best.shiftId))
        || (defs || []).find(s => best.shift != null && String(s.name) === String(best.shift));
      if (def?.start_time) shiftStart = String(def.start_time).slice(0, 5);
      if (def?.end_time) shiftEnd = String(def.end_time).slice(0, 5);
    }
  } catch (e) { /* không lấy được ca → dùng ca mặc định */ }
  const toMin = (hm) => {
    const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };
  const inMin = toMin(span?.firstIn);
  // 退勤 sang ngày hôm sau thì không phải 早退
  const outMin = (span?.lastOutDate && span.lastOutDate > ds) ? null : toMin(span?.lastOut);
  const ssMin = toMin(shiftStart);
  const seMin = toMin(shiftEnd);
  const late = (inMin != null && ssMin != null && inMin > ssMin) ? inMin - ssMin : null;
  // 早退: chỉ tính lại khi ngày đó vốn đã có 早退 (không tự sinh 早退 mới, vd パート ca ngắn hơn giờ ca chuẩn)
  const early = daily.early_minutes == null
    ? null
    : ((outMin != null && seMin != null && seMin > ssMin && outMin < seMin) ? seMin - outMin : null);
  await db.query('UPDATE attendance_daily SET late_minutes = ?, early_minutes = ? WHERE id = ?', [late, early, daily.id]);
}
// Ghi giờ của 調整申請 đã duyệt vào bảng chấm công, để quản lý KHÔNG phải nhập lại ở 月次勤怠入力.
// - Tìm record cần sửa: attendanceId của đơn; nếu không có thì record cùng ngày trùng khung giờ
//   (đơn có 出勤) hoặc record còn mở chưa 退勤 (đơn chỉ có 退勤). Không thấy → tạo mới.
// - Chỉ thay phần nhân viên xin sửa; phần còn lại giữ nguyên giá trị đang có (trước đây bị xoá thành NULL).
// - Tìm theo id + userId (đơn đã được kiểm tra thuộc công ty này), không lọc tenant_id của record,
//   vì record chấm công cũ có tenant_id NULL → trước đây không tìm thấy và bị bỏ qua âm thầm.
async function applyApprovedTimes(reqRow, tid) {
  const norm = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : null);
  const reqIn = norm(reqRow.requestedCheckIn);
  const reqOut = norm(reqRow.requestedCheckOut);
  const userId = reqRow.userId;
  if (!reqIn && !reqOut) return { ok: false, error: '申請に時刻がありません' };

  let target = null;
  if (reqRow.attendanceId) {
    const [[row]] = await db.query('SELECT id, checkIn, checkOut FROM attendance WHERE id = ? AND userId = ? LIMIT 1', [reqRow.attendanceId, userId]);
    target = row || null;
  }
  if (!target && reqIn) {
    const [rows] = await db.query(
      `SELECT id, checkIn, checkOut FROM attendance
        WHERE userId = ? AND DATE(checkIn) = DATE(?)
          AND checkIn <= ? AND COALESCE(checkOut, checkIn) >= ?
        ORDER BY checkIn ASC LIMIT 1`,
      [userId, reqIn, reqOut || reqIn, reqIn]
    );
    target = rows && rows[0] ? rows[0] : null;
  }
  if (!target && !reqIn && reqOut) {
    // Chỉ xin sửa 退勤: record còn mở (chưa 退勤) bắt đầu trong ngày đó hoặc hôm trước (ca qua đêm)
    const [rows] = await db.query(
      `SELECT id, checkIn, checkOut FROM attendance
        WHERE userId = ? AND checkOut IS NULL
          AND checkIn <= ? AND DATE(checkIn) >= DATE(?) - INTERVAL 1 DAY
        ORDER BY checkIn DESC LIMIT 1`,
      [userId, reqOut, reqOut]
    );
    target = rows && rows[0] ? rows[0] : null;
  }

  if (target) {
    const nextIn = reqIn || norm(target.checkIn);
    const nextOut = reqOut || norm(target.checkOut);
    if (!nextIn) return { ok: false, error: '出勤時刻が不明のため反映できません', attendanceId: target.id };
    await db.query('UPDATE attendance SET checkIn = ?, checkOut = ? WHERE id = ? AND userId = ?', [nextIn, nextOut, target.id, userId]);
    if (nextIn && nextOut) {
      try { await db.query('UPDATE attendance SET is_anomaly = 0, anomaly_type = NULL WHERE id = ?', [target.id]); } catch (e) { /* cột không tồn tại */ }
    }
    reqRow.attendanceId = target.id;
    return { ok: true, mode: 'updated', attendanceId: target.id, checkIn: nextIn, checkOut: nextOut };
  }
  if (!reqIn) return { ok: false, error: '修正対象の勤怠が見つかりません（出勤時刻なし）' };
  await attendanceRepo.bulkUpsertAttendance(
    userId,
    { updates: [{ checkIn: reqIn, checkOut: reqOut || null }], dailyUpdates: [] },
    { tenantId: tid }
  );
  return { ok: true, mode: 'created', checkIn: reqIn, checkOut: reqOut };
}
// Controller yêu cầu sửa giờ
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = String(req.user?.role || '').toLowerCase();
    
    if (userRole === 'admin') {
      return res.status(403).json({ message: 'Admin cannot create adjust requests' });
    }
    
    const { attendanceId, requestedCheckIn, requestedCheckOut, reason } = req.body || {};
    if (!userId || (!requestedCheckIn && !requestedCheckOut)) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    const id = await repo.create({ userId, attendanceId, requestedCheckIn, requestedCheckOut, reason, tenantId: req.tenantId || null });
    try {
      const userName = String(req.user?.username || req.user?.email || `user#${userId}`);
      await noticesRepo.createAdminNotification({
        kind: 'time_adjust',
        title: '時間修正申請',
        message: `${userName} さんが時間修正を申請しました`,
        linkUrl: '/admin/attendance/adjust-requests',
        payload: {
          source: 'adjust',
          requestId: id,
          userId,
          attendanceId: attendanceId || null,
          requestedCheckIn: requestedCheckIn || null,
          requestedCheckOut: requestedCheckOut || null
        },
        createdBy: userId,
        audience: 'admin_manager'
      });
    } catch (e) { /* silently ignored */ }
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.listMine = async (req, res) => {
  try {
    const rows = await repo.listMine(req.user?.id, req.tenantId || null);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.listUser = async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    const rows = await repo.listByUser(userId, req.tenantId || null);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.updateStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const { status, adminNote } = req.body || {};
    if (!id || !status || !['approved','rejected','pending'].includes(status)) {
      return res.status(400).json({ message: 'Missing id/status' });
    }
    const cleanAdminNote = String(adminNote || '').trim();
    if (status === 'rejected' && !cleanAdminNote) {
      return res.status(400).json({ message: '差戻し理由を入力してください' });
    }
    const tid = req.tenantId || null;
    await repo.updateStatus(id, status, adminNote, tid, req.user?.id || null);
    let applied = null;
    if (status === 'approved') {
      const reqRow = await repo.getById(id, tid);
      if (reqRow) {
        // Ghi giờ đã duyệt vào bảng chấm công của nhân viên để admin KHÔNG phải
        // sang màn 月次勤怠入力 nhập lại.
        // - Nếu đơn gắn với record chấm công có sẵn (attendanceId) → update record đó.
        // - Nếu ngày đó CHƯA có record (attendanceId null) và có giờ 出勤 →
        //   dùng bulkUpsertAttendance (chính là hàm màn 月次 dùng) để TẠO MỚI record
        //   cho đúng ngày, đồng thời đồng bộ attendance_daily.
        try {
          applied = await applyApprovedTimes(reqRow, tid);
        } catch (e) {
          // Không chặn việc duyệt nếu ghi giờ lỗi, nhưng báo lại cho màn hình quản lý.
          applied = { ok: false, error: String(e && e.message || e) };
          console.error('[adjust.approve] write attendance failed:', e && e.message);
        }
        try {
          await recomputeDailyLateEarly(reqRow, tid);
        } catch (e) {
          console.error('[adjust.approve] recompute late/early failed:', e && e.message);
        }
        try {
          const ds = String(reqRow.requestedCheckIn || reqRow.requestedCheckOut || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
            await summaryRepo.markDirty(reqRow.userId, parseInt(ds.slice(0, 4), 10), parseInt(ds.slice(5, 7), 10), tid);
          }
        } catch (e) { /* silently ignored */ }
      }
    }
    try {
      const reqRow2 = await repo.getById(id, tid);
      if (reqRow2 && reqRow2.userId && status !== 'pending') {
        const statusLabel = status === 'approved' ? '承認' : (status === 'rejected' ? '差戻し' : status);
        if (status === 'rejected' && cleanAdminNote) {
          try {
            await repo.addMessage({
              requestId: reqRow2.id,
              userId: req.user?.id,
              message: cleanAdminNote
            });
          } catch (e) { /* silently ignored */ }
        }
        await noticesRepo.createNotice({
          targetUserId: reqRow2.userId,
          targetDate: reqRow2.requestedCheckIn ? String(reqRow2.requestedCheckIn).slice(0, 10) : null,
          targetMonth: reqRow2.requestedCheckIn ? String(reqRow2.requestedCheckIn).slice(0, 7) : null,
          message: `時間修正申請が${statusLabel}されました。${status === 'rejected' && cleanAdminNote ? ` 理由: ${cleanAdminNote}` : ''}`,
          createdBy: req.user?.id || null,
          kind: 'approval',
          title: '時間修正申請'
        });
      }
    } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, status, applied });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.listAll = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const tid = req.tenantId || null;
    const rows = role === 'manager'
      ? await repo.listForManager(tid)
      : await repo.listAll(tid);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const id = parseInt(String(req.params.id || ''), 10);
    const tid = req.tenantId || null;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const row = await repo.getById(id, tid);
    if (!row) return res.status(404).json({ message: 'Not found' });
    const own = String(row.userId) === String(req.user?.id);
    if (role !== 'admin' && !own) return res.status(403).json({ message: 'Forbidden' });
    if (role !== 'admin' && String(row.status || 'pending') !== 'pending') {
      return res.status(409).json({ message: 'Only pending requests can be deleted' });
    }
    const del = await repo.deleteById(id, tid);
    res.status(200).json({ ok: del > 0, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || '0'), 10);
    const tid = req.tenantId || null;
    if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
    const row = await repo.getById(id, tid);
    if (!row) return res.status(404).json({ message: 'Not found' });
    const role = String(req.user?.role || '').toLowerCase();
    const own = String(row.userId) === String(req.user?.id);
    if (!own && role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const rows = await repo.listMessages(id, tid);
    return res.status(200).json(rows || []);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.addMessage = async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || '0'), 10);
    const tid = req.tenantId || null;
    if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
    const row = await repo.getById(id, tid);
    if (!row) return res.status(404).json({ message: 'Not found' });
    const role = String(req.user?.role || '').toLowerCase();
    const own = String(row.userId) === String(req.user?.id);
    if (!own && role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const text = String(req.body?.message || '').trim();
    if (!text) return res.status(400).json({ message: 'メッセージを入力してください' });
    const newId = await repo.addMessage({ requestId: id, userId: req.user?.id, message: text, tenantId: tid });
    return res.status(201).json({ id: newId });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.updateByActor = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const id = parseInt(String(req.params.id || ''), 10);
    const tid = req.tenantId || null;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const row = await repo.getById(id, tid);
    if (!row) return res.status(404).json({ message: 'Not found' });
    const own = String(row.userId) === String(req.user?.id);
    const currentStatus = String(row.status || 'pending');
    if (role === 'admin' || (own && (currentStatus === 'pending' || currentStatus === 'rejected'))) {
      const { requestedCheckIn, requestedCheckOut, reason } = req.body || {};
      await repo.updateFields(id, { requestedCheckIn, requestedCheckOut, reason, tenantId: tid });
      if (own && role !== 'admin' && currentStatus === 'rejected') {
        await repo.updateStatus(id, 'pending', null, tid);
        try {
          const userName = String(req.user?.username || req.user?.email || `user#${req.user?.id}`);
          await noticesRepo.createAdminNotification({
            kind: 'time_adjust',
            title: '時間修正再申請',
            message: `${userName} さんが時間修正を再申請しました`,
            linkUrl: '/admin/attendance/adjust-requests',
            payload: {
              source: 'adjust',
              requestId: id,
              userId: req.user?.id || null
            },
            createdBy: req.user?.id || null,
            audience: 'admin_manager'
          });
        } catch (e) { /* silently ignored */ }
      }
      return res.status(200).json({ ok: true, id });
    }
    return res.status(403).json({ message: 'Forbidden' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
