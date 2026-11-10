/**
 * シフト承認 = 有給承認 / 月次表の休暇区分 = 承認待ちの申請 (2026-11)。
 * DB はモック、実DBは使わない。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const db = require('../../src/core/database/mysql');
const repo = require('../../src/modules/leave/leave.repository');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([{ affectedRows: 0, insertId: 0 }]);
});

describe('syncShiftPaidLeaves', () => {
  it('APPROVED: 申請がない有給日は from_shift で作って承認、ほかの日の from_shift は却下', async () => {
    jest.spyOn(repo, 'findExactRequest').mockResolvedValue(null);
    jest.spyOn(repo, 'create').mockResolvedValue(55);
    jest.spyOn(repo, 'updateStatus').mockResolvedValue();
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const r = await repo.syncShiftPaidLeaves({ userId: 10, month: '2026-09', paidDays: [{ date: '2026-09-08', type: 'paid' }], shiftStatus: 'APPROVED', approverId: 1, tenantId: 1 });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 10, startDate: '2026-09-08', type: 'paid', reason: 'from_shift' }));
    expect(repo.updateStatus).toHaveBeenCalledWith(55, 'approved', 1, 1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SHIFT_CHANGED/);
    expect(sql).toMatch(/NOT IN \(\?\)/);
    expect(params).toContain('2026-09-08|paid');
    expect(r).toEqual({ approved: 1, rejected: 1, reopened: 0 });
  });

  it('APPROVED: 本人が出した承認待ちの有給申請はそのまま承認、承認済みは触らない', async () => {
    jest.spyOn(repo, 'findExactRequest')
      .mockResolvedValueOnce({ id: 7, status: 'pending' })
      .mockResolvedValueOnce({ id: 8, status: 'approved' });
    jest.spyOn(repo, 'create').mockResolvedValue(0);
    jest.spyOn(repo, 'updateStatus').mockResolvedValue();

    await repo.syncShiftPaidLeaves({ userId: 10, month: '2026-09', paidDays: [{ date: '2026-09-08', type: 'paid' }, { date: '2026-09-09', type: 'paid' }], shiftStatus: 'APPROVED', approverId: 1, tenantId: 1 });

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith(7, 'approved', 1, 1);
  });

  it('APPROVED: 半休(有給) は paid_half の申請として作る', async () => {
    jest.spyOn(repo, 'findExactRequest').mockResolvedValue(null);
    jest.spyOn(repo, 'create').mockResolvedValue(56);
    jest.spyOn(repo, 'updateStatus').mockResolvedValue();
    await repo.syncShiftPaidLeaves({ userId: 10, month: '2026-09', paidDays: [{ date: '2026-09-10', type: 'paid_half' }], shiftStatus: 'APPROVED', approverId: 1, tenantId: 1 });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-09-10', type: 'paid_half', reason: 'from_shift' }));
  });

  it('REJECTED: その月の from_shift 有給を却下、attendance_daily には触れない', async () => {
    await repo.syncShiftPaidLeaves({ userId: 10, month: '2026-09', paidDays: [{ date: '2026-09-08', type: 'paid' }], shiftStatus: 'REJECTED', approverId: 1, tenantId: 1 });
    const sqls = db.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).toMatch(/status = 'rejected'/);
    expect(sqls).not.toMatch(/attendance_daily/);
  });
});

describe('区分の休暇申請', () => {
  it('ensureKubunRequest: 同じ日・同じ種別の申請があれば作らない', async () => {
    jest.spyOn(repo, 'findExactRequest').mockResolvedValue({ id: 3, status: 'pending' });
    jest.spyOn(repo, 'create').mockResolvedValue(0);
    const r = await repo.ensureKubunRequest({ userId: 10, date: '2026-09-09', type: 'absence', tenantId: 1 });
    expect(r).toEqual({ id: 3, created: false });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('cancelKubunRequestsByDate: from_kubun の申請だけを取り消す', async () => {
    await repo.cancelKubunRequestsByDate(10, '2026-09-09', 1, 'half');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/from_kubun/);
    expect(sql).toMatch(/AUTO_CANCEL/);
    expect(sql).toMatch(/type <> \?/);
    expect(params).toEqual([10, '2026-09-09', '2026-09-09', 'half', 1]);
  });

  it('自動照合: シフト由来の有給は区分が空なら取り消さない', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await repo.reconcileApprovedPaidWithAttendance(1);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/from_shift/);
  });
});
