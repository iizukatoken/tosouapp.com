const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
const db = require('../../core/database/mysql');

const isYM = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const monthJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const monthRange = (month) => {
  const [y, m] = String(month).split('-').map(n => parseInt(n, 10));
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
};
const fmtHm = (dt) => dt ? String(dt).slice(11, 16) : '--:--';

const LEAVE_TYPE_LABEL = {
  paid: '有給休暇', paid_half: '半休（有給）', unpaid: '無給休暇', sick: '欠勤', absence: '欠勤',
  half: '半休', substitute: '代替休日'
};
const PAID_TYPES = new Set(['paid', 'paid_half']);
const PROFILE_FIELD_LABEL = { username: '氏名', email: 'メール', birthDate: '生年月日', gender: '性別', phone: '電話', avatarUrl: '写真', address: '住所' };
const OTHER_STATUS = { '申請済み': 'pending', '承認済み': 'approved', '却下': 'rejected' };
const SHIFT_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };

// 承認/却下は各元APIにそのまま流す: 画面はこの actions をそのまま呼ぶ。
const leaveActions = (id) => ({
  approve: { method: 'PATCH', url: `/api/leave/${id}/status`, body: { status: 'approved' } },
  reject: { method: 'PATCH', url: `/api/leave/${id}/status`, body: { status: 'rejected' } }
});
const adjustActions = (id) => ({
  approve: { method: 'PATCH', url: `/api/adjust/${id}/status`, body: { status: 'approved' } },
  reject: { method: 'PATCH', url: `/api/adjust/${id}/status`, body: { status: 'rejected' }, noteField: 'adminNote', noteRequired: true }
});
const shiftActions = (userId, month) => ({
  approve: { method: 'POST', url: '/api/attendance/shifts/submissions/approve', body: { userId, month, status: 'APPROVED' } },
  reject: { method: 'POST', url: '/api/attendance/shifts/submissions/approve', body: { userId, month, status: 'REJECTED' } }
});
const profileActions = (id) => ({
  approve: { method: 'PATCH', url: `/api/manager/profile-change/${id}/status`, body: { status: 'approved' } },
  reject: { method: 'PATCH', url: `/api/manager/profile-change/${id}/status`, body: { status: 'rejected' } }
});
const otherActions = (id) => ({
  approve: { method: 'PATCH', url: `/api/admin/requests/other/${id}/status`, body: { status: 'approved' } },
  reject: { method: 'PATCH', url: `/api/admin/requests/other/${id}/status`, body: { status: 'rejected' } }
});

// Bảng tạo lười (CREATE TABLE IF NOT EXISTS khi lần đầu dùng) có thể chưa tồn tại → coi như rỗng.
async function queryOptional(sql, params) {
  try {
    const [rows] = await db.query(sql, params);
    return rows || [];
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146)) return [];
    throw e;
  }
}

