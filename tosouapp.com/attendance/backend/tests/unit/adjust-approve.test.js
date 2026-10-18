/**
 * 調整申請の承認 (PATCH /api/adjust/:id/status) のテスト。
 * - 勤怠への反映に失敗したら承認しない (承認済みなのに勤怠が変わらない状態を作らない)
 * - 既に承認済みの申請は二重に承認しない
 * - manager は自分の申請・employee 以外の申請を処理できない
 * DB と各 repository はモックし、実DBは使わない。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/adjust/adjust.repository', () => ({
  getById: jest.fn(),
  updateStatus: jest.fn(),
  claimApproval: jest.fn(),
  restoreStatus: jest.fn(),
  addMessage: jest.fn()
}));
jest.mock('../../src/modules/attendance/attendance.repository', () => ({
  bulkUpsertAttendance: jest.fn(),
  listShiftDefinitions: jest.fn().mockResolvedValue([]),
  listShiftAssignmentsBetween: jest.fn().mockResolvedValue([])
}));
jest.mock('../../src/modules/notices/notices.repository', () => ({
  createNotice: jest.fn(),
  createAdminNotification: jest.fn()
}));
jest.mock('../../src/modules/attendance/attendance.summary.repository', () => ({ markDirty: jest.fn() }));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({
  isHolidayWorkDay: jest.fn().mockReturnValue(false),
  getUserOffDaySet: jest.fn().mockResolvedValue(new Set())
}));

const db = require('../../src/core/database/mysql');
const repo = require('../../src/modules/adjust/adjust.repository');
const attendanceRepo = require('../../src/modules/attendance/attendance.repository');
const { updateStatus } = require('../../src/modules/adjust/adjust.controller');

const pendingRow = {
  id: 7, userId: 20, attendanceId: null, status: 'pending', admin_note: null,
  processed_by: null, processed_at: null,
  requestedCheckIn: '2026-10-16 08:50:00', requestedCheckOut: '2026-10-16 17:00:00'
};

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
function makeReq({ role = 'admin', userId = 1, status = 'approved', adminNote = '' } = {}) {
  return { params: { id: '7' }, body: { status, adminNote }, tenantId: 1, user: { id: userId, role } };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[]]);
  repo.getById.mockResolvedValue({ ...pendingRow });
  repo.claimApproval.mockResolvedValue(1);
});

describe('調整申請の承認', () => {
  it('勤怠に反映できたら承認する', async () => {
    attendanceRepo.bulkUpsertAttendance.mockResolvedValue({});
    const res = mockRes();
    await updateStatus(makeReq(), res);
    expect(repo.claimApproval).toHaveBeenCalledWith('7', 1, 1);
    expect(attendanceRepo.bulkUpsertAttendance).toHaveBeenCalled();
    expect(repo.restoreStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].applied.ok).toBe(true);
  });

  it('勤怠への反映に失敗したら承認前の状態に戻し、422 を返す', async () => {
    attendanceRepo.bulkUpsertAttendance.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await updateStatus(makeReq(), res);
    expect(repo.restoreStatus).toHaveBeenCalledWith('7', expect.objectContaining({ status: 'pending' }), 1);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].message).toContain('DB down');
  });

  it('退勤のみの申請で対象の勤怠が無ければ承認しない', async () => {
    repo.getById.mockResolvedValue({ ...pendingRow, requestedCheckIn: null });
    const res = mockRes();
    await updateStatus(makeReq(), res);
    expect(repo.restoreStatus).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('既に承認済みの申請は二重に承認しない (勤怠を書き換えない)', async () => {
    repo.claimApproval.mockResolvedValue(0);
    const res = mockRes();
    await updateStatus(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(attendanceRepo.bulkUpsertAttendance).not.toHaveBeenCalled();
  });

  it('存在しない申請は 404', async () => {
    repo.getById.mockResolvedValue(undefined);
    const res = mockRes();
    await updateStatus(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(repo.claimApproval).not.toHaveBeenCalled();
  });

  it('manager は自分の申請を承認できない', async () => {
    repo.getById.mockResolvedValue({ ...pendingRow, userId: 5 });
    const res = mockRes();
    await updateStatus(makeReq({ role: 'manager', userId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(repo.claimApproval).not.toHaveBeenCalled();
  });

  it('manager は employee 以外 (他の manager 等) の申請を処理できない', async () => {
    db.query.mockResolvedValueOnce([[{ role: 'manager' }]]);
    const res = mockRes();
    await updateStatus(makeReq({ role: 'manager', userId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(repo.claimApproval).not.toHaveBeenCalled();
  });

  it('差戻しは従来どおり updateStatus で処理する', async () => {
    const res = mockRes();
    await updateStatus(makeReq({ status: 'rejected', adminNote: '時刻が違います' }), res);
    expect(repo.updateStatus).toHaveBeenCalledWith('7', 'rejected', '時刻が違います', 1, 1);
    expect(repo.claimApproval).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
