/**
 * 月次詳細API: 休みの日（打刻なし・区分なし）は、その日が終わってから（翌日以降）自動で 休日（autoOff=1）。
 * 今日・これからの休みは 休日予定 のまま（autoOff=0）。DBと各リポジトリはモック。
 */
'use strict';

const auto = () => new Proxy({}, {
  get: (t, k) => {
    if (k === '__esModule') return false;
    if (!t[k]) t[k] = jest.fn(async () => []);
    return t[k];
  }
});
jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn(async () => [[]]) }));
jest.mock('../../src/modules/attendance/attendance.repository', () => auto());
jest.mock('../../src/modules/workReports/workReports.repository', () => auto());
jest.mock('../../src/modules/leave/leave.repository', () => auto());
jest.mock('../../src/modules/users/user.repository', () => ({
  getUserById: jest.fn(async () => ({ id: 10, username: 'emp', employment_type: 'full_time', departmentId: 2, tenant_id: 1 }))
}));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({
  resolveTargetUserId: jest.fn(async () => 10),
  // 11/01(日) 11/03(祝) 11/08(日) 11/15(日) が休み
  getUserOffDaySet: jest.fn(async () => new Set(['2026-11-01', '2026-11-03', '2026-11-08', '2026-11-15'])),
  resolveDefaultApproverName: jest.fn(async () => '')
}));

const repo = require('../../src/modules/attendance/attendance.repository');
const { getMonthDetail } = require('../../src/modules/attendance/attendance.monthdetail.controller');

const call = async () => {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await getMonthDetail({ query: { year: '2026', month: '11' }, user: { id: 10, role: 'employee' }, tenantId: 1 }, res);
  return res;
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-11T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }); // JST 11/11 12:00
  repo.getMonthStatus.mockResolvedValue(null);
  repo.getMonthSummary.mockResolvedValue(null);
});
afterEach(() => jest.useRealTimers());

describe('getMonthDetail autoOff（休日予定 → 休日）', () => {
  it('終わった休みの日は autoOff=1、今日・これからは 0', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    const byDate = Object.fromEntries(res.body.days.map(d => [d.date, d]));
    expect(byDate['2026-11-01'].autoOff).toBe(1);
    expect(byDate['2026-11-03'].autoOff).toBe(1);
    expect(byDate['2026-11-08'].autoOff).toBe(1);
    expect(byDate['2026-11-15'].autoOff).toBe(0); // これからの休み
    expect(byDate['2026-11-10'].autoOff).toBe(0); // 平日（休みではない）
  });

  it('今日が休みの日なら、今日はまだ 休日予定（autoOff=0）', async () => {
    const utils = require('../../src/modules/attendance/attendance.utils');
    utils.getUserOffDaySet.mockResolvedValueOnce(new Set(['2026-11-11']));
    const res = await call();
    const today = res.body.days.find(d => d.date === '2026-11-11');
    expect(today.is_off).toBe(1);
    expect(today.autoOff).toBe(0);
  });
});