function userFilters({ tenantId, dept, userId, q }, userCol) {
  const where = [];
  const params = [];
  if (tenantId) { where.push('u.tenant_id = ?'); params.push(tenantId); }
  if (dept) { where.push('d.name = ?'); params.push(dept); }
  if (userId) { where.push(`${userCol} = ?`); params.push(userId); }
  if (q) { where.push('(u.employee_code LIKE ? OR u.username LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  return { sql: where.map(w => ` AND ${w}`).join(''), params };
}

function nextDay(ymd) {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

// 種別/部署/社員/ステータス/検索 でフィルタしつつ、社員の申請をすべて 1本のリストに正規化してまとめる:
// 有給・休暇 (leave_requests) / 打刻修正 (time_adjust_requests) / シフト提出 (shift_month_status) /
// プロフィール変更 (user_change_requests) / その他 (employee_requests: 残業申請・休日申請・通勤交通費)。
async function fetchMerged({ tenantId, month, dept, userId, status, q }) {
  const { start, end } = monthRange(month);

  // attendance.utils.js の syncPaidLeaveByKubun / leave.repository.js の
  // reconcileApprovedPaidWithAttendance が「勤怠画面で有給休暇のkubunを付けた/外した」
  // 副作用として自動生成する行 (reason に from_attendance / [AUTO_CANCEL] / [AUTO_RECONCILE]
  // が入る) は、本人が事前に申請したものではないため、申請・承認一覧には出さない。
  // [SHIFT_CHANGED] = シフト再提出で有給日から外れた from_shift 行。
  const leaveWhere = [
    'lr.startDate <= ? AND lr.endDate >= ?',
    "COALESCE(lr.reason, '') NOT LIKE '%from_attendance%'",
    "COALESCE(lr.reason, '') NOT LIKE '%[AUTO_CANCEL]%'",
    "COALESCE(lr.reason, '') NOT LIKE '%[AUTO_RECONCILE]%'",
    "COALESCE(lr.reason, '') NOT LIKE '%[SHIFT_CHANGED]%'"
  ];
  const leaveParams = [end, start];
  if (tenantId) { leaveWhere.push('u.tenant_id = ?'); leaveParams.push(tenantId); }
  if (dept) { leaveWhere.push('d.name = ?'); leaveParams.push(dept); }
  if (userId) { leaveWhere.push('lr.userId = ?'); leaveParams.push(userId); }
  if (status) { leaveWhere.push('lr.status = ?'); leaveParams.push(status); }
  if (q) { leaveWhere.push('(u.employee_code LIKE ? OR u.username LIKE ?)'); leaveParams.push(`%${q}%`, `%${q}%`); }
  const [leaveRows] = await db.query(`
    SELECT lr.id, lr.userId, lr.startDate, lr.endDate, lr.type, lr.reason, lr.status,
           lr.processed_by, lr.processed_at,
           u.employee_code AS employeeCode, u.username AS username, u.departmentId, d.name AS departmentName,
           pu.username AS processedByName
    FROM leave_requests lr
    JOIN users u ON u.id = lr.userId
    LEFT JOIN departments d ON d.id = u.departmentId
    LEFT JOIN users pu ON pu.id = lr.processed_by
    WHERE ${leaveWhere.join(' AND ')}
  `, leaveParams);

  const adjWhere = ['DATE(COALESCE(tar.requestedCheckIn, tar.requestedCheckOut, tar.created_at)) BETWEEN ? AND ?'];
  const adjParams = [start, end];
  if (tenantId) { adjWhere.push('u.tenant_id = ?'); adjParams.push(tenantId); }
  if (dept) { adjWhere.push('d.name = ?'); adjParams.push(dept); }
  if (userId) { adjWhere.push('tar.userId = ?'); adjParams.push(userId); }
  if (status) { adjWhere.push('tar.status = ?'); adjParams.push(status); }
  if (q) { adjWhere.push('(u.employee_code LIKE ? OR u.username LIKE ?)'); adjParams.push(`%${q}%`, `%${q}%`); }
  const [adjRows] = await db.query(`
    SELECT tar.id, tar.userId, tar.requestedCheckIn, tar.requestedCheckOut, tar.reason, tar.status, tar.created_at,
           tar.processed_by, tar.processed_at,
           u.employee_code AS employeeCode, u.username AS username, u.departmentId, d.name AS departmentName,
           pu.username AS processedByName
    FROM time_adjust_requests tar
    JOIN users u ON u.id = tar.userId
    LEFT JOIN departments d ON d.id = u.departmentId
    LEFT JOIN users pu ON pu.id = tar.processed_by
    WHERE ${adjWhere.join(' AND ')}
  `, adjParams);

  const filt = { tenantId, dept, userId, q };

  const sf = userFilters(filt, 's.userId');
  const shiftRows = await queryOptional(`
    SELECT s.id, s.userId, s.month, s.status, s.updated_at,
           u.employee_code AS employeeCode, u.username AS username, u.departmentId, d.name AS departmentName
    FROM shift_month_status s
    JOIN users u ON u.id = s.userId
    LEFT JOIN departments d ON d.id = u.departmentId
    WHERE s.month = ? AND s.status IN ('PENDING', 'APPROVED', 'REJECTED')${sf.sql}
  `, [month, ...sf.params]);
  const shiftCounts = new Map();
  if (shiftRows.length) {
    const ids = [...new Set(shiftRows.map(r => r.userId))];
    const counts = await queryOptional(`
      SELECT userId,
             SUM(status = 'OFF') AS offDays,
             SUM(status = 'LEAVE' AND leaveType = 'paid') AS paidDays,
             SUM(status = 'LEAVE' AND leaveType = 'paid_half') AS paidHalfDays,
             SUM(status = 'LEAVE' AND COALESCE(leaveType, '') NOT IN ('paid', 'paid_half')) AS otherLeaveDays
      FROM shift_requests
      WHERE userId IN (${ids.map(() => '?').join(',')}) AND date LIKE ?
      GROUP BY userId
    `, [...ids, `${month}-%`]);
    for (const c of counts) shiftCounts.set(c.userId, c);
  }

  const pf = userFilters(filt, 'ucr.user_id');
  const profileRows = await queryOptional(`
    SELECT ucr.id, ucr.user_id AS userId, ucr.fields_json, ucr.status, ucr.created_at, ucr.approved_at,
           u.employee_code AS employeeCode, u.username AS username, u.departmentId, d.name AS departmentName,
           pu.username AS processedByName
    FROM user_change_requests ucr
    JOIN users u ON u.id = ucr.user_id
    LEFT JOIN departments d ON d.id = u.departmentId
    LEFT JOIN users pu ON pu.id = ucr.approved_by
    WHERE DATE(ucr.created_at) BETWEEN ? AND ?${pf.sql}
  `, [start, end, ...pf.params]);

  const of = userFilters(filt, 'er.user_id');
  const otherRows = await queryOptional(`
    SELECT er.id, er.user_id AS userId, er.request_no, er.record_type, er.detail, er.office, er.status,
           er.created_at, er.updated_at,
           u.employee_code AS employeeCode, u.username AS username, u.departmentId, d.name AS departmentName
    FROM employee_requests er
    JOIN users u ON u.id = er.user_id
    LEFT JOIN departments d ON d.id = u.departmentId
    WHERE DATE(er.created_at) BETWEEN ? AND ?${of.sql}
  `, [start, end, ...of.params]);

  // 却下した有給なのに月次表の区分が有給のまま → 有給残数から引かれ続けるので警告を出す。
  const stillPaid = new Set();
  const rejectedPaid = (leaveRows || []).filter(r => r.status === 'rejected' && PAID_TYPES.has(r.type));
  if (rejectedPaid.length) {
    const ids = [...new Set(rejectedPaid.map(r => r.userId))];
    const kubunRows = await queryOptional(`
      SELECT userId, date FROM attendance_daily
      WHERE userId IN (${ids.map(() => '?').join(',')}) AND date BETWEEN ? AND ?
        AND REPLACE(TRIM(COALESCE(kubun, '')), '　', '') IN ('有給休暇', '半休(有給)')
    `, [...ids, start, end]);
    for (const k of kubunRows) stillPaid.add(`${k.userId}|${String(k.date).slice(0, 10)}`);
  }

  const base = (r) => ({
    userId: r.userId,
    applicantName: r.username || '',
    employeeCode: r.employeeCode || null,
    departmentName: r.departmentName || null
  });

  const normLeave = (leaveRows || []).map(r => {
    const s = String(r.startDate).slice(0, 10);
    const e = String(r.endDate).slice(0, 10);
    const sameDay = s === e;
    const label = LEAVE_TYPE_LABEL[r.type] || '休暇';
    const fromShift = String(r.reason || '').includes('from_shift');
    const fromKubun = String(r.reason || '').includes('from_kubun');
    let warning = null;
    if (r.status === 'rejected' && PAID_TYPES.has(r.type)) {
      for (let d = s; d <= e; d = nextDay(d)) {
        if (stillPaid.has(`${r.userId}|${d}`)) { warning = '却下済みですが月次勤怠の区分が有給のままです（有給残数から引かれます）'; break; }
      }
    }
    return {
      type: 'leave',
      category: 'leave',
      typeLabel: PAID_TYPES.has(r.type) ? '有給申請' : '休暇申請',
      requestId: r.id,
      ...base(r),
      targetDate: sameDay ? s : `${s}〜${e}`,
      content: `${label}${sameDay && !['paid_half', 'half'].includes(r.type) ? '（全日）' : ''}`,
      reason: fromShift ? 'シフト提出より' : (fromKubun ? '月次勤怠の区分より' : (r.reason || '')),
      source: fromShift ? 'shift' : (fromKubun ? 'kubun' : 'request'),
      status: r.status,
      processedByName: r.processedByName || null,
      processedAt: r.processed_at || null,
      warning,
      // シフト由来の有給はシフト承認で決まる（ここで個別に承認/却下しない）
      actions: fromShift ? null : leaveActions(r.id),
      sortDate: s
    };
  });

  const normAdj = (adjRows || []).map(r => {
    const d = String(r.requestedCheckIn || r.requestedCheckOut || r.created_at || '').slice(0, 10);
    return {
      type: 'adjust',
      category: 'adjust',
      typeLabel: '打刻修正',
      requestId: r.id,
      ...base(r),
      targetDate: d,
      content: `出勤 ${fmtHm(r.requestedCheckIn)} / 退勤 ${fmtHm(r.requestedCheckOut)}`,
      reason: r.reason || '',
      status: r.status,
      processedByName: r.processedByName || null,
      processedAt: r.processed_at || null,
      actions: adjustActions(r.id),
      sortDate: d
    };
  });

  const normShift = shiftRows.map(r => {
    const c = shiftCounts.get(r.userId) || {};
    const parts = [];
    if (Number(c.offDays)) parts.push(`休日 ${Number(c.offDays)}日`);
    if (Number(c.paidDays)) parts.push(`有給 ${Number(c.paidDays)}日`);
    if (Number(c.paidHalfDays)) parts.push(`半休(有給) ${Number(c.paidHalfDays)}日`);
    if (Number(c.otherLeaveDays)) parts.push(`その他休暇 ${Number(c.otherLeaveDays)}日`);
    const st = SHIFT_STATUS[r.status] || 'pending';
    return {
      type: 'shift',
      category: 'shift',
      typeLabel: 'シフト提出',
      requestId: r.id,
      ...base(r),
      targetDate: r.month,
      content: parts.length ? parts.join(' / ') : 'シフト（休日なし）',
      reason: (Number(c.paidDays) || Number(c.paidHalfDays)) ? '承認すると有給も承認されます' : '',
      status: st,
      processedByName: null,
      processedAt: st === 'pending' ? null : (r.updated_at || null),
      actions: shiftActions(r.userId, r.month),
      sortDate: `${r.month}-01`
    };
  });

  const normProfile = profileRows.map(r => {
    let fields = {};
    try { fields = JSON.parse(r.fields_json) || {}; } catch (e) { fields = {}; }
    const content = Object.keys(PROFILE_FIELD_LABEL)
      .filter(k => fields[k] != null && String(fields[k]).trim() !== '')
      .map(k => `${PROFILE_FIELD_LABEL[k]}: ${String(fields[k]).slice(0, 40)}`)
      .join(' / ');
    const d = String(r.created_at || '').slice(0, 10);
    return {
      type: 'profile',
      category: 'profile',
      typeLabel: 'プロフィール変更',
      requestId: r.id,
      ...base(r),
      targetDate: d,
      content: content || '（承認できる項目なし）',
      reason: '',
      status: ['approved', 'rejected'].includes(r.status) ? r.status : 'pending',
      processedByName: r.processedByName || null,
      processedAt: r.approved_at || null,
      actions: profileActions(r.id),
      sortDate: d
    };
  });

  const normOther = otherRows.map(r => {
    const d = String(r.created_at || '').slice(0, 10);
    const st = OTHER_STATUS[String(r.status || '').trim()] || 'pending';
    return {
      type: 'other',
      category: 'other',
      typeLabel: String(r.record_type || 'その他').replace(/^\d+_/, ''),
      requestId: r.id,
      ...base(r),
      targetDate: d,
      content: [r.detail, r.office ? `（${r.office}）` : ''].filter(Boolean).join(' '),
      reason: r.request_no || '',
      status: st,
      processedByName: null,
      processedAt: st === 'pending' ? null : (r.updated_at || null),
      actions: otherActions(r.id),
      sortDate: d
    };
  });

  let all = [...normLeave, ...normAdj, ...normShift, ...normProfile, ...normOther];
  if (status) all = all.filter(r => r.status === status);
  return all.sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? 1 : -1;
    return b.requestId - a.requestId;
  });
}

router.use(authenticate);
router.use(resolveTenant);

router.get('/list', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const dept = req.query?.dept ? String(req.query.dept) : '';
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query?.status || '')) ? String(req.query.status) : '';
    const q = req.query?.q ? String(req.query.q) : '';
    const userId = req.query?.userId ? parseInt(String(req.query.userId), 10) : null;
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query?.pageSize, 10) || 50));

    const allRows = await fetchMerged({ tenantId: req.tenantId, month, dept, userId, q, status: '' });
    const summary = {
      pending: allRows.filter(r => r.status === 'pending').length,
      approved: allRows.filter(r => r.status === 'approved').length,
      rejected: allRows.filter(r => r.status === 'rejected').length,
      // タブのバッジ用: 種別ごとの承認待ち件数
      pendingByCategory: allRows.reduce((acc, r) => {
        if (r.status === 'pending') acc[r.category] = (acc[r.category] || 0) + 1;
        return acc;
      }, {})
    };
    const category = ['leave', 'adjust', 'shift', 'profile', 'other'].includes(String(req.query?.category || '')) ? String(req.query.category) : '';
    const filtered = allRows.filter(r => (!status || r.status === status) && (!category || r.category === category));
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize);

    res.status(200).json({ month, items, total, page, pageSize, summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// その他の申請 (employee_requests: 残業申請・休日申請・通勤交通費) — trước đây không có màn hình duyệt.
router.patch('/other/:id/status', authorize('admin', 'manager'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    const status = String(req.body?.status || '');
    const label = { approved: '承認済み', rejected: '却下', pending: '申請済み' }[status];
    if (!id || !label) return res.status(400).json({ message: 'Missing id/status' });
    const params = [id];
    let tenantSql = '';
    if (req.tenantId) { tenantSql = ' AND u.tenant_id = ?'; params.push(req.tenantId); }
    const [[row] = []] = await db.query(
      `SELECT er.id, er.user_id AS userId, er.record_type, er.status, er.created_at
       FROM employee_requests er JOIN users u ON u.id = er.user_id
       WHERE er.id = ?${tenantSql} LIMIT 1`, params);
    if (!row) return res.status(404).json({ message: 'Not found' });
    if (String(row.userId) === String(req.user?.id) && status === 'approved') {
      return res.status(403).json({ message: '自分の申請は承認できません' });
    }
    await db.query('UPDATE employee_requests SET status = ? WHERE id = ?', [label, id]);
    try {
      await require('../audit/audit.repository').writeLog({
        userId: req.user.id, action: 'employee_request_status', path: req.path, method: req.method, ip: req.ip,
        userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id, status: row.status }), afterData: JSON.stringify({ id, status: label })
      });
    } catch (e) { /* audit は best-effort */ }
    if (status !== 'pending') {
      try {
        const typeLabel = String(row.record_type || '申請').replace(/^\d+_/, '');
        await require('../notices/notices.repository').createNotice({
          targetUserId: row.userId,
          targetDate: null,
          targetMonth: String(row.created_at ? new Date(row.created_at).toISOString() : '').slice(0, 7) || null,
          message: `${typeLabel}が${status === 'approved' ? '承認' : '却下'}されました。`,
          createdBy: req.user?.id || null,
          kind: 'approval',
          title: typeLabel,
          tenantId: req.tenantId || null
        });
      } catch (e) { /* 通知は best-effort */ }
    }
    res.status(200).json({ id, status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/export.csv', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const dept = req.query?.dept ? String(req.query.dept) : '';
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query?.status || '')) ? String(req.query.status) : '';
    const q = req.query?.q ? String(req.query.q) : '';
    const rows = await fetchMerged({ tenantId: req.tenantId, month, dept, q, status });

    const csvEsc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const statusLabel = (s) => s === 'approved' ? '承認' : s === 'rejected' ? '却下' : '申請中';
    const header = '種別,申請者,社員番号,対象日,内容,理由,ステータス,処理者,処理日時\n';
    let csv = header;
    for (const r of rows) {
      csv += [
        csvEsc(r.typeLabel),
        csvEsc(r.applicantName),
        csvEsc(r.employeeCode || ''),
        csvEsc(r.targetDate),
        csvEsc(r.content),
        csvEsc(r.reason),
        csvEsc(statusLabel(r.status)),
        csvEsc(r.processedByName || ''),
        csvEsc(r.processedAt ? String(r.processedAt).slice(0, 16) : '')
      ].join(',') + '\n';
    }
    const filename = `requests_${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send('﻿' + csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
module.exports.fetchMerged = fetchMerged;
