/**
 * 交通費: 社員が自分で修正・削除できるのは 下書き・差戻し のみ。
 * (以前は 申請中・総務確認済み・承認済み でも金額などを変更・削除できた)
 * 管理者・マネージャーは従来どおり (支給済みは誰も不可)。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn().mockResolvedValue([[], []]) }));
jest.mock('../../src/core/middleware/authMiddleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 23, role: req.headers['x-test-role'] || 'employee' }; next(); },
  authorize: () => (req, res, next) => next(),
}));
jest.mock('../../src/core/middleware/tenantMiddleware', () => ({ resolveTenant: (req, res, next) => { req.tenantId = 1; next(); } }));
jest.mock('../../src/core/middleware/rateLimit', () => ({ rateLimitNamed: () => (req, res, next) => next(), rateLimit: () => (req, res, next) => next() }));
jest.mock('../../src/modules/expenses/expenses.repository', () => ({
  getById: jest.fn(), updateMine: jest.fn().mockResolvedValue(true), updateByAdmin: jest.fn().mockResolvedValue(true), deleteMine: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn() }));
jest.mock('../../src/modules/notices/notices.repository', () => ({}));

const express = require('express');
const request = require('supertest');
const repo = require('../../src/modules/expenses/expenses.repository');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 23, role: req.headers['x-test-role'] || 'employee' }; req.tenantId = 1; next(); });
  app.use('/api/expenses', require('../../src/modules/expenses/expenses.routes'));
});
beforeEach(() => jest.clearAllMocks());

const claim = (status) => ({ id: 5, userId: 23, status, amount: 560 });

describe('社員による交通費の修正・削除', () => {
  it.each(['draft', 'pending', 'rejected'])('%s は修正できる', async (status) => {
    repo.getById.mockResolvedValue(claim(status));
    const r = await request(app).patch('/api/expenses/5').send({ amount: 600 });
    expect(r.status).toBe(200);
    expect(repo.updateMine).toHaveBeenCalled();
  });

  it.each(['applied', 'soumu_checked', 'approved'])('%s は修正できない (409)', async (status) => {
    repo.getById.mockResolvedValue(claim(status));
    const r = await request(app).patch('/api/expenses/5').send({ amount: 99999 });
    expect(r.status).toBe(409);
    expect(repo.updateMine).not.toHaveBeenCalled();
  });

  it.each(['applied', 'approved'])('%s は削除できない (409)', async (status) => {
    repo.getById.mockResolvedValue(claim(status));
    const r = await request(app).delete('/api/expenses/5');
    expect(r.status).toBe(409);
    expect(repo.deleteMine).not.toHaveBeenCalled();
  });

  it('下書きは削除できる', async () => {
    repo.getById.mockResolvedValue(claim('draft'));
    const r = await request(app).delete('/api/expenses/5');
    expect(r.status).toBe(200);
    expect(repo.deleteMine).toHaveBeenCalled();
  });

  it('管理者は申請中でも修正できる (従来どおり)', async () => {
    repo.getById.mockResolvedValue(claim('applied'));
    const r = await request(app).patch('/api/expenses/5').set('x-test-role', 'admin').send({ amount: 600 });
    expect(r.status).toBe(200);
    expect(repo.updateByAdmin).toHaveBeenCalled();
  });

  it('支給済みは管理者でも修正できない (従来どおり)', async () => {
    repo.getById.mockResolvedValue(claim('paid'));
    const r = await request(app).patch('/api/expenses/5').set('x-test-role', 'admin').send({ amount: 600 });
    expect(r.status).toBe(409);
  });
});
