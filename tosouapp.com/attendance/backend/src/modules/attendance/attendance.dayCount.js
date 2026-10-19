'use strict';
// 出勤日数 / 休日出勤日数 の数え方 — 月次勤怠画面の 当月サマリ・入力用Excel・給与計算 で共通 (会社ルール, 2026-10):
//   - 半休 / 半休(有給)                         → 出勤 0.5 日
//   - 出勤 / 代替出勤 / 振替出勤                 → 出勤 1 日
//   - 休日出勤 / 法定休日出勤                    → 休日出勤 1 日 (出勤日数には入れない)
//   - 区分未設定で打刻あり: 休日 (部署の休日設定) → 休日出勤 1 日 (パートは 出勤 1 日 — 休日も同じ時給のため)
//                         平日                  → 出勤 1 日
//   - それ以外 (有給休暇・休日・欠勤 など) は数えない (打刻があっても — 画面で「〜なのに打刻あり」警告)

const HALF_DAY = new Set(['半休', '半休(有給)']);
const FULL_WORK = new Set(['出勤', '代替出勤', '振替出勤']);
const HOLIDAY_WORK = new Set(['休日出勤', '法定休日出勤']);

/**
 * @param {{ kubun?: string|null, hasActual?: boolean, isOffDay?: boolean, isPartTime?: boolean }} day
 * @returns {{ attend: number, holidayWork: number }}
 */
function classifyDay({ kubun, hasActual = false, isOffDay = false, isPartTime = false } = {}) {
  const k = String(kubun || '').trim();
  if (HOLIDAY_WORK.has(k)) return { attend: 0, holidayWork: 1 };
  if (HALF_DAY.has(k)) return { attend: 0.5, holidayWork: 0 };
  if (FULL_WORK.has(k)) return { attend: 1, holidayWork: 0 };
  if (!k && hasActual) {
    if (isOffDay && !isPartTime) return { attend: 0, holidayWork: 1 };
    return { attend: 1, holidayWork: 0 };
  }
  return { attend: 0, holidayWork: 0 };
}

/**
 * @param {Array<{ kubun?: string|null, hasActual?: boolean, isOffDay?: boolean }>} days — mỗi ngày trong tháng 1 phần tử
 * @param {{ isPartTime?: boolean }} [opts]
 * @returns {{ attendDays: number, holidayWorkDays: number }}
 */
function countDays(days, { isPartTime = false } = {}) {
  let attendDays = 0;
  let holidayWorkDays = 0;
  for (const d of days || []) {
    const c = classifyDay({ ...d, isPartTime });
    attendDays += c.attend;
    holidayWorkDays += c.holidayWork;
  }
  return { attendDays, holidayWorkDays };
}

module.exports = { classifyDay, countDays };
