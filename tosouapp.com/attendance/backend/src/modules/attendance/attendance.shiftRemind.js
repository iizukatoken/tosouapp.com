/**
 * @module attendance.shiftRemind
 * 月次勤怠入力「予定」タブ: シフト未提出の社員に 管理者・マネージャー が「催促する」（本人に通知）。
 */
'use strict';

const db = require('../../core/database/mysql');
const auditRepo = require('../audit/audit.repository');
const noticesRepo = require('../notices/notices.repository');

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function remind(req) {
  const uid = parseInt(String(req.body?.userId || ''), 10);
  const month = String(req.body?.month || '').slice(0, 7);
  if (!uid) throw httpError(400, '社員が指定されていません');
  if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, '月が正しくありません');
  if (String(uid) === String(req.user?.id)) throw httpError(400, '自分には催促できません');
  const params = [uid];
  let sql = 'SELECT id, role, username FROM users WHERE id = ?';
  if (req.tenantId != null) { sql += ' AND tenant_id = ?'; params.push(req.tenantId); }
  const [[u]] = await db.query(sql + ' LIMIT 1', params);
  if (!u) throw httpError(404, '社員が見つかりません');
  if (String(req.user?.role || '').toLowerCase() === 'manager' && String(u.role || '').toLowerCase() !== 'employee') {
    throw httpError(403, 'マネージャーは従業員にだけ催促できます');
  }
  const [[sub]] = await db.query('SELECT status FROM shift_month_status WHERE userId = ? AND month = ? LIMIT 1', [uid, month]).catch(() => [[null]]);
  if (sub && sub.status && sub.status !== 'REJECTED') throw httpError(409, 'この月のシフトはすでに提出されています');
  const m = Number(month.slice(5, 7));
  await noticesRepo.createNotice({
    targetUserId: uid, targetDate: null, targetMonth: month,
    message: `${m}月のシフトがまだ提出されていません。シフト画面から提出してください。`,
    createdBy: req.user?.id || null, kind: 'shift', title: 'シフト提出のお願い', tenantId: req.tenantId ?? null
  });
  try {
    await auditRepo.writeLog({
      userId: req.user?.id, tenantId: req.tenantId ?? null, action: 'shift_remind', path: req.originalUrl || req.path, method: req.method,
      ip: req.ip, userAgent: req.headers?.['user-agent'], beforeData: null, afterData: JSON.stringify({ targetUserId: uid, month })
    });
  } catch (e) { /* 通知は送れている */ }
  return { ok: true };
}

module.exports = {
  remind: async (req, res) => {
    try { res.status(200).json(await remind(req)); } catch (err) { res.status(Number(err?.status || 500)).json({ message: err.message }); }
  },
  _impl: { remind }
};
