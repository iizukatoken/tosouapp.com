/**
 * 交通費: 承認は 1 回で済む (申請中 → 承認済み)。manager も承認できる。
 * 支給済みにするのは管理者のみ (従来どおり)。旧フローの総務確認済みからも承認できる。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn().mockResolvedValue([[], []]) }));
jest.mock('../../src/core/middleware/authMiddleware', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));
jest.mock('../../src/core/middleware/tenantMiddleware', () => ({ resolveTenant: (req, res, next) => { req.tenantId = 1; next(); } }));
jest.mock('../../src/core/middleware/rateLimit', () => ({ rateLimitNamed: () => (req, res, next) => next(), rateLimit: () => (req, res, next) => next() }));
jest.mock('../../src/modules/expenses/expenses.repository', () => ({
  getById: jest.fn(), updateStatus: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn() }));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createNotice: jest.fn().mockResolvedValue(true) }));

const express = require('express');
const request = require('supertest');
const repo = require('../../src/modules/expenses/expenses.repository');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, role: req.headers['x-test-role'] || 'admin' }; req.tenantId = 1; next(); });
  app.use('/api/expenses', require('../../src/modules/expenses/expenses.routes'));
});
beforeEach(() => jest.clearAllMocks());

const claim = (status) => ({ id: 5, userId: 23, status, amount: 560, date: '2026-10-18' });
const patch = (role, status) => request(app).patch('/api/expenses/5/status').set('x-test-role', role).send({ status });

describe('交通費の承認 (1 回)', () => {
  it.each(['manager', 'admin'])('%s は申請中を直接 承認 できる', async (role) => {
    repo.getById.mockResolvedValue(claim('applied'));
    const r = await patch(role, 'approved');
    expect(r.status).toBe(200);
    expect(repo.updateStatus).toHaveBeenCalledWith(5, 'approved', null, 1, 1);
  });

  it('旧フローの総務確認済みからも 承認 できる', async () => {
    repo.getById.mockResolvedValue(claim('soumu_checked'));
    expect((await patch('manager', 'approved')).status).toBe(200);
  });

  it.each(['draft', 'rejected', 'approved', 'paid'])('%s は 承認 できない', async (status) => {
    repo.getById.mockResolvedValue(claim(status));
    expect((await patch('admin', 'approved')).status).toBe(403);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('社員は 承認 できない', async () => {
    repo.getById.mockResolvedValue(claim('applied'));
    expect((await patch('employee', 'approved')).status).toBe(403);
  });

  it('支給済みにするのは管理者のみ', async () => {
    repo.getById.mockResolvedValue(claim('approved'));
    expect((await patch('manager', 'paid')).status).toBe(403);
    expect((await patch('admin', 'paid')).status).toBe(200);
  });

  it('一括: 申請中と総務確認済みをまとめて 承認', async () => {
    repo.getById.mockImplementation(async (id) => ({ ...claim(id === 1 ? 'applied' : 'soumu_checked'), id }));
    const r = await request(app).post('/api/expenses/admin/bulk-status').set('x-test-role', 'manager').send({ ids: [1, 2], status: 'approved' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ processed: 2, skipped: 0 });
  });
});
