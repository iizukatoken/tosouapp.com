/**
 * 予定タブ「催促する」: 同じ会社の社員だけ・自分は不可・マネージャーは従業員だけ・提出済みなら 409・本人に通知
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn(async () => {}) }));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createNotice: jest.fn(async () => {}) }));

const db = require('../../src/core/database/mysql');
const notices = require('../../src/modules/notices/notices.repository');
const { remind } = require('../../src/modules/attendance/attendance.shiftRemind')._impl;

const req = (body, role = 'manager') => ({ user: { id: 5, role }, tenantId: 1, body, headers: {}, method: 'POST', originalUrl: '/x' });
const setDb = (user, sub) => db.query.mockImplementation(async (sql) => {
  if (/FROM users/.test(sql)) return [[user].filter(Boolean)];
  if (/shift_month_status/.test(sql)) return [[sub].filter(Boolean)];
  return [[]];
});

beforeEach(() => jest.clearAllMocks());

it('未提出の従業員に通知する', async () => {
  setDb({ id: 23, role: 'employee' }, null);
  await expect(remind(req({ userId: 23, month: '2026-11' }))).resolves.toEqual({ ok: true });
  expect(notices.createNotice).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: 23, targetMonth: '2026-11', message: expect.stringContaining('11月のシフト') }));
});
it('提出済みなら 409', async () => {
  setDb({ id: 23, role: 'employee' }, { status: 'PENDING' });
  await expect(remind(req({ userId: 23, month: '2026-11' }))).rejects.toMatchObject({ status: 409 });
});
it('差戻しの月は催促できる', async () => {
  setDb({ id: 23, role: 'employee' }, { status: 'REJECTED' });
  await expect(remind(req({ userId: 23, month: '2026-11' }))).resolves.toEqual({ ok: true });
});
it('マネージャーは管理者・マネージャーには催促できない', async () => {
  setDb({ id: 7, role: 'manager' }, null);
  await expect(remind(req({ userId: 7, month: '2026-11' }))).rejects.toMatchObject({ status: 403 });
});
it('別の会社の社員は 404、自分は 400', async () => {
  setDb(null, null);
  await expect(remind(req({ userId: 99, month: '2026-11' }))).rejects.toMatchObject({ status: 404 });
  await expect(remind(req({ userId: 5, month: '2026-11' }))).rejects.toMatchObject({ status: 400 });
});
