/**
 * Regression tests: admin/manager of one company (tenant) must not be able to
 * read or modify another company's data by passing its userId / record id.
 *
 * Previously these routes either skipped resolveTenant (so req.tenantId was
 * undefined and repository queries silently dropped the tenant filter) or did
 * not pass req.tenantId to the repository.
 */
'use strict';

const CALLER_TENANT = 2;
const OTHER_TENANT_USER = 99; // exists, but in another tenant

jest.mock('../../src/core/database/mysql', () => ({
  query: jest.fn().mockResolvedValue([[], []]),
  getConnection: jest.fn(),
}));
jest.mock('../../src/core/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  middleware: () => (req, res, next) => next(),
}));
jest.mock('../../src/core/middleware/authMiddleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, role: req.headers['x-test-role'] || 'admin' }; next(); },
  authenticateFromCookie: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
  invalidateUserCache: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/core/middleware/tenantMiddleware', () => ({
  resolveTenant: (req, res, next) => { req.tenantId = 2; req.tenant = { id: 2, name: 'テスト株式会社' }; next(); },
  requireTenant: (req, res, next) => next(),
  injectTenantLocals: (req, res, next) => next(),
  invalidateTenantCache: jest.fn(),
}));
jest.mock('../../src/core/middleware/rateLimit', () => ({
  rateLimit: () => (req, res, next) => next(),
  rateLimitNamed: () => (req, res, next) => next(),
}));
jest.mock('../../src/modules/users/user.repository');
jest.mock('../../src/modules/attendance/attendance.repository');
jest.mock('../../src/modules/salary/salary.repository');
jest.mock('../../src/modules/documents/documents.repository');
jest.mock('../../src/modules/auth/refresh.repository');
jest.mock('../../src/modules/audit/audit.repository');
jest.mock('../../src/modules/workReports/workReports.repository');

const express = require('express');
const request = require('supertest');
const userRepo = require('../../src/modules/users/user.repository');
const attendanceRepo = require('../../src/modules/attendance/attendance.repository');
const salaryRepo = require('../../src/modules/salary/salary.repository');
const docRepo = require('../../src/modules/documents/documents.repository');
const refreshRepo = require('../../src/modules/auth/refresh.repository');
const workReportsRepo = require('../../src/modules/workReports/workReports.repository');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../../src/modules/admin/admin.routes'));
  app.use('/api/employee', require('../../src/modules/employee/employee.routes'));
  app.use('/api/work-reports', require('../../src/modules/workReports/workReports.routes'));
  return app;
}

let app;
beforeAll(() => { app = buildApp(); });

beforeEach(() => {
  jest.clearAllMocks();
  // A user only "exists" when looked up inside the caller's tenant.
  userRepo.getUserById.mockImplementation(async (id, tenantId) => {
    if (Number(id) === OTHER_TENANT_USER) return tenantId == null ? { id: OTHER_TENANT_USER, departmentId: 1 } : null;
    return { id: Number(id), departmentId: 1 };
  });
});

describe('admin routes reject other-tenant targets', () => {
  test('GET /attendance/day for another tenant\'s user → 404, no attendance read', async () => {
    const r = await request(app).get(`/api/admin/attendance/day?userId=${OTHER_TENANT_USER}&date=2026-09-01`);
    expect(r.status).toBe(404);
    expect(attendanceRepo.listByUserBetween).not.toHaveBeenCalled();
  });

  test('PATCH /attendance/:id for a record outside the tenant → 404, no update', async () => {
    attendanceRepo.getById.mockResolvedValue(null);
    const r = await request(app).patch('/api/admin/attendance/5').send({ checkIn: '2026-09-01 09:00:00' });
    expect(r.status).toBe(404);
    expect(attendanceRepo.getById).toHaveBeenCalledWith('5', { tenantId: CALLER_TENANT });
    expect(attendanceRepo.updateTimes).not.toHaveBeenCalled();
  });

  test('POST /users/:id/revoke-sessions for another tenant\'s user → 404, nothing revoked', async () => {
    const r = await request(app).post(`/api/admin/users/${OTHER_TENANT_USER}/revoke-sessions`);
    expect(r.status).toBe(404);
    expect(refreshRepo.deleteUserTokens).not.toHaveBeenCalled();
    expect(userRepo.incrementTokenVersion).not.toHaveBeenCalled();
  });

  test('POST /shifts/assign for another tenant\'s user → 404', async () => {
    const r = await request(app).post('/api/admin/shifts/assign')
      .send({ userId: OTHER_TENANT_USER, shiftId: 1, startDate: '2026-09-01' });
    expect(r.status).toBe(404);
    expect(attendanceRepo.assignShiftToUser).not.toHaveBeenCalled();
  });

  test('GET /shifts/definitions is scoped to the tenant', async () => {
    attendanceRepo.listShiftDefinitions.mockResolvedValue([]);
    await request(app).get('/api/admin/shifts/definitions');
    expect(attendanceRepo.listShiftDefinitions).toHaveBeenCalledWith({ tenantId: CALLER_TENANT });
  });

  test('GET /salary/history is scoped to the tenant', async () => {
    salaryRepo.listHistory.mockResolvedValue({ data: [] });
    await request(app).get('/api/admin/salary/history');
    expect(salaryRepo.listHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: CALLER_TENANT }));
  });
});

describe('employee routes resolve the tenant', () => {
  test('GET /documents passes the caller tenant to the repository', async () => {
    docRepo.listFiltered.mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0, pages: 0 });
    await request(app).get('/api/employee/documents');
    expect(docRepo.listFiltered).toHaveBeenCalledWith(expect.objectContaining({ tenantId: CALLER_TENANT }));
  });

  test('GET /documents/:id of another tenant → 404', async () => {
    docRepo.getById.mockImplementation(async (id, tenantId) => (tenantId == null ? { id: 7, userId: OTHER_TENANT_USER } : null));
    const r = await request(app).get('/api/employee/documents/7');
    expect(r.status).toBe(404);
  });
});

describe('work reports resolve the tenant', () => {
  test('month-closed check uses the caller tenant (not 0)', async () => {
    workReportsRepo.isMonthClosed.mockResolvedValue(true);
    const r = await request(app).post('/api/work-reports').set('x-test-role', 'employee')
      .send({ date: '2026-09-01', work: '塗装' });
    expect(workReportsRepo.isMonthClosed).toHaveBeenCalledWith('2026-09', CALLER_TENANT);
    expect(r.status).toBe(409);
  });
});

describe('calendar import saves holidays for the caller company only', () => {
  test('imported holidays get the caller tenant_id (not 0 = shared by every company)', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('カレンダー');
    ws.addRow(['日付', '種別', '休日', '名称']);
    ws.addRow(['2026-12-29', '会社', '休', '年末休暇']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const db = require('../../src/core/database/mysql');
    const r = await request(app).post('/api/admin/calendar/import')
      .attach('file', buf, { filename: 'calendar.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(r.status).toBe(200);
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO company_holidays/.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('tenant_id');
    expect(insert[1]).toEqual([CALLER_TENANT, '2026-12-29', 'fixed', '年末休暇', 1]);
  }, 20000); // exceljs の初回読み込みが遅いことがある
});
