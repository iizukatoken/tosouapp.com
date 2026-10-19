/**
 * 出勤日数 / 休日出勤日数 の数え方 (attendance.dayCount.js)。
 * 月次勤怠画面の当月サマリ・入力用Excel・給与計算 で共通の会社ルール:
 * 半休 = 0.5 日、休日出勤は別に数える、区分未設定でも打刻がある日は数える。
 */
'use strict';

const { classifyDay, countDays } = require('../../src/modules/attendance/attendance.dayCount');

describe('出勤日数の数え方', () => {
  it('出勤 / 代替出勤 / 振替出勤 は 1 日', () => {
    for (const k of ['出勤', '代替出勤', '振替出勤']) expect(classifyDay({ kubun: k })).toEqual({ attend: 1, holidayWork: 0 });
  });
  it('半休 / 半休(有給) は 0.5 日', () => {
    expect(classifyDay({ kubun: '半休', hasActual: true })).toEqual({ attend: 0.5, holidayWork: 0 });
    expect(classifyDay({ kubun: '半休(有給)' })).toEqual({ attend: 0.5, holidayWork: 0 });
  });
  it('休日出勤 は 出勤日数 に入れず 休日出勤日数 で 1 日', () => {
    expect(classifyDay({ kubun: '休日出勤', hasActual: true, isOffDay: true })).toEqual({ attend: 0, holidayWork: 1 });
  });
  it('区分未設定で打刻あり: 平日 → 出勤、休日 → 休日出勤', () => {
    expect(classifyDay({ hasActual: true, isOffDay: false })).toEqual({ attend: 1, holidayWork: 0 });
    expect(classifyDay({ hasActual: true, isOffDay: true })).toEqual({ attend: 0, holidayWork: 1 });
  });
  it('パートは休日に打刻しても 出勤 (休日も同じ時給)', () => {
    expect(classifyDay({ hasActual: true, isOffDay: true, isPartTime: true })).toEqual({ attend: 1, holidayWork: 0 });
  });
  it('有給休暇・休日・欠勤 は打刻があっても数えない', () => {
    for (const k of ['有給休暇', '休日', '欠勤', '代替休日', '無給休暇']) {
      expect(classifyDay({ kubun: k, hasActual: true })).toEqual({ attend: 0, holidayWork: 0 });
    }
  });
  it('区分なし・打刻なしの日は数えない', () => {
    expect(classifyDay({ isOffDay: false })).toEqual({ attend: 0, holidayWork: 0 });
  });
  it('1か月の集計: 出勤 18 + 半休 1 + 休日出勤 2', () => {
    const days = [
      ...Array.from({ length: 17 }, () => ({ kubun: '出勤', hasActual: true })),
      { kubun: '', hasActual: true },               // 区分未設定の平日 → 出勤
      { kubun: '半休', hasActual: true },
      { kubun: '休日出勤', hasActual: true, isOffDay: true },
      { kubun: '', hasActual: true, isOffDay: true }, // 区分未設定の休日 → 休日出勤
      { kubun: '有給休暇' },
      { kubun: '休日', isOffDay: true },
    ];
    expect(countDays(days)).toEqual({ attendDays: 18.5, holidayWorkDays: 2 });
  });
});
