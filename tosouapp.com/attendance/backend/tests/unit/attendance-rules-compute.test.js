/**
 * attendance.rules.js (サーバー側の勤怠計算 = 給与・台帳・月次API の元) のテスト。
 * - 退勤が出勤より前の不正データが1件あっても、月全体の計算を止めない
 * - 会社の丸めルール (出勤は30分切り上げ、退勤は30分切り捨て) を固定する
 * DB は使わない (repository をモック)。
 */
'use strict';

jest.mock('../../src/modules/settings/settings.repository', () => ({ getSettings: jest.fn().mockResolvedValue({ breakMinutes: 60 }) }));
jest.mock('../../src/modules/users/user.repository', () => ({
  getUserById: jest.fn().mockResolvedValue({ id: 23, employment_type: 'full_time', departmentId: null }),
  getDepartmentById: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/modules/attendance/attendance.repository', () => ({
  getShiftById: jest.fn().mockResolvedValue({ id: 1, name: 'day_8_17', start_time: '08:00', end_time: '17:00', break_minutes: 60 }),
  getGoOutRecordsByMonth: jest.fn().mockResolvedValue([]),
  listDailyBetween: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/modules/calendar/calendar.repository', () => ({ computeYear: jest.fn().mockResolvedValue({ off_days: [] }) }));

const { computeRange } = require('../../src/modules/attendance/attendance.rules');

const row = (id, checkIn, checkOut) => ({ id, userId: 23, shiftId: 1, checkIn, checkOut, work_type: 'onsite' });

describe('サーバー側の勤怠計算', () => {
  it('退勤が出勤より前の行があっても、月の他の日は計算される (以前は月全体が 500 エラー)', async () => {
    const res = await computeRange([
      row(1, '2026-09-29 08:00:00', '2026-09-29 17:00:00'),
      row(2, '2026-09-30 14:15:00', '2026-09-30 12:00:00'),
    ], 1);
    const d29 = res.days.find((d) => d.date === '2026-09-29');
    const d30 = res.days.find((d) => d.date === '2026-09-30');
    expect(d29.regularMinutes).toBe(480);
    expect(d30.regularMinutes + d30.overtimeMinutes).toBe(0);
    expect(d30.items[0].isAnomaly).toBe(true);
    expect(d30.items[0].anomalyType).toBe('CHECKOUT_BEFORE_CHECKIN');
    expect(res.total.regularMinutes).toBe(480);
  });

  describe('会社の丸めルール (出勤30分切り上げ・退勤30分切り捨て) は変えない', () => {
    it('08:01〜17:29 → 08:30〜17:00 で 実働 7:30', async () => {
      const res = await computeRange([row(1, '2026-09-29 08:01:00', '2026-09-29 17:29:00')], 1);
      const it = res.days[0].items[0];
      expect(it.roundedIn).toBe('08:30');
      expect(it.roundedOut).toBe('17:00');
      expect(it.regularMinutes + it.overtimeMinutes).toBe(450);
    });

    it('08:00〜18:45 → 残業は 1:30 (定時後 1:45 を30分切り捨て)', async () => {
      const res = await computeRange([row(1, '2026-09-29 08:00:00', '2026-09-29 18:45:00')], 1);
      const it = res.days[0].items[0];
      expect(it.roundedOut).toBe('18:30');
      expect(it.regularMinutes).toBe(480);
      expect(it.overtimeMinutes).toBe(90);
    });

    it('早出 07:00〜17:00 は早出分も実働に含める (実働 9:00 = 所定 8:00 + 残業 1:00)', async () => {
      const res = await computeRange([row(1, '2026-09-29 07:00:00', '2026-09-29 17:00:00')], 1);
      const it = res.days[0].items[0];
      expect(it.regularMinutes).toBe(480);
      expect(it.overtimeMinutes).toBe(60);
    });
  });
});
