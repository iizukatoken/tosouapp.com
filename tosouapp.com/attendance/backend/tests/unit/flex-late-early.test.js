/**
 * フレックス勤務（社員管理で社員ごとに設定）: 遅刻・早退を表示しない。
 * 表示だけの処理で、保存済みのデータは変更しない。DBはモック。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const db = require('../../src/core/database/mysql');
const { suppressHolidayWorkLateEarly, isFlexUser } = require('../../src/modules/attendance/attendance.utils');
const userRepo = require('../../src/modules/users/user.repository');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[]]);
});

describe('isFlexUser', () => {
  it('is_flex = 1 の社員だけ true', () => {
    expect(isFlexUser({ is_flex: 1 })).toBe(true);
    expect(isFlexUser({ is_flex: 0 })).toBe(false);
    expect(isFlexUser({})).toBe(false);
    expect(isFlexUser(null)).toBe(false);
  });
});

describe('suppressHolidayWorkLateEarly（勤怠記録・集計・エクスポートが使う）', () => {
  it('フレックスの社員は平日でも 遅刻・早退 を 0 にし、他の社員はそのまま', async () => {
    // users の取得だけ返す（休日カレンダーは空 = 平日）
    db.query.mockImplementation(async (sql) => {
      if (/FROM users WHERE id IN/.test(sql)) {
        expect(sql).toContain('is_flex');
        return [[
          { id: 1, departmentId: 2, employment_type: 'full_time', is_flex: 1 },
          { id: 2, departmentId: 2, employment_type: 'full_time', is_flex: 0 }
        ]];
      }
      return [[]];
    });
    const rows = [
      { userId: 1, date: '2026-11-11', kubun: '出勤', late_minutes: 30, early_minutes: 15 },
      { userId: 2, date: '2026-11-11', kubun: '出勤', late_minutes: 30, early_minutes: 15 }
    ];
    await suppressHolidayWorkLateEarly(rows, 1);
    expect(rows[0]).toMatchObject({ late_minutes: 0, early_minutes: 0 });
    expect(rows[1]).toMatchObject({ late_minutes: 30, early_minutes: 15 });
  });
});

describe('user.repository: is_flex の保存', () => {
  it('チェックを送ったときだけ is_flex を更新する（他の更新では今の値のまま）', async () => {
    await userRepo.updateUser(5, { username: 'a', isFlex: 1, tenantId: 1 });
    const flexCall = db.query.mock.calls.find(([sql]) => /SET is_flex = \?/.test(sql));
    expect(flexCall).toBeTruthy();
    expect(flexCall[1][0]).toBe(1);

    db.query.mockClear();
    await userRepo.updateUser(5, { username: 'a', tenantId: 1 });
    expect(db.query.mock.calls.some(([sql]) => /is_flex/.test(sql))).toBe(false);

    db.query.mockClear();
    await userRepo.updateUser(5, { username: 'a', isFlex: 0, tenantId: 1 });
    const off = db.query.mock.calls.find(([sql]) => /SET is_flex = \?/.test(sql));
    expect(off[1][0]).toBe(0);
  });
});
