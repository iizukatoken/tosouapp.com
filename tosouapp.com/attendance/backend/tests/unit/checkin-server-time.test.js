/**
 * 打刻時刻はサーバーの現在時刻。従業員が API に time を送っても受け付けない。
 * 管理者・マネージャーは従来どおり時刻指定可（代理打刻）。
 */
'use strict';

jest.mock('../../src/modules/attendance/attendance.service', () => ({
  checkIn: jest.fn(async (userId, time) => ({ id: 1, userId, checkIn: '2026-11-12 09:00:00' })),
  checkOut: jest.fn(async (userId, time) => ({ id: 1, userId, checkIn: '2026-11-12 09:00:00', checkOut: '2026-11-12 18:00:00' }))
}));
jest.mock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn(async () => {}) }));
jest.mock('../../src/modules/attendance/attendance.repository', () => ({
  getDaily: jest.fn(async () => null), upsertDaily: jest.fn(async () => {}), setMonthStatus: jest.fn(async () => {})
}));
jest.mock('../../src/modules/users/user.repository', () => ({ getUserById: jest.fn(async () => null) }));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createAdminNotification: jest.fn(async () => {}) }));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({ getMonthStatusValue: jest.fn(async () => 'draft') }));
jest.mock('../../src/modules/attendance/attendance.summary.repository', () => ({ markDirty: jest.fn(async () => {}) }));
jest.mock('../../src/modules/workReports/workReports.repository', () => ({
  listByUserDate: jest.fn(async () => [{}]), create: jest.fn(), setEndTimeByAttendanceId: jest.fn()
}));
jest.mock('../../src/services/shiftReminder.service', () => ({}));

const service = require('../../src/modules/attendance/attendance.service');
const ctrl = require('../../src/modules/attendance/attendance.checkin.controller');

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (role, body) => ({ user: { id: 5, role }, body, headers: {}, path: '/checkin', method: 'POST', ip: '1.1.1.1', tenantId: 1 });

beforeEach(() => jest.clearAllMocks());

describe('打刻時刻はサーバー時刻', () => {
  it('従業員が出勤で time を送ると 400、打刻されない', async () => {
    const r = res();
    await ctrl.checkIn(req('employee', { time: '2026-11-12 07:00:00' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(service.checkIn).not.toHaveBeenCalled();
  });
  it('従業員が退勤で time を送ると 400', async () => {
    const r = res();
    await ctrl.checkOut(req('employee', { time: 1731400000000 }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(service.checkOut).not.toHaveBeenCalled();
  });
  it('従業員の通常の打刻（time なし）は通る', async () => {
    const r = res();
    await ctrl.checkIn(req('employee', { workType: 'onsite' }), r);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(service.checkIn.mock.calls[0][1]).toBeUndefined();
  });
  it('管理者は時刻指定できる（代理打刻）', async () => {
    const r = res();
    await ctrl.checkIn(req('admin', { userId: 9, time: '2026-11-12 08:00:00' }), r);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(service.checkIn.mock.calls[0][1]).toBe('2026-11-12 08:00:00');
  });
});
