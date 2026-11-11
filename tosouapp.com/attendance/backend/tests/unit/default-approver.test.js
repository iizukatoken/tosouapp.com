/**
 * 承認者の既定名（月次画面の 確認済み の日 / 月次Excel の 承認者）:
 * users.manager_id → 同じ部署の manager → admin。DBはモック。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/users/user.repository', () => ({ getUserById: jest.fn() }));

const db = require('../../src/core/database/mysql');
const userRepo = require('../../src/modules/users/user.repository');
const { resolveDefaultApproverName } = require('../../src/modules/attendance/attendance.utils');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[]]);
  userRepo.getUserById.mockResolvedValue(null);
});

describe('resolveDefaultApproverName', () => {
  it('社員管理で設定されたマネージャーの名前を返す', async () => {
    db.query.mockResolvedValueOnce([[{ full_name: '鈴木一郎', username: 'suzuki' }]]);
    const name = await resolveDefaultApproverName({ manager_id: 5, tenant_id: 1, departmentId: 2 }, 10, 1);
    expect(name).toBe('鈴木一郎');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('tenant_users');
    expect(params).toEqual([1, 5, 1, 1, 1]);
  });

  it('マネージャー未設定なら同じ部署の manager（本人以外・在職中）', async () => {
    db.query.mockResolvedValueOnce([[{ full_name: '', username: 'bucho' }]]);
    const name = await resolveDefaultApproverName({ manager_id: null, tenant_id: 1, departmentId: 2 }, 10, 1);
    expect(name).toBe('bucho');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("employment_status = 'active'");
    expect(params).toEqual([1, 2, 'manager', 10]);
  });

  it('誰も見つからなければ空文字（画面は — を出す）', async () => {
    const name = await resolveDefaultApproverName({ manager_id: null, tenant_id: 1, departmentId: 2 }, 10, 1);
    expect(name).toBe('');
    expect(db.query).toHaveBeenCalledTimes(2); // manager → admin
  });
});
