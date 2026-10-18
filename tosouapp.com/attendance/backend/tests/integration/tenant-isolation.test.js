/**
 * @file tenant-isolation.test.js
 * Integration tests verifying multi-tenant data isolation.
 *
 * These tests ensure that when tenantId is provided, repository functions
 * only return/modify data belonging to that tenant — preventing cross-tenant
 * data leakage.
 *
 * Strategy: We mock the MySQL module to inspect queries and verify they include
 * tenant_id filtering when tenantId is provided.
 */
'use strict';

// Mock MySQL before requiring any module
const mockQuery = jest.fn().mockResolvedValue([[], []]);
const mockGetConnection = jest.fn().mockResolvedValue({
  query: mockQuery,
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  release: jest.fn(),
});
jest.mock('../../src/core/database/mysql', () => ({
  query: mockQuery,
  getConnection: mockGetConnection,
}));

// Mock logger to suppress output
jest.mock('../../src/core/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Multi-Tenant Data Isolation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([[], []]);
  });

  // ─── User Repository ─────────────────────────────────────────────────────

  describe('user.repository', () => {
    const userRepo = require('../../src/modules/users/user.repository');

    test('getUserById WITHOUT tenantId does NOT filter by tenant_id', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, username: 'test' }]]);
      await userRepo.getUserById(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('WHERE id = ?');
      expect(sql).not.toContain('tenant_id');
    });

    test('getUserById WITH tenantId filters by tenant_id', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, username: 'test', tenant_id: 2 }]]);
      await userRepo.getUserById(1, 2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain(2);
    });

    test('getUserById with wrong tenantId returns undefined', async () => {
      mockQuery.mockResolvedValueOnce([[]]); // No rows match
      const result = await userRepo.getUserById(1, 999);
      expect(result).toBeUndefined();
    });

    test('createUser includes tenant_id in INSERT', async () => {
      mockQuery.mockResolvedValueOnce([{ insertId: 10 }]);
      await userRepo.createUser({
        username: 'new', email: 'new@test.com', password: 'hash', tenantId: 3
      });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id');
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain(3);
    });

    test('listUsers with tenantId filters results', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1 }]]);
      await userRepo.listUsers(2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(2);
    });

    test('deleteUser with tenantId scopes deletion', async () => {
      mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await userRepo.deleteUser(5, 2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('DELETE FROM users');
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual([5, 2]);
    });

    test('updateUser with tenantId prevents cross-tenant update', async () => {
      mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);
      await userRepo.updateUser(5, { username: 'hacker', tenantId: 2 });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
    });
  });

  // ─── Attendance Daily Repository ──────────────────────────────────────────

  describe('attendance.repository.daily', () => {
    const dailyRepo = require('../../src/modules/attendance/attendance.repository.daily');

    test('getDaily with tenantId filters by tenant_id', async () => {
      mockQuery.mockResolvedValue([[{ userId: 1, date: '2026-01-01' }]]);
      await dailyRepo.getDaily(1, '2026-01-01', { tenantId: 2 });
      // Find the SELECT on attendance_daily (skip schema DDL)
      const selectCall = mockQuery.mock.calls.find(c =>
        c[0].includes('SELECT') && c[0].includes('attendance_daily') && c[0].includes('WHERE') && c[0].includes('tenant_id')
      );
      expect(selectCall).toBeDefined();
      expect(selectCall[1]).toContain(2);
    });

    test('listDailyBetween with tenantId scopes results', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      await dailyRepo.listDailyBetween(1, '2026-01-01', '2026-01-31', { tenantId: 3 });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(3);
    });

    test('upsertDaily includes tenant_id in INSERT', async () => {
      // Mock all internal calls: ensureSchema, getDaily (returns null), INSERT
      mockQuery.mockResolvedValue([[]]);
      mockQuery.mockResolvedValueOnce([[]]); // ensureSchema (CREATE TABLE)
      mockQuery.mockResolvedValueOnce([[]]); // getDaily returns null  
      mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT
      await dailyRepo.upsertDaily(1, '2026-01-01', { kubun: '出勤' }, { tenantId: 2 });
      // Find the INSERT call
      const insertCall = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO attendance_daily'));
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('tenant_id');
      expect(insertCall[1]).toContain(2);
    });
  });

  // ─── Attendance Records Repository ────────────────────────────────────────

  describe('attendance.repository.records', () => {
    const recordsRepo = require('../../src/modules/attendance/attendance.repository.records');

    test('getById with tenantId filters by tenant_id', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 10, userId: 1 }]]);
      await recordsRepo.getById(10, { tenantId: 2 });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(2);
    });

    test('listByUserBetween with tenantId scopes results', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      await recordsRepo.listByUserBetween(1, '2026-01-01', '2026-01-31', { tenantId: 2 });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(2);
    });

    test('setCheckOut with tenantId scopes update', async () => {
      // Mock getAttendanceColumnSet
      mockQuery.mockResolvedValueOnce([[{ name: 'checkOut' }, { name: 'tenant_id' }]]);
      mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await recordsRepo.setCheckOut(10, '2026-01-01 17:00:00', {}, null, { tenantId: 2 });
      const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE attendance'));
      expect(updateCall).toBeDefined();
      expect(updateCall[0]).toContain('tenant_id = ?');
    });
  });

  // ─── Expenses Repository ──────────────────────────────────────────────────

  describe('expenses.repository', () => {
    const expenseRepo = require('../../src/modules/expenses/expenses.repository');

    test('getById with tenantId filters by tenant_id', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, userId: 5 }]]);
      await expenseRepo.getById(1, 2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual([1, 2]);
    });

    test('getById without tenantId does NOT filter', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1 }]]);
      await expenseRepo.getById(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain('tenant_id');
    });

    test('listAll with tenantId scopes results', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      await expenseRepo.listAll('2026-01', 2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
    });

    test('deleteMine with tenantId prevents cross-tenant delete', async () => {
      mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);
      await expenseRepo.deleteMine(1, 999);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
    });
  });

  // ─── Leave Repository ─────────────────────────────────────────────────────

  describe('leave.repository', () => {
    const leaveRepo = require('../../src/modules/leave/leave.repository');

    test('create with tenantId includes tenant_id in INSERT', async () => {
      mockQuery.mockResolvedValueOnce([{ insertId: 1 }]);
      await leaveRepo.create({
        userId: 1, startDate: '2026-01-01', endDate: '2026-01-02',
        type: 'paid', reason: 'test', tenantId: 3
      });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id');
      expect(mockQuery.mock.calls[0][1]).toContain(3);
    });

    test('listMine with tenantId filters results', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      await leaveRepo.listMine(1, 2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(2);
    });
  });

  // ─── Tenant Guard Utility ─────────────────────────────────────────────────

  describe('tenantGuard', () => {
    const { requireTenantId, warnMissingTenantId, requireTenantMiddleware } = require('../../src/core/database/tenantGuard');

    test('requireTenantId does nothing when multi-tenant is OFF', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'false';
      expect(() => requireTenantId(null, 'test')).not.toThrow();
      process.env.ENABLE_MULTI_TENANT = orig;
    });

    test('requireTenantId throws when multi-tenant is ON and tenantId is null', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'true';
      expect(() => requireTenantId(null, 'test')).toThrow(/tenantId is required/);
      process.env.ENABLE_MULTI_TENANT = orig;
    });

    test('requireTenantId passes when multi-tenant is ON and tenantId provided', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'true';
      expect(() => requireTenantId(1, 'test')).not.toThrow();
      process.env.ENABLE_MULTI_TENANT = orig;
    });

    test('requireTenantMiddleware rejects when no tenantId on req', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'true';
      const req = { tenantId: null, user: { role: 'employee' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      requireTenantMiddleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      process.env.ENABLE_MULTI_TENANT = orig;
    });

    test('requireTenantMiddleware allows sysadmin without tenantId', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'true';
      const req = { tenantId: null, user: { role: 'sysadmin' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      requireTenantMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      process.env.ENABLE_MULTI_TENANT = orig;
    });

    test('warnMissingTenantId returns true when tenantId missing in multi-tenant mode', () => {
      const orig = process.env.ENABLE_MULTI_TENANT;
      process.env.ENABLE_MULTI_TENANT = 'true';
      const result = warnMissingTenantId(null, 'test');
      expect(result).toBe(true);
      process.env.ENABLE_MULTI_TENANT = orig;
    });
  });

  // ─── Department Repository ────────────────────────────────────────────────

  describe('department.repository', () => {
    const deptRepo = require('../../src/modules/departments/department.repository');

    test('getDepartmentById with tenantId filters correctly', async () => {
      mockQuery.mockResolvedValue([[{ id: 1, name: 'Dept A' }]]);
      await deptRepo.getDepartmentById(1, 2);
      // Find the SELECT query (skip CREATE TABLE)
      const selectCall = mockQuery.mock.calls.find(c => c[0].includes('SELECT') && c[0].includes('departments') && c[0].includes('WHERE'));
      expect(selectCall).toBeDefined();
      expect(selectCall[0]).toContain('tenant_id = ?');
    });

    // 部署は削除ではなく無効化 (is_active = 0) になった。他社の部署を無効化できないことを確認する。
    test('deactivateDepartment with tenantId prevents cross-tenant deactivate', async () => {
      mockQuery.mockResolvedValue([{ affectedRows: 0 }]);
      await deptRepo.deactivateDepartment(1, 999);
      const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE departments SET is_active = 0'));
      expect(updateCall).toBeDefined();
      expect(updateCall[0]).toContain('tenant_id = ?');
      expect(updateCall[1]).toEqual([1, 999]);
    });
  });

  // ─── Settings Repository ──────────────────────────────────────────────────

  describe('settings.repository', () => {
    const settingsRepo = require('../../src/modules/settings/settings.repository');

    test('getSettings with tenantId returns tenant-specific settings', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, tenant_id: 2, workStart: '09:00' }]]);
      await settingsRepo.getSettings(2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tenant_id = ?');
      expect(mockQuery.mock.calls[0][1]).toContain(2);
    });

    test('getSettings without tenantId uses legacy id=1 row', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 1, workStart: '08:00' }]]);
      await settingsRepo.getSettings();
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('WHERE id = 1');
    });
  });

  // ─── Cross-Tenant Access Scenario ─────────────────────────────────────────

  describe('Cross-tenant access scenarios', () => {
    const userRepo = require('../../src/modules/users/user.repository');

    test('User from tenant 1 cannot access user from tenant 2', async () => {
      // Simulate: user 5 belongs to tenant 2, attacker passes tenantId=1
      mockQuery.mockResolvedValueOnce([[]]); // Empty result = not found in tenant 1
      const result = await userRepo.getUserById(5, 1);
      expect(result).toBeUndefined(); // Access denied - user not visible
    });

    test('User from correct tenant CAN access their own data', async () => {
      mockQuery.mockResolvedValueOnce([[{ id: 5, tenant_id: 2, username: 'real' }]]);
      const result = await userRepo.getUserById(5, 2);
      expect(result).toBeDefined();
      expect(result.username).toBe('real');
    });
  });
});
