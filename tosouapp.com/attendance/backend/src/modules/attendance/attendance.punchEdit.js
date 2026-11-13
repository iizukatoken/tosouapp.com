/**
 * @module attendance.punchEdit
 * 管理者・マネージャーの「打刻編集」（勤怠記録（日別）・月次勤怠入力 から開くパネル）。
 *
 * 方針（改ざん防止）:
 * - 打刻は「削除」しない。「取消」すると 原本（取消前の値）を attendance_punch_edits に残し、
 *   画面では取り消し線で表示する。「元に戻す」で復元できる。
 * - 修正・取消・追加・復元 はすべて 理由が必須。編集履歴（このテーブル）と 監査ログ（audit_logs）に残し、
 *   本人に通知する。
 * - 自分の打刻は編集できない。マネージャーは 従業員（role=employee）の打刻だけ。
 */
'use strict';

const db = require('../../core/database/mysql');
const auditRepo = require('../audit/audit.repository');
const noticesRepo = require('../notices/notices.repository');
const summaryRepo = require('./attendance.summary.repository');
const { assertMonthWritable } = require('./attendance.utils');
let attendanceHasTenant = null;
async function getAttendanceColumnSet() {
  if (attendanceHasTenant == null) {
    const [cols] = await db.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attendance'");
    attendanceHasTenant = new Set((cols || []).map(r => String(r.c || r.COLUMN_NAME)));
  }
  return attendanceHasTenant;
}

