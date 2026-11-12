/**
 * 改ざん防止: 従業員は保存済みの出勤・退勤時刻を変更・削除できない（空欄を埋めるのは可）。
 * 管理者・マネージャーは対象外。
 */
'use strict';

jest.mock('../../src/modules/attendance/attendance.repository', () => ({
  getById: jest.fn(), updateTimes: jest.fn(async () => {}), setMonthStatus: jest.fn(async () => {})
}));
jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn(async () => [[]]) }));
jest.mock('../../src/modules/users/user.repository', () => ({ getUserById: jest.fn(async () => null) }));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createAdminNotification: jest.fn(async () => {}) }));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({
  syncPaidLeaveByKubun: jest.fn(), resolveTargetUserId: jest.fn(),
  isEditableMonth: jest.fn(() => true), getMonthStatusValue: jest.fn(async () => 'draft'),
  assertMonthWritable: jest.fn(async () => {})
}));

const repo = require('../../src/modules/attendance/attendance.repository');
const db = require('../../src/core/database/mysql');
const { changesSavedTime, hasSavedTime } = require('../../src/modules/attendance/attendance.punchLock');
const day = require('../../src/modules/attendance/attendance.day.controller');

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (role, extra) => ({ user: { id: 5, role }, tenantId: 1, ...extra });
const PUNCHED = { id: 10, userId: 5, checkIn: '2026-11-12 09:31:27', checkOut: null };

beforeEach(() => { jest.clearAllMocks(); repo.getById.mockResolvedValue({ ...PUNCHED }); });

describe('changesSavedTime', () => {
  it('空欄を埋めるのは変更ではない', () => {
    expect(changesSavedTime(PUNCHED, undefined, '2026-11-12 18:00')).toBe(false);
  });
  it('同じ時刻（秒・T区切りの違い）は変更ではない', () => {
    expect(changesSavedTime(PUNCHED, '2026-11-12T09:31:00', undefined)).toBe(false);
  });
  it('保存済みの時刻を別の時刻にする・消すのは変更', () => {
    expect(changesSavedTime(PUNCHED, '2026-11-12 08:00', undefined)).toBe(true);
    expect(changesSavedTime(PUNCHED, null, undefined)).toBe(true);
  });
  it('hasSavedTime', () => {
    expect(hasSavedTime(PUNCHED)).toBe(true);
    expect(hasSavedTime({ checkIn: null, checkOut: null })).toBe(false);
  });
});

describe('PUT /date/:date（putDay）', () => {
  it('従業員が保存済みの出勤時刻を変えると 403、更新されない', async () => {
    const r = res();
    await day.putDay(req('employee', { params: { date: '2026-11-12' }, body: { attendanceId: 10, checkIn: '2026-11-12 08:00:00' } }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(repo.updateTimes).not.toHaveBeenCalled();
  });
  it('従業員が空欄の退勤を埋めるのは可', async () => {
    const r = res();
    await day.putDay(req('employee', { params: { date: '2026-11-12' }, body: { attendanceId: 10, checkOut: '2026-11-12 18:00:00' } }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(repo.updateTimes).toHaveBeenCalled();
  });
  it('管理者は変更できる', async () => {
    const r = res();
    await day.putDay(req('admin', { params: { date: '2026-11-12' }, body: { attendanceId: 10, checkIn: '2026-11-12 08:00:00' } }), r);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});

describe('DELETE /segment/:id（deleteSegment）', () => {
  it('従業員は時刻の入った行を削除できない', async () => {
    const r = res();
    await day.deleteSegment(req('employee', { params: { id: '10' } }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('管理者は削除できる', async () => {
    const r = res();
    await day.deleteSegment(req('admin', { params: { id: '10' } }), r);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});
