/**
 * @module attendance.monthStamp
 * 月次勤怠入力の「自動更新」用: その社員・その月のデータが変わったかを表す短い値（指紋）を返す。
 * 画面は 20秒ごとに聞き、値が変われば最新を読み直す（管理者の打刻編集・承認・保存などが すぐ本人の画面に出る）。
 * 重い集計はしない（打刻・日別・月の状態・申請 の件数と更新の印だけ）。
 */
'use strict';

const crypto = require('crypto');
const db = require('../../core/database/mysql');
const { resolveTargetUserId } = require('./attendance.utils');

const pad = (n) => String(n).padStart(2, '0');

async function stampFor(userId, y, m) {
  const from = `${y}-${pad(m)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${pad(m)}-${pad(last)}`;
  const parts = [];
  const q = async (sql, params) => {
    try { const [[r]] = await db.query(sql, params); parts.push(JSON.stringify(r || null)); } catch (e) { parts.push('-'); }
  };
  // 打刻（時刻・区分・作業内容などが変わると値が変わる）
  await q(`SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, checkIn, checkOut, work_type, location, memo, notes, break_minutes))), 0) AS h
             FROM attendance WHERE userId = ? AND DATE(COALESCE(checkIn, checkOut)) BETWEEN ? AND ?`, [userId, from, to]);
  // 日別（区分・理由・備考・遅刻など）
  await q(`SELECT COUNT(*) AS n, MAX(updated_at) AS u,
                  COALESCE(SUM(CRC32(CONCAT_WS('|', date, kubun, reason, notes, memo, work_type, late_minutes, early_minutes, break_minutes, status))), 0) AS h
             FROM attendance_daily WHERE userId = ? AND date BETWEEN ? AND ?`, [userId, from, to]);
  // 月の状態（提出・承認・差戻し）
  await q('SELECT * FROM attendance_month_status WHERE userId = ? AND year = ? AND month = ? LIMIT 1', [userId, y, m]);
  // 管理者の打刻編集・調整申請・休暇・シフト
  await q('SELECT COUNT(*) AS n, MAX(created_at) AS c, COUNT(restored_at) AS r FROM attendance_punch_edits WHERE user_id = ? AND work_date BETWEEN ? AND ?', [userId, from, to]);
  await q(`SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, status))), 0) AS h FROM time_adjust_requests
            WHERE userId = ? AND DATE(COALESCE(requestedCheckIn, requestedCheckOut, created_at)) BETWEEN ? AND ?`, [userId, from, to]);
  await q(`SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, status, type))), 0) AS h FROM leave_requests
            WHERE userId = ? AND startDate <= ? AND endDate >= ?`, [userId, to, from]);
  await q('SELECT status FROM shift_month_status WHERE userId = ? AND month = ? LIMIT 1', [userId, `${y}-${pad(m)}`]);
  await q(`SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', date, status, leaveType))), 0) AS h FROM shift_requests
            WHERE userId = ? AND date BETWEEN ? AND ?`, [userId, from, to]);
  return crypto.createHash('sha1').update(parts.join('#')).digest('hex').slice(0, 16);
}

/** GET /month/stamp?year=&month=&userId= */
async function getStamp(req, res) {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const y = parseInt(String(req.query?.year || ''), 10);
    const m = parseInt(String(req.query?.month || ''), 10);
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ message: 'Missing year/month' });
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ stamp: await stampFor(userId, y, m) });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
}

module.exports = { getStamp, _stampFor: stampFor };
