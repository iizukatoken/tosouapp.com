/**
 * エラーを握りつぶさず管理者に通知する仕組みのテスト。
 * - API が 5xx を返したら errorReporter.report が呼ばれる (4xx は呼ばれない、二重通知しない)
 * - 監査ログの書き込み失敗は通知したうえで、呼び出し側には従来どおり例外を投げる
 * - 入力エラー (4xx) は通知しない
 * - Webhook 送信は 10 分あたりの上限で止まる (障害時にスパムしない)
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const express = require('express');
const request = require('supertest');

describe('API の 5xx を管理者に通知', () => {
  let report;
  let app;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../src/core/errorReporter', () => ({ report: jest.fn(), reportSwallowed: jest.fn() }));
    report = require('../../src/core/errorReporter').report;
    app = express();
    app.use(require('../../src/core/middleware/reportServerErrors'));
    app.get('/api/x/fail', (req, res) => res.status(500).json({ message: 'DB down' }));
    app.get('/api/x/bad', (req, res) => res.status(400).json({ message: 'Missing id' }));
    app.get('/api/x/ok', (req, res) => res.json({ ok: true }));
    app.get('/api/x/throw', () => { throw new Error('boom'); });
    app.use(require('../../src/core/middleware/errorHandler'));
  });

  it('500 を返したら通知 (パスとメッセージ付き)', async () => {
    const r = await request(app).get('/api/x/fail');
    expect(r.status).toBe(500);
    expect(report).toHaveBeenCalledTimes(1);
    const [err, meta] = report.mock.calls[0];
    expect(err.message).toContain('/api/x/fail');
    expect(err.message).toContain('DB down');
    expect(meta).toEqual(expect.objectContaining({ type: 'http_5xx', status: 500 }));
  });

  it('400 や 200 は通知しない', async () => {
    await request(app).get('/api/x/bad');
    await request(app).get('/api/x/ok');
    expect(report).not.toHaveBeenCalled();
  });

  it('errorHandler 経由の例外は 1 回だけ通知 (二重通知しない)', async () => {
    const r = await request(app).get('/api/x/throw');
    expect(r.status).toBe(500);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('握りつぶされていた失敗を通知', () => {
  beforeEach(() => jest.resetModules());

  it('監査ログの書き込み失敗: 通知して、呼び出し側には例外を投げる (従来どおり)', async () => {
    jest.doMock('../../src/core/errorReporter', () => ({ report: jest.fn(), reportSwallowed: jest.fn() }));
    const db = require('../../src/core/database/mysql');
    db.query.mockRejectedValue(new Error('Table audit_logs is full'));
    const { reportSwallowed } = require('../../src/core/errorReporter');
    const auditRepo = require('../../src/modules/audit/audit.repository');
    await expect(auditRepo.writeLog({ userId: 1, action: 'x' })).rejects.toThrow('Table audit_logs is full');
    expect(reportSwallowed).toHaveBeenCalledWith('audit.writeLog', expect.any(Error));
  });

  it('お知らせ作成の入力エラー (400) は通知しない', async () => {
    jest.doMock('../../src/core/errorReporter', () => ({ report: jest.fn(), reportSwallowed: jest.fn() }));
    const db = require('../../src/core/database/mysql');
    db.query.mockResolvedValue([[], []]);
    const { reportSwallowed } = require('../../src/core/errorReporter');
    const noticesRepo = require('../../src/modules/notices/notices.repository');
    await expect(noticesRepo.createNotice({ message: '' })).rejects.toThrow('Missing message');
    expect(reportSwallowed).not.toHaveBeenCalled();
  });
});

describe('Webhook の送信上限', () => {
  const OLD = process.env.ERROR_WEBHOOK_URL;
  afterAll(() => { process.env.ERROR_WEBHOOK_URL = OLD; });

  it('10 分間に 30 件を超える通知は送らない', async () => {
    jest.resetModules();
    jest.dontMock('../../src/core/errorReporter');
    process.env.ERROR_WEBHOOK_URL = 'https://example.invalid/webhook';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { report } = require('../../src/core/errorReporter');
    for (let i = 0; i < 50; i++) report(new Error(`distinct error ${i}`));
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(30);
    console.error.mockRestore();
  });
});
