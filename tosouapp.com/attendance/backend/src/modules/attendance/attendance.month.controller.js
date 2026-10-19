'use strict';

const repo = require('./attendance.repository');
const { reportSwallowed } = require('../../core/errorReporter');
const userRepo = require('../users/user.repository');
const noticesRepo = require('../notices/notices.repository');
const log = require('../../core/logger');
const db = require('../../core/database/mysql');
const {
  resolveTargetUserId,
  isEditableMonth,
  getMonthStatusValue,
  getUserOffDaySet,
} = require('./attendance.utils');

// Hàm hỗ trợ nội bộ

async function computeMonthMissing(userId, y, m, tenantId = null) {
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${y}-${pad(m)}-01`;
  const to = `${y}-${pad(m)}-${pad(lastDay)}`;

  const user = await userRepo.getUserById(userId).catch(() => null);
  const isPartTime = user?.employment_type === 'part_time';

  const off = await getUserOffDaySet(y, userId, tenantId || 0);
  const dailyRows = await repo.listDailyBetween(userId, from, to, { tenantId }).catch(() => []);
  const dailyKubun = new Map((dailyRows || []).map(r => [String(r?.date || '').slice(0, 10), String(r?.kubun || '').trim()]));
  const segRows = await repo.listByUserBetween(userId, from, to, { tenantId }).catch(() => []);
  const segByDate = new Map();
  for (const r of segRows || []) {
    const ds = String(r?.checkIn || r?.checkOut || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    if (!segByDate.has(ds)) segByDate.set(ds, []);
    segByDate.get(ds).push(r);
  }
  const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
  const missing = [];
  for (let day = 1; day <= lastDay; day++) {
    const ds = `${y}-${pad(m)}-${pad(day)}`;
    const isOff = off.has(ds);
    const k0 = dailyKubun.get(ds) || '';
    const allowedNormal = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休み', '休日']);
    const allowedOff = new Set(['休日', '休日出勤', '代替出勤', '休み']);
    const kubun = (isOff ? (allowedOff.has(k0) ? k0 : '') : (allowedNormal.has(k0) ? k0 : ''));
    const segs = segByDate.get(ds) || [];
    const hasComplete = segs.some(s => !!s?.checkIn && !!s?.checkOut);
    const isWork = workKubunSet.has(kubun);

    if (isPartTime) {
      if (isWork && !hasComplete) missing.push(ds);
      continue;
    }
    if (!isOff && !kubun) {
      if (!hasComplete) missing.push(ds);
      continue;
    }
    if (isWork && !hasComplete) missing.push(ds);
  }
  return missing;
}

// Phiên bản chi tiết cho nhân viên: trả về từng ngày kèm lý do thiếu (thiếu 出勤 / thiếu 退勤 / cả hai).
// Khác computeMonthMissing (dùng cho submit/approve) ở 2 điểm:
//   - 半休 / 半休(有給): là làm nửa ngày, nếu đã 出勤 thì KHÔNG cần 退勤 -> không cảnh báo.
//   - Trả về missIn/missOut để hiển thị đúng nội dung.
async function computeMonthMissingDetailed(userId, y, m, tenantId = null) {
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${y}-${pad(m)}-01`;
  const to = `${y}-${pad(m)}-${pad(lastDay)}`;

  const user = await userRepo.getUserById(userId).catch(() => null);
  const isPartTime = user?.employment_type === 'part_time';

  const off = await getUserOffDaySet(y, userId, tenantId || 0);
  const dailyRows = await repo.listDailyBetween(userId, from, to, { tenantId }).catch(() => []);
  const dailyKubun = new Map((dailyRows || []).map(r => [String(r?.date || '').slice(0, 10), String(r?.kubun || '').trim()]));
  const segRows = await repo.listByUserBetween(userId, from, to, { tenantId }).catch(() => []);
  const segByDate = new Map();
  for (const r of segRows || []) {
    const ds = String(r?.checkIn || r?.checkOut || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    if (!segByDate.has(ds)) segByDate.set(ds, []);
    segByDate.get(ds).push(r);
  }
  const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
  const halfDayKubun = new Set(['半休', '半休(有給)']);
  const allowedNormal = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休み', '休日']);
  const allowedOff = new Set(['休日', '休日出勤', '代替出勤', '休み']);

  const result = [];
  for (let day = 1; day <= lastDay; day++) {
    const ds = `${y}-${pad(m)}-${pad(day)}`;
    const isOff = off.has(ds);
    const k0 = dailyKubun.get(ds) || '';
    const kubun = (isOff ? (allowedOff.has(k0) ? k0 : '') : (allowedNormal.has(k0) ? k0 : ''));
    const segs = segByDate.get(ds) || [];
    const hasIn = segs.some(s => !!s?.checkIn);
    const hasOut = segs.some(s => !!s?.checkOut);
    const isWork = workKubunSet.has(kubun);

    if (isPartTime) {
      // Part-time: chỉ cảnh báo khi đã 出勤 nhưng chưa 退勤.
      // Ngày không bấm gì (không đi làm) thì KHÔNG cảnh báo vì lịch part-time linh hoạt.
      if (hasIn && !hasOut) {
        result.push({ date: ds, missIn: false, missOut: true });
      }
      continue;
    }

    // Nhân viên chính thức: xác định ngày có bắt buộc chấm công không
    let mustWork;
    if (!isOff && !kubun) {
      mustWork = true; // ngày thường không có kubun -> mặc định phải đi làm
    } else {
      mustWork = isWork;
    }
    if (!mustWork) continue;

    // 半休 / 半休(有給): nếu đã có 出勤 thì coi như đủ (không cần 退勤)
    if (halfDayKubun.has(kubun) && hasIn) continue;

    if (!hasIn) {
      // Không bấm gì cả (chưa 出勤) -> thiếu cả 出勤 lẫn 退勤
      result.push({ date: ds, missIn: true, missOut: true });
    } else if (!hasOut) {
      // Đã 出勤 nhưng chưa 退勤
      result.push({ date: ds, missIn: false, missOut: true });
    }
  }
  return result;
}

// API: Lấy trạng thái nộp bảng chấm công của một tháng
exports.getMonthStatus = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.query || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    const r = await repo.getMonthStatus(userId, year, month, { tenantId: req.tenantId || null });
    const status = String(r?.status || '').trim() || 'draft';
    res.status(200).json({
      userId,
      year: parseInt(String(year), 10),
      month: parseInt(String(month), 10),
      status,
      submitted_at: r?.submitted_at || null,
      submitted_by: r?.submitted_by || null,
      approved_at: r?.approved_at || null,
      approved_by: r?.approved_by || null,
      approved_by_name: r?.approved_by_name || null,
      unlocked_at: r?.unlocked_at || null,
      unlocked_by: r?.unlocked_by || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMonthStatusBulk = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { userIds, year, month } = req.query || {};
    if (!userIds || !year || !month) return res.status(400).json({ message: 'Missing userIds/year/month' });
    const ids = String(userIds).split(',').map(s => parseInt(s, 10)).filter(Boolean);
    if (!ids.length) return res.status(200).json([]);
    const rows = await repo.getMonthStatusBulk(ids, year, month, { tenantId: req.tenantId || null });
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    const pad = (n) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${y}-${pad(m)}-01`;
    const to = `${y}-${pad(m)}-${pad(lastDay)}`;
    const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
    const enrich = async (uid) => {
      try {
        const off = await getUserOffDaySet(y, uid, req.tenantId || 0);
        const dailyRows = await repo.listDailyBetween(uid, from, to, { tenantId: req.tenantId || null }).catch(() => []);
        const dailyKubun = new Map((dailyRows || []).map(r => [String(r?.date || '').slice(0, 10), String(r?.kubun || '').trim()]));
        const segRows = await repo.listByUserBetween(uid, from, to, { tenantId: req.tenantId || null }).catch(() => []);
        const segByDate = new Map();
        for (const r of segRows || []) {
          const ds = String(r?.checkIn || r?.checkOut || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
          if (!segByDate.has(ds)) segByDate.set(ds, []);
          segByDate.get(ds).push(r);
        }
        let missing = 0;
        for (let day = 1; day <= lastDay; day++) {
          const ds = `${y}-${pad(m)}-${pad(day)}`;
          const isOff = off.has(ds);
          const k0 = dailyKubun.get(ds) || '';
          const allowedNormal = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休み', '休日']);
          const allowedOff = new Set(['休日', '休日出勤', '代替出勤', '休み']);
          const kubun = (isOff ? (allowedOff.has(k0) ? k0 : '') : (allowedNormal.has(k0) ? k0 : ''));
          const segs = segByDate.get(ds) || [];
          const hasComplete = segs.some(s => !!s?.checkIn && !!s?.checkOut);
          const isWork = workKubunSet.has(kubun);
          if (!isOff && !kubun) {
            if (!hasComplete) missing++;
            continue;
          }
          if (isWork && !hasComplete) missing++;
        }
        return { ready: missing === 0, missingCount: missing };
      } catch {
        return { ready: false, missingCount: null };
      }
    };
    const readyMap = new Map();
    for (const id of ids) {
      readyMap.set(String(id), await enrich(id));
    }
    res.status(200).json(rows.map(r => {
      const extra = readyMap.get(String(r.userId)) || { ready: false, missingCount: null };
      return {
        userId: r.userId, year: r.year, month: r.month, status: r.status,
        ready: !!extra.ready, missing_count: extra.missingCount,
        submitted_at: r.submitted_at || null, submitted_by: r.submitted_by || null,
        approved_at: r.approved_at || null, approved_by: r.approved_by || null,
        approved_by_name: r.approved_by_name || null
      };
    }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Gửi/Nộp (Submit) bảng chấm công của tháng lên cho quản lý
exports.submitMonth = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.body || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (String(req.user?.role || '').toLowerCase() === 'employee' && !isEditableMonth(y, m)) {
      return res.status(403).json({ message: 'Forbidden: cannot submit past months' });
    }
    const status = await getMonthStatusValue(userId, y, m);
    if (status === 'approved') return res.status(409).json({ message: 'Locked: month is closed' });

    try {
      const missing = await computeMonthMissing(userId, y, m, req.tenantId || null);
      if (missing.length) return res.status(400).json({ message: `入力が未完了です`, missing });
    } catch (e) { reportSwallowed('month.submit.computeMonthMissing', e); }

    await repo.setMonthStatus(userId, y, m, 'submitted', req.user?.id, { tenantId: req.tenantId || null });

    try {
      const u = await userRepo.getUserById(userId).catch(() => null);
      const userName = u ? (u.username || u.email || '従業員') : '従業員';
      const pad = n => String(n).padStart(2, '0');
      await noticesRepo.createAdminNotification({
        kind: 'month_submit',
        title: '勤怠月次提出',
        message: `${userName} さんが${y}年${pad(m)}月の勤怠を提出しました`,
        linkUrl: '/admin/attendance',
        payload: { source: 'monthly', userId, year: y, month: m },
        createdBy: userId,
        audience: 'admin_manager'
      });
    } catch (e) { /* gửi thông báo lỗi thì bỏ qua */ }

    res.status(200).json({ ok: true, userId, year: y, month: m, status: 'submitted' });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// API: Nhân viên tự xem các ngày phải đi làm nhưng thiếu chấm công (出勤/退勤) của chính mình
// GET /api/attendance/month/missing/me?year=&month=
// Chỉ trả về những ngày ĐÃ QUA (< hôm nay, JST). Hôm nay chưa hết ngày nên không cảnh báo.
// Mỗi ngày kèm lý do: missIn (thiếu 出勤), missOut (thiếu 退勤).
exports.getMonthMissingMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { year, month } = req.query || {};
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!y || !m) return res.status(400).json({ message: 'Missing year/month' });

    // Không lọc theo tenant ở đây: dữ liệu chấm công cũ có thể có tenant_id = NULL,
    // và việc cô lập tenant đã được đảm bảo qua userId (mỗi user thuộc đúng 1 tenant).
    // Cách này nhất quán với GET /api/attendance/date/:date (getDay) mà màn hình đang dùng.
    const detailed = await computeMonthMissingDetailed(userId, y, m, null);

    // Chỉ giữ các ngày đã qua (< hôm nay theo giờ Nhật/JST). Không cảnh báo hôm nay vì ngày chưa kết thúc.
    const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const missing = (detailed || [])
      .filter(it => String(it.date) < todayJst)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // mới nhất lên đầu

    // Gắn trạng thái 調整申請 mới nhất của từng ngày (pending / rejected) để màn hình
    // không bảo nhân viên "hãy 申請" lại khi đơn đã gửi và đang chờ quản lý duyệt.
    if (missing.length) {
      try {
        const mm = String(m).padStart(2, '0');
        const start = `${y}-${mm}-01`;
        const end = `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
        const [reqRows] = await db.query(
          `SELECT r.id, r.status, r.admin_note,
                  DATE_FORMAT(COALESCE(DATE(a.checkIn), DATE(r.requestedCheckIn), DATE(r.requestedCheckOut)), '%Y-%m-%d') AS d
             FROM time_adjust_requests r
             LEFT JOIN attendance a ON a.id = r.attendanceId
            WHERE r.userId = ?
              AND COALESCE(DATE(a.checkIn), DATE(r.requestedCheckIn), DATE(r.requestedCheckOut)) BETWEEN ? AND ?
            ORDER BY r.id DESC`,
          [userId, start, end]
        );
        const latestByDate = new Map();
        for (const r of (reqRows || [])) {
          if (r.d && !latestByDate.has(r.d)) latestByDate.set(r.d, r);
        }
        for (const it of missing) {
          const r = latestByDate.get(String(it.date));
          const st = String(r?.status || '');
          if (st === 'pending' || st === 'rejected') {
            it.adjust = { id: r.id, status: st, adminNote: st === 'rejected' ? (r.admin_note || null) : null };
          }
        }
      } catch (e) { /* bảng chưa tồn tại → hiển thị cảnh báo như cũ */ }
    }

    res.status(200).json({ userId, year: y, month: m, missing });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMonthMissing = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { userId, year, month } = req.query || {};
    const uid = parseInt(String(userId), 10);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!uid || !y || !m) return res.status(400).json({ message: 'Missing userId/year/month' });
    const missing = await computeMonthMissing(uid, y, m, req.tenantId || null);
    res.status(200).json({ userId: uid, year: y, month: m, missing });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.approveReadyMonth = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const { month, departmentId } = req.body || {};
    const ym = String(month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ message: 'Missing month (YYYY-MM)' });

    let effectiveDeptId = departmentId || null;
    if (role === 'manager') {
      const strictDept = String(process.env.MANAGER_STRICT_DEPT || '').toLowerCase() === 'true';
      if (strictDept) {
        const me = await userRepo.getUserById(req.user.id);
        if (me?.departmentId) {
          if (effectiveDeptId && String(effectiveDeptId) !== String(me.departmentId)) {
            return res.status(403).json({ message: 'Forbidden: cannot approve other departments' });
          }
          effectiveDeptId = me.departmentId;
        }
      }
    }

    const y = parseInt(ym.slice(0, 4), 10);
    const m = parseInt(ym.slice(5, 7), 10);
    // 対象月の月末時点で在籍していた部署で絞り込む (承認操作をした「今日」の部署ではない) —
    // 対象月の後に他部署へ異動した人も、この月の承認対象からは外れない。
    const monthEndDate = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const rows = await repo.getActiveUserIds(effectiveDeptId, { tenantId: req.tenantId || null, asOfDate: monthEndDate });
    // userId だけだと管理者がどの社員か分からないので、氏名/社員番号も返す。
    // 1人ずつ getUserById を呼ぶと N+1 になる上に何かの理由で個別取得が失敗しやすいので、
    // 対象者をまとめて1回で取得してから id で引く。
    const { rows: allUsersForNames } = await userRepo.listUsersPaged({ tenantId: req.tenantId || null, limit: 5000 }).catch(() => ({ rows: [] }));
    const userNameById = new Map((allUsersForNames || []).map(u => [Number(u.id), u]));
    let approved = 0, submitted = 0, skipped = 0;
    const results = [];
    for (const r of (rows || [])) {
      const uid = Number(r.userId);
      const u = userNameById.get(uid) || null;
      const employeeCode = u?.employee_code || null;
      const username = u?.username || u?.email || null;
      const st = await repo.getMonthStatus(uid, y, m, { tenantId: req.tenantId || null }).catch(() => null);
      const status = String(st?.status || '').trim() || 'draft';
      const missing = await computeMonthMissing(uid, y, m, req.tenantId || null).catch(() => ['error']);
      if (missing && missing.length) {
        results.push({ userId: uid, employeeCode, username, status, ok: false, reason: 'missing_days', missing });
        skipped++;
        continue;
      }
      if (status !== 'submitted') {
        await repo.setMonthStatus(uid, y, m, 'submitted', req.user?.id, { tenantId: req.tenantId || null }).catch((e) => reportSwallowed('month.approveReady.setSubmitted', e, { userId: uid }));
        submitted++;
      }
      // Trước đây lỗi bị nuốt (.catch(() => {})) mà vẫn đếm là 承認済み → màn hình báo đã chốt dù chưa chốt.
      try {
        await repo.setMonthStatus(uid, y, m, 'approved', req.user?.id, { tenantId: req.tenantId || null });
      } catch (e) {
        reportSwallowed('month.approveReady.setApproved', e, { userId: uid });
        results.push({ userId: uid, employeeCode, username, status, ok: false, reason: 'save_failed' });
        skipped++;
        continue;
      }
      approved++;
      results.push({ userId: uid, employeeCode, username, status: 'approved', ok: true });
    }
    res.status(200).json({ month: ym, approved, submitted, skipped, results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Duyệt (Approve) bảng chấm công của cả tháng
exports.approveMonth = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.body || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    const status = await getMonthStatusValue(userId, y, m);
    if (status !== 'submitted') {
      await repo.setMonthStatus(userId, y, m, 'submitted', req.user?.id, { tenantId: req.tenantId || null });
    }
    try {
      const missing = await computeMonthMissing(userId, y, m, req.tenantId || null);
      if (missing.length) return res.status(400).json({ message: `未承認: 勤務未入力の日があります`, missing });
    } catch (e) { reportSwallowed('month.approve.computeMonthMissing', e); }
    await repo.setMonthStatus(userId, y, m, 'approved', req.user?.id, { tenantId: req.tenantId || null });
    res.status(200).json({ ok: true, userId, year: y, month: m, status: 'approved' });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// API: Toàn công ty đã đóng tháng X chưa? (đếm active users vs users đã 'approved').
// Dùng cho banner "未締め/締め済み" — không tạo cờ khóa mới, chỉ tổng hợp attendance_month_status có sẵn.
exports.getMonthClosureSummary = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const ym = String(req.query.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ message: 'Missing month (YYYY-MM)' });
    const y = parseInt(ym.slice(0, 4), 10);
    const m = parseInt(ym.slice(5, 7), 10);
    const tenantId = req.tenantId || null;
    const activeRows = await repo.getActiveUserIds(null, { tenantId });
    const ids = activeRows.map(r => Number(r.userId));
    if (!ids.length) return res.status(200).json({ month: ym, closed: true, approved: 0, total: 0, pending: [] });
    const statusRows = await repo.getMonthStatusBulk(ids, y, m, { tenantId });
    const statusMap = new Map((statusRows || []).map(r => [Number(r.userId), r.status]));
    const pending = [];
    let approved = 0;
    for (const uid of ids) {
      const status = statusMap.get(uid) || 'draft';
      if (status === 'approved') approved++;
      else pending.push({ userId: uid, status });
    }
    res.status(200).json({ month: ym, closed: pending.length === 0, approved, total: ids.length, pending });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Mở khóa (Unlock) bảng chấm công để nhân viên có thể sửa lại
exports.unlockMonth = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    const { year, month } = req.body || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    await repo.setMonthStatus(userId, y, m, 'unlocked', req.user?.id, { tenantId: req.tenantId || null });
    res.status(200).json({ ok: true, userId, year: y, month: m, status: 'unlocked' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMonthSummary = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const y = parseInt(String(req.query?.year || ''), 10);
    const m = parseInt(String(req.query?.month || ''), 10);
    if (!userId || !y || !m) return res.status(400).json({ message: 'Missing userId/year/month' });
    const row = await repo.getMonthSummary(userId, y, m, { tenantId: req.tenantId || null });
    const safeParse = (s) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
    res.status(200).json({
      userId, year: y, month: m,
      all: row ? safeParse(row.summary_all) : null,
      inhouse: row ? safeParse(row.summary_inhouse) : null,
      updatedBy: row ? (row.updated_by || null) : null,
      updatedAt: row ? (row.updated_at || null) : null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Tính toán/Cập nhật dữ liệu tổng hợp của tháng
exports.putMonthSummary = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const b = req.body || {};
    const y = parseInt(String(b.year || req.query?.year || ''), 10);
    const m = parseInt(String(b.month || req.query?.month || ''), 10);
    if (!userId || !y || !m) return res.status(400).json({ message: 'Missing userId/year/month' });
    const all = b.all ?? b.summaryAll ?? null;
    const inhouse = b.inhouse ?? b.summaryInhouse ?? null;
    try {
      const s1 = all == null ? '' : JSON.stringify(all);
      const s2 = inhouse == null ? '' : JSON.stringify(inhouse);
      if (s1.length > 50000 || s2.length > 50000) return res.status(400).json({ message: 'Payload too large' });
    } catch {
      return res.status(400).json({ message: 'Invalid summary payload' });
    }
    const r = await repo.upsertMonthSummary(userId, y, m, all, inhouse, req.user?.id || null, { tenantId: req.tenantId || null });
    res.status(200).json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
