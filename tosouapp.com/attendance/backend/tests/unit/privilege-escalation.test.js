/**
 * Chặn leo thang quyền (audit 2026-11-10):
 * - 申請 đổi hồ sơ chỉ nhận thông tin cá nhân, không ai tự duyệt yêu cầu của mình
 * - admin công ty không gán / gỡ được role sysadmin, owner
 * - route debug FAQ công khai đã bị xoá
 * DB và repository đều mock, không dùng DB thật.
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/users/user.repository', () => ({
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  setRole: jest.fn(),
}));
jest.mock('../../src/modules/departments/department.change.service', () => ({
  saveWithDepartmentChange: jest.fn(async ({ save }) => save()),
}));
jest.mock('../../src/modules/auth/refresh.repository', () => ({ deleteUserTokens: jest.fn() }));

const db = require('../../src/core/database/mysql');
const userRepo = require('../../src/modules/users/user.repository');
const { approveProfileChange } = require('../../src/modules/manager/manager.controller');
const { setRole, update } = require('../../src/modules/users/user.controller');
const { canAssignRole } = require('../../src/utils/normalizeRole');
const { pickProfileChangeFields } = require('../../src/modules/employee/profileChange.fields');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function mockChangeRequest(userId, fields) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM user_change_requests ucr/.test(sql)) {
      return [[{ id: 99, user_id: userId, status: 'pending', fields_json: JSON.stringify(fields) }]];
    }
    return [[]];
  });
}

beforeEach(() => jest.clearAllMocks());

describe('申請 đổi hồ sơ', () => {
  it('chỉ giữ thông tin cá nhân khi tạo yêu cầu', () => {
    expect(pickProfileChangeFields({ phone: '090', role: 'sysadmin', baseSalary: 999999, managerId: 1, departmentId: 3 }))
      .toEqual({ phone: '090' });
  });

  it('manager không tự duyệt được yêu cầu của chính mình', async () => {
    mockChangeRequest(5, { phone: '090' });
    const res = mockRes();
    await approveProfileChange({ params: { id: '99' }, body: { status: 'approved' }, tenantId: 1, user: { id: 5, role: 'manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(userRepo.updateUser).not.toHaveBeenCalled();
  });

  it('vẫn từ chối được yêu cầu của chính mình', async () => {
    mockChangeRequest(5, { phone: '090' });
    const res = mockRes();
    await approveProfileChange({ params: { id: '99' }, body: { status: 'rejected' }, tenantId: 1, user: { id: 5, role: 'manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(userRepo.updateUser).not.toHaveBeenCalled();
  });

  it('yêu cầu cũ chứa role / lương: chỉ áp dụng phần thông tin cá nhân', async () => {
    mockChangeRequest(20, { phone: '090', role: 'sysadmin', baseSalary: 999999 });
    const res = mockRes();
    await approveProfileChange({ params: { id: '99' }, body: { status: 'approved' }, tenantId: 1, user: { id: 5, role: 'manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(userRepo.updateUser).toHaveBeenCalledWith(20, { phone: '090' });
  });

  it('yêu cầu chỉ có role → 422, không đổi gì', async () => {
    mockChangeRequest(20, { role: 'admin' });
    const res = mockRes();
    await approveProfileChange({ params: { id: '99' }, body: { status: 'approved' }, tenantId: 1, user: { id: 5, role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(userRepo.updateUser).not.toHaveBeenCalled();
  });
});

describe('Gán role', () => {
  it.each([
    ['admin', 'admin', true], ['admin', 'manager', true], ['admin', 'employee', true],
    ['admin', 'owner', false], ['admin', 'sysadmin', false], ['admin', 'superuser', false],
    ['owner', 'owner', true], ['owner', 'sysadmin', false], ['sysadmin', 'sysadmin', true],
  ])('%s gán %s → %s', (actor, target, ok) => {
    expect(canAssignRole(actor, target)).toBe(ok);
  });

  it('admin công ty không đặt được role=sysadmin', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 20, role: 'employee' });
    const res = mockRes();
    await setRole({ params: { id: '20' }, body: { role: 'sysadmin' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(userRepo.setRole).not.toHaveBeenCalled();
  });

  it('admin công ty không hạ quyền được owner', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 2, role: 'owner' });
    const res = mockRes();
    await setRole({ params: { id: '2' }, body: { role: 'employee' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(userRepo.setRole).not.toHaveBeenCalled();
  });

  it('admin vẫn đổi employee → manager bình thường', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 20, role: 'employee' });
    const res = mockRes();
    await setRole({ params: { id: '20' }, body: { role: 'manager' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(userRepo.setRole).toHaveBeenCalledWith('20', 'manager', 1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('PATCH user: gửi lại role owner không đổi thì không bị chặn', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 2, role: 'owner' });
    const res = mockRes();
    await update({ params: { id: '2' }, body: { role: 'owner', phone: '090' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('PATCH user: người đang là owner (form gửi role theo công ty = admin) → vẫn lưu, không đổi role', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 2, role: 'owner' });
    const res = mockRes();
    await update({ params: { id: '2' }, body: { role: 'admin', phone: '090' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(userRepo.updateUser).toHaveBeenCalled();
    const saved = userRepo.updateUser.mock.calls[0][1];
    expect(saved.role).toBeUndefined();
    expect(saved.phone).toBe('090');
  });

  it('PATCH user: admin đổi role thành sysadmin → 403', async () => {
    userRepo.getUserById.mockResolvedValue({ id: 20, role: 'employee' });
    const res = mockRes();
    await update({ params: { id: '20' }, body: { role: 'sysadmin' }, tenantId: 1, user: { id: 1, role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(userRepo.updateUser).not.toHaveBeenCalled();
  });
});

describe('FAQ', () => {
  it('không còn route debug công khai', () => {
    const router = require('../../src/modules/faq/faq.routes');
    const paths = router.stack.filter(l => l.route).map(l => l.route.path);
    expect(paths).not.toContain('/debug/all-questions');
  });
});