const REASONS = ['本人から誤打刻の連絡', '二重打刻', '打刻機・アプリの不具合', '打刻忘れの申し出', 'その他'];
const ACTION_LABEL = {
  void_out: '退勤の取消', void_row: '打刻の取消', edit_in: '出勤の修正', edit_out: '退勤の修正',
  add: '打刻の追加', restore: '取消の復元'
};

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_punch_edits (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      attendance_id BIGINT UNSIGNED NULL,
      work_date DATE NOT NULL,
      action VARCHAR(16) NOT NULL,
      before_json TEXT NULL,
      after_json TEXT NULL,
      reason VARCHAR(64) NOT NULL,
      reason_note VARCHAR(255) NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      restored_at DATETIME NULL,
      restored_by BIGINT UNSIGNED NULL,
      INDEX idx_ape_user_date (user_id, work_date),
      INDEX idx_ape_tenant_date (tenant_id, work_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  schemaReady = true;
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isHm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const nowJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
const addDay = (ymd, n) => { const t = new Date(`${ymd}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dateOf = (row) => String(row?.checkIn || row?.checkOut || '').slice(0, 10);
const hm = (v) => (v ? String(v).slice(11, 16) : '');

function readReason(body) {
  const reason = String(body?.reason || '').trim();
  const note = String(body?.note || '').trim().slice(0, 255);
  if (!REASONS.includes(reason)) throw httpError(400, '理由を選んでください');
  if (reason === 'その他' && !note) throw httpError(400, '理由が「その他」のときは内容を入力してください');
  return { reason, note: note || null };
}

/** 対象の社員を確認: 同じ会社・自分以外・マネージャーは従業員だけ */
async function assertCanEdit(req, userId) {
  const uid = parseInt(String(userId || ''), 10);
  if (!uid) throw httpError(400, '社員が指定されていません');
  if (String(uid) === String(req.user?.id)) throw httpError(403, '自分の打刻は編集できません（調整申請を使ってください）');
  const params = [uid];
  let sql = 'SELECT id, role, username, tenant_id FROM users WHERE id = ?';
  if (req.tenantId != null) { sql += ' AND tenant_id = ?'; params.push(req.tenantId); }
  const [[u]] = await db.query(sql + ' LIMIT 1', params);
  if (!u) throw httpError(404, '社員が見つかりません');
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'manager' && String(u.role || '').toLowerCase() !== 'employee') throw httpError(403, 'マネージャーは従業員の打刻だけ編集できます');
  return u;
}

async function loadRow(req, attendanceId) {
  const id = parseInt(String(attendanceId || ''), 10);
  if (!id) throw httpError(400, '打刻が指定されていません');
  const [[row]] = await db.query('SELECT * FROM attendance WHERE id = ? LIMIT 1', [id]);
  if (!row) throw httpError(404, '打刻が見つかりません（すでに取消・変更された可能性があります）');
  await assertCanEdit(req, row.userId);
  return row;
}

/** 締めた（承認済みの）月は編集できない */
async function assertOpen(req, userId, workDate) {
  const [y, m] = String(workDate).split('-').map(Number);
  try { await assertMonthWritable(req, userId, y, m); } catch (e) {
    if (Number(e?.status) === 423) throw httpError(423, 'この月は締め済み（承認済み）のため編集できません。先に承認を取り消してください');
    throw e;
  }
}

async function record(req, { userId, attendanceId, workDate, action, before, after, reason, note }) {
  await ensureSchema();
  const [res] = await db.query(
    `INSERT INTO attendance_punch_edits (tenant_id, user_id, attendance_id, work_date, action, before_json, after_json, reason, reason_note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.tenantId ?? null, userId, attendanceId || null, workDate, action,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, note, req.user?.id || null]
  );
  try {
    await auditRepo.writeLog({
      userId: req.user?.id, tenantId: req.tenantId ?? null, action: `punch_${action}`, path: req.originalUrl || req.path, method: req.method,
      ip: req.ip, userAgent: req.headers?.['user-agent'],
      beforeData: JSON.stringify({ targetUserId: userId, date: workDate, ...(before || {}) }),
      afterData: JSON.stringify({ targetUserId: userId, date: workDate, ...(after || {}), reason, note })
    });
  } catch (e) { /* 編集履歴には残っている */ }
  try {
    const [y, m] = workDate.split('-').map(Number);
    await summaryRepo.markDirty(userId, y, m, req.tenantId ?? null);
  } catch (e) { /* 集計は次の更新で直る */ }
  return res.insertId;
}

async function notify(req, userId, workDate, message) {
  try {
    await noticesRepo.createNotice({
      targetUserId: userId, targetDate: workDate, targetMonth: workDate.slice(0, 7),
      message, createdBy: req.user?.id || null, kind: 'approval', title: '打刻の修正', tenantId: req.tenantId ?? null
    });
  } catch (e) { /* 通知が送れなくても編集は有効 */ }
}

/** GET /admin/punches?userId=&date= : その日の打刻と編集履歴 */
async function getDay(req) {
  const date = String(req.query?.date || '').slice(0, 10);
  if (!isDate(date)) throw httpError(400, '日付が正しくありません');
  const u = await assertCanEdit(req, req.query?.userId);
  await ensureSchema();
  const [rows] = await db.query(
    'SELECT * FROM attendance WHERE userId = ? AND DATE(COALESCE(checkIn, checkOut)) = ? ORDER BY COALESCE(checkIn, checkOut), id',
    [u.id, date]
  );
  const [edits] = await db.query(
    `SELECT e.id, e.attendance_id AS attendanceId, e.action, e.before_json, e.after_json, e.reason, e.reason_note AS note,
            e.created_at AS createdAt, e.restored_at AS restoredAt, cu.username AS createdByName, cu.role AS createdByRole
       FROM attendance_punch_edits e LEFT JOIN users cu ON cu.id = e.created_by
      WHERE e.user_id = ? AND e.work_date = ? ORDER BY e.created_at DESC, e.id DESC`,
    [u.id, date]
  );
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  return {
    date,
    user: { id: u.id, username: u.username },
    reasons: REASONS,
    punches: rows.map(r => ({ id: r.id, checkIn: r.checkIn || null, checkOut: r.checkOut || null, inSource: r.in_locationSource || null, outSource: r.out_locationSource || null, extraReason: r.extra_reason || null })),
    edits: edits.map(e => ({
      id: e.id, attendanceId: e.attendanceId, action: e.action, label: ACTION_LABEL[e.action] || e.action,
      before: parse(e.before_json), after: parse(e.after_json), reason: e.reason, note: e.note || '',
      createdAt: e.createdAt, createdByName: e.createdByName || '', createdByRole: e.createdByRole || '',
      restoredAt: e.restoredAt || null
    }))
  };
}

/** POST /admin/punches/void : 退勤の取消（part=out）／打刻の取消（part=row）。原本は残す */
async function voidPunch(req) {
  const { reason, note } = readReason(req.body);
  const row = await loadRow(req, req.body?.attendanceId);
  const workDate = dateOf(row);
  await assertOpen(req, row.userId, workDate);
  let part = String(req.body?.part || '') === 'row' ? 'row' : 'out';
  if (part === 'out' && !row.checkOut) throw httpError(400, 'この打刻には退勤がありません');
  if (part === 'out' && !row.checkIn) part = 'row'; // 出勤のない退勤だけの行は行ごと取消
  if (part === 'out') {
    await db.query('UPDATE attendance SET checkOut = NULL WHERE id = ? AND userId = ?', [row.id, row.userId]);
    const id = await record(req, { userId: row.userId, attendanceId: row.id, workDate, action: 'void_out', before: { checkIn: row.checkIn, checkOut: row.checkOut, outSource: row.out_locationSource || null }, after: { checkIn: row.checkIn, checkOut: null }, reason, note });
    await notify(req, row.userId, workDate, `${workDate.slice(5).replace('-', '/')} の退勤（${hm(row.checkOut)}）は管理者により取り消されました。退勤時にもう一度打刻してください。（理由：${reason}）`);
    return { ok: true, editId: id };
  }
  // 行ごと取消: 行の内容を丸ごと原本として残し、勤怠からは外す（元に戻すで同じ id で復元）
  await db.query('DELETE FROM attendance WHERE id = ? AND userId = ?', [row.id, row.userId]);
  const id = await record(req, { userId: row.userId, attendanceId: row.id, workDate, action: 'void_row', before: { row }, after: null, reason, note });
  await notify(req, row.userId, workDate, `${workDate.slice(5).replace('-', '/')} の打刻（${hm(row.checkIn) || '—'}〜${hm(row.checkOut) || '—'}）は管理者により取り消されました。（理由：${reason}）`);
  return { ok: true, editId: id };
}

/** POST /admin/punches/restore : 取消を元に戻す */
async function restorePunch(req) {
  await ensureSchema();
  const { reason, note } = readReason(req.body);
  const editId = parseInt(String(req.body?.editId || ''), 10);
  const [[e]] = await db.query('SELECT * FROM attendance_punch_edits WHERE id = ? LIMIT 1', [editId]);
  if (!e || !['void_out', 'void_row'].includes(e.action)) throw httpError(404, '取消の記録が見つかりません');
  if (req.tenantId != null && e.tenant_id != null && String(e.tenant_id) !== String(req.tenantId)) throw httpError(404, '取消の記録が見つかりません');
  if (e.restored_at) throw httpError(409, 'すでに元に戻されています');
  await assertCanEdit(req, e.user_id);
  const before = JSON.parse(e.before_json || '{}');
  const workDate = String(e.work_date instanceof Date ? e.work_date.toISOString() : e.work_date).slice(0, 10);
  await assertOpen(req, e.user_id, workDate);
  if (e.action === 'void_out') {
    const [[row]] = await db.query('SELECT id, checkIn, checkOut FROM attendance WHERE id = ? LIMIT 1', [e.attendance_id]);
    if (!row) throw httpError(409, '打刻の行がないため元に戻せません');
    if (row.checkOut) throw httpError(409, `すでに新しい退勤（${hm(row.checkOut)}）があるため元に戻せません。必要なら退勤を修正してください。`);
    await db.query('UPDATE attendance SET checkOut = ? WHERE id = ?', [before.checkOut, row.id]);
  } else {
    const snap = before.row || {};
    const [[exists]] = await db.query('SELECT id FROM attendance WHERE id = ? LIMIT 1', [snap.id]);
    if (exists) throw httpError(409, 'すでに同じ打刻があるため元に戻せません');
    const cols = Object.keys(snap).filter(k => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    if (!cols.length) throw httpError(409, '原本の内容がないため元に戻せません');
    await db.query(`INSERT INTO attendance (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => snap[k]));
  }
  await db.query('UPDATE attendance_punch_edits SET restored_at = ?, restored_by = ? WHERE id = ?', [nowJST(), req.user?.id || null, e.id]);
  const id = await record(req, { userId: e.user_id, attendanceId: e.attendance_id, workDate, action: 'restore', before: null, after: { restoredEditId: e.id, ...(e.action === 'void_out' ? { checkOut: before.checkOut } : { row: before.row }) }, reason, note });
  await notify(req, e.user_id, workDate, `${workDate.slice(5).replace('-', '/')} の取り消された打刻は管理者により元に戻されました。（理由：${reason}）`);
  return { ok: true, editId: id };
}

/** POST /admin/punches/edit : 出勤（part=in）・退勤（part=out）の時刻を修正 */
async function editPunch(req) {
  const { reason, note } = readReason(req.body);
  const row = await loadRow(req, req.body?.attendanceId);
  const part = String(req.body?.part || '') === 'in' ? 'in' : 'out';
  const time = String(req.body?.time || '').trim();
  if (!isHm(time)) throw httpError(400, '時刻を HH:MM で入力してください');
  const workDate = dateOf(row);
  await assertOpen(req, row.userId, workDate);
  const nextDay = part === 'out' && !!req.body?.nextDay;
  const value = `${nextDay ? addDay(workDate, 1) : workDate} ${time}:00`;
  const nextIn = part === 'in' ? value : row.checkIn;
  const nextOut = part === 'out' ? value : row.checkOut;
  if (nextIn && nextOut && String(nextOut) <= String(nextIn)) throw httpError(400, '退勤は出勤より後にしてください（日をまたぐ場合は「翌日」）');
  await db.query(`UPDATE attendance SET ${part === 'in' ? 'checkIn' : 'checkOut'} = ? WHERE id = ? AND userId = ?`, [value, row.id, row.userId]);
  const id = await record(req, { userId: row.userId, attendanceId: row.id, workDate, action: part === 'in' ? 'edit_in' : 'edit_out', before: { checkIn: row.checkIn, checkOut: row.checkOut }, after: { checkIn: nextIn, checkOut: nextOut }, reason, note });
  const old = hm(part === 'in' ? row.checkIn : row.checkOut) || 'なし';
  await notify(req, row.userId, workDate, `${workDate.slice(5).replace('-', '/')} の${part === 'in' ? '出勤' : '退勤'}が管理者により ${old} → ${time} に修正されました。（理由：${reason}）`);
  return { ok: true, editId: id };
}

/** POST /admin/punches/add : 打刻の追加（打刻忘れ）。退勤だけなら、その日のまだ退勤していない行に入れる */
async function addPunch(req) {
  const { reason, note } = readReason(req.body);
  const u = await assertCanEdit(req, req.body?.userId);
  const date = String(req.body?.date || '').slice(0, 10);
  if (!isDate(date)) throw httpError(400, '日付が正しくありません');
  await assertOpen(req, u.id, date);
  const cin = String(req.body?.checkIn || '').trim();
  const cout = String(req.body?.checkOut || '').trim();
  if ((cin && !isHm(cin)) || (cout && !isHm(cout)) || (!cin && !cout)) throw httpError(400, '出勤・退勤の時刻を HH:MM で入力してください');
  const inV = cin ? `${date} ${cin}:00` : null;
  const outV = cout ? `${req.body?.nextDay ? addDay(date, 1) : date} ${cout}:00` : null;
  if (inV && outV && outV <= inV) throw httpError(400, '退勤は出勤より後にしてください（日をまたぐ場合は「翌日」）');
  let attendanceId = null;
  if (!inV) {
    const [[open]] = await db.query('SELECT id, checkIn FROM attendance WHERE userId = ? AND checkIn IS NOT NULL AND checkOut IS NULL AND DATE(checkIn) = ? ORDER BY checkIn DESC LIMIT 1', [u.id, date]);
    if (!open) throw httpError(400, 'この日に退勤前の出勤がありません。出勤も入力してください');
    if (outV <= String(open.checkIn)) throw httpError(400, '退勤は出勤より後にしてください');
    await db.query('UPDATE attendance SET checkOut = ? WHERE id = ?', [outV, open.id]);
    attendanceId = open.id;
  } else {
    const params = [u.id, inV, outV];
    let sql = 'INSERT INTO attendance (userId, checkIn, checkOut';
    if (u.tenant_id != null && (await getAttendanceColumnSet()).has('tenant_id')) { sql += ', tenant_id'; params.push(u.tenant_id); }
    sql += `) VALUES (${params.map(() => '?').join(', ')})`;
    const [res] = await db.query(sql, params);
    attendanceId = res.insertId;
  }
  const id = await record(req, { userId: u.id, attendanceId, workDate: date, action: 'add', before: null, after: { checkIn: inV, checkOut: outV }, reason, note });
  await notify(req, u.id, date, `${date.slice(5).replace('-', '/')} に打刻（${cin || '—'}〜${cout || '—'}）が管理者により追加されました。（理由：${reason}）`);
  return { ok: true, editId: id, attendanceId };
}

/** 画面の ✎ 用: 期間内に管理者が編集した 社員×日 */
async function editedMap({ tenantId = null, userIds = null, from, to }) {
  try {
    await ensureSchema();
    const params = [from, to];
    let sql = 'SELECT user_id AS userId, work_date AS d, action, before_json, after_json, reason, created_at FROM attendance_punch_edits WHERE work_date BETWEEN ? AND ?';
    if (tenantId != null) { sql += ' AND (tenant_id = ? OR tenant_id IS NULL)'; params.push(tenantId); }
    if (Array.isArray(userIds) && userIds.length) { sql += ` AND user_id IN (${userIds.map(() => '?').join(',')})`; params.push(...userIds); }
    sql += ' ORDER BY created_at ASC, id ASC';
    const [rows] = await db.query(sql, params);
    const map = new Map();
    for (const r of rows) {
      const d = String(r.d instanceof Date ? new Date(r.d.getTime() + 9 * 3600 * 1000).toISOString() : r.d).slice(0, 10);
      const key = `${r.userId}|${d}`;
      if (!map.has(key)) map.set(key, []);
      let before = null; let after = null;
      try { before = r.before_json ? JSON.parse(r.before_json) : null; after = r.after_json ? JSON.parse(r.after_json) : null; } catch (e) { /* ignore */ }
      map.get(key).push({ action: r.action, label: ACTION_LABEL[r.action] || r.action, reason: r.reason, before, after });
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

/** ✎ の説明文（例: 「退勤の取消: 08:08（本人から誤打刻の連絡）」） */
function describeEdits(list) {
  return (list || []).map(e => {
    const b = e.before || {}; const a = e.after || {};
    if (e.action === 'void_out') return `退勤 ${hm(b.checkOut)} を取消（${e.reason}）`;
    if (e.action === 'void_row') return `打刻 ${hm(b.row?.checkIn) || '—'}〜${hm(b.row?.checkOut) || '—'} を取消（${e.reason}）`;
    if (e.action === 'edit_in') return `出勤 ${hm(b.checkIn) || 'なし'} → ${hm(a.checkIn)}（${e.reason}）`;
    if (e.action === 'edit_out') return `退勤 ${hm(b.checkOut) || 'なし'} → ${hm(a.checkOut)}（${e.reason}）`;
    if (e.action === 'add') return `打刻を追加 ${hm(a.checkIn) || '—'}〜${hm(a.checkOut) || '—'}（${e.reason}）`;
    if (e.action === 'restore') return `取消を元に戻す（${e.reason}）`;
    return `${e.label}（${e.reason}）`;
  });
}

const wrap = (fn) => async (req, res) => {
  try { res.status(200).json(await fn(req)); } catch (err) { res.status(Number(err?.status || 500)).json({ message: err.message }); }
};

module.exports = {
  REASONS, ACTION_LABEL, ensureSchema, editedMap, describeEdits,
  getDay: wrap(getDay), voidPunch: wrap(voidPunch), restorePunch: wrap(restorePunch), editPunch: wrap(editPunch), addPunch: wrap(addPunch),
  _impl: { getDay, voidPunch, restorePunch, editPunch, addPunch }
};
