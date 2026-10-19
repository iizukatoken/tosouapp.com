/**
 * 調整申請の作成 (POST /api/adjust) のテスト。
 * 過去の日で 退勤 が打刻されていないのに、申請に 退勤 が無い場合は受け付けない
 * (フォームが既存の出勤時刻を自動入力するため、退勤を入れ忘れて送信 → 承認しても退勤が空のまま、が多発していた)。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/adjust/adjust.repository', () => ({ create: jest.fn().mockResolvedValue(101), getById: jest.fn(), updateFields: jest.fn(), updateStatus: jest.fn() }));
jest.mock('../../src/modules/attendance/attendance.repository', () => ({}));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createAdminNotification: jest.fn(), createNotice: jest.fn() }));
jest.mock('../../src/modules/attendance/attendance.summary.repository', () => ({ markDirty: jest.fn() }));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({ isHolidayWorkDay: jest.fn(), getUserOffDaySet: jest.fn() }));

const db = require('../../src/core/database/mysql');
const repo = require('../../src/modules/adjust/adjust.repository');
const { create, updateByActor } = require('../../src/modules/adjust/adjust.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const employee = { id: 19, role: 'employee', username: '中野' };

beforeEach(() => {
  jest.clearAllMocks();
  // 今日 = 2026-10-19 (JST)
  jest.useFakeTimers({ now: new Date('2026-10-19T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => jest.useRealTimers());

describe('調整申請: 退勤忘れの日は 退勤 が必須', () => {
  it('過去の日・退勤なしの勤怠に、出勤だけの申請 → 400 で受け付けない', async () => {
    db.query.mockResolvedValueOnce([[{ checkOut: null }]]);
    const res = mockRes();
    await create({ user: employee, tenantId: 1, body: { attendanceId: 5, requestedCheckIn: '2026-08-01 08:00:00', reason: '打刻し忘れ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toContain('退勤時刻を入力してください');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('退勤を入れた申請は受け付ける', async () => {
    const res = mockRes();
    await create({ user: employee, tenantId: 1, body: { attendanceId: 5, requestedCheckIn: '2026-08-01 08:00:00', requestedCheckOut: '2026-08-01 17:00:00', reason: '打刻し忘れ' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.create).toHaveBeenCalled();
  });

  it('退勤は打刻済みで、出勤だけ直す申請は受け付ける', async () => {
    db.query.mockResolvedValueOnce([[{ checkOut: '2026-08-01 17:00:00' }]]);
    const res = mockRes();
    await create({ user: employee, tenantId: 1, body: { attendanceId: 5, requestedCheckIn: '2026-08-01 08:00:00', reason: '出勤時刻の修正' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('今日の出勤だけの申請は受け付ける (まだ勤務中の可能性がある)', async () => {
    const res = mockRes();
    await create({ user: employee, tenantId: 1, body: { requestedCheckIn: '2026-10-19 08:00:00', reason: '打刻し忘れ' } }, res);
    expect(db.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('差戻し後に本人が出勤だけで再申請 → 400', async () => {
    repo.getById.mockResolvedValue({ id: 7, userId: 19, attendanceId: 5, status: 'rejected' });
    db.query.mockResolvedValueOnce([[{ checkOut: null }]]);
    const res = mockRes();
    await updateByActor({ user: employee, tenantId: 1, params: { id: '7' }, body: { requestedCheckIn: '2026-08-01 08:00:00', reason: '打刻し忘れ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(repo.updateFields).not.toHaveBeenCalled();
  });
});
