/**
 * @module attendance.punchLock
 * 改ざん防止: 従業員は、保存済みの出勤・退勤時刻を自分で変更・削除できない。
 * - 空欄（未打刻）を埋めるのは可（打刻忘れの日の入力）
 * - 保存済みの時刻を別の時刻にする・消す・その行を削除する → 不可（調整申請 → 管理者が修正）
 * - 管理者・マネージャーは対象外
 * 画面でも入力欄はロックしているが、API を直接呼ばれても守れるようにサーバーでも判定する。
 */
'use strict';

const LOCK_MESSAGE = '保存済みの出勤・退勤時刻は変更・削除できません。修正は調整申請から依頼してください。';

const isEmployee = (req) => String(req?.user?.role || '').toLowerCase() === 'employee';

// "YYYY-MM-DD HH:MM" に揃えて比較（秒・T区切り・Date の違いは無視）
function norm(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return new Date(v.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
  return String(v).trim().replace('T', ' ').slice(0, 16);
}

/**
 * 保存済みの時刻を変える・消す変更か。
 * @param {{checkIn?:any, checkOut?:any}} current - DB の行
 * @param {any} nextIn - 新しい出勤（undefined = 送られていない → 変更なし）
 * @param {any} nextOut - 新しい退勤（同上）
 */
function changesSavedTime(current, nextIn, nextOut) {
  const curIn = norm(current?.checkIn);
  const curOut = norm(current?.checkOut);
  if (typeof nextIn !== 'undefined' && curIn && norm(nextIn) !== curIn) return true;
  if (typeof nextOut !== 'undefined' && curOut && norm(nextOut) !== curOut) return true;
  return false;
}

const hasSavedTime = (row) => !!(norm(row?.checkIn) || norm(row?.checkOut));

function lockedError() {
  const e = new Error(LOCK_MESSAGE);
  e.status = 403;
  return e;
}

module.exports = { isEmployee, changesSavedTime, hasSavedTime, lockedError, LOCK_MESSAGE, norm };
