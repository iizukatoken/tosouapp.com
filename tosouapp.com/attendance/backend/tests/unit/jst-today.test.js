/**
 * 「今日」の日付が日本時間で決まることのテスト。
 * サーバー (Render) は UTC で動くため、new Date().toISOString() だと
 * 日本時間 0:00〜9:00 の間は前日の日付になっていた。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const db = require('../../src/core/database/mysql');
const userRepo = require('../../src/modules/users/user.repository');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([{ insertId: 1 }]);
  // 2026-10-17 20:00 UTC = 2026-10-18 05:00 JST
  jest.useFakeTimers({ now: new Date('2026-10-17T20:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
});

afterEach(() => jest.useRealTimers());

describe('日本時間の「今日」', () => {
  it('入社日を省略して社員を作成すると、日本時間の今日 (10/18) が入る', async () => {
    await userRepo.createUser({ username: 'テスト', email: 't@example.com', password: 'x', tenantId: 1 });
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO users/i.test(String(sql)));
    expect(insert).toBeDefined();
    const params = insert[1];
    expect(params).toContain('2026-10-18');
    expect(params).not.toContain('2026-10-17');
  });
});
