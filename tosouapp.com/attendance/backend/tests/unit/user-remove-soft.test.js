/**
 * DELETE /api/admin/users/:id (旧ユーザー管理画面の「削除」) のテスト。
 * 以前は DELETE FROM users で、ON DELETE CASCADE により勤怠・日報・給与まで消えていた。
 * 今は無効化 (employment_status = inactive) のみで、データは残す。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/users/user.repository', () => ({
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn()
}));
jest.mock('../../src/modules/auth/refresh.repository', () => ({ deleteUserTokens: jest.fn() }));
jest.mock('../../src/core/middleware/authMiddleware', () => ({ invalidateUserCache: jest.fn() }));

const repo = require('../../src/modules/users/user.repository');
const refreshRepo = require('../../src/modules/auth/refresh.repository');
const { remove } = require('../../src/modules/users/user.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('ユーザー削除 = 無効化', () => {
  it('DELETE せず employment_status を inactive にし、セッションを無効にする', async () => {
    repo.getUserById.mockResolvedValue({ id: 20, tenant_id: 1 });
    const res = mockRes();
    await remove({ params: { id: '20' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(repo.deleteUser).not.toHaveBeenCalled();
    expect(repo.updateUser).toHaveBeenCalledWith('20', { employmentStatus: 'inactive', tenantId: 1 });
    expect(refreshRepo.deleteUserTokens).toHaveBeenCalledWith('20');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: '20', status: 'inactive' });
  });

  it('自社にいないユーザーは 404 (他社のユーザーを無効化しない)', async () => {
    repo.getUserById.mockResolvedValue(null);
    const res = mockRes();
    await remove({ params: { id: '99' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(repo.updateUser).not.toHaveBeenCalled();
    expect(repo.deleteUser).not.toHaveBeenCalled();
  });
});
