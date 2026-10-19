/**
 * 週次の重複データチェック (cron/duplicateCheckCron.js) のテスト。
 * - 重複がなければメールを送らない
 * - 重複があれば管理者へメールを送る
 * - 氏名などは HTML エスケープする
 */
'use strict';

jest.mock('../../src/core/notifications/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/services/duplicateCheck.service', () => ({
  findDuplicates: jest.fn(),
  hasDuplicates: jest.requireActual('../../src/services/duplicateCheck.service').hasDuplicates,
}));
jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const mail = require('../../src/core/notifications/email.service');
const { findDuplicates } = require('../../src/services/duplicateCheck.service');
const { runDuplicateCheck } = require('../../src/cron/duplicateCheckCron');

const clean = {
  attendanceOverlappingPairs: 0, attendanceSeparatePairs: 3, attendanceOverlapSamples: [],
  workReportIdenticalGroups: 0, workReportExtraRows: 0, workReportIdenticalSamples: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => console.log.mockRestore());

describe('週次の重複データチェック', () => {
  it('重複がなければメールを送らない (別々の時間帯の2回出勤は重複ではない)', async () => {
    findDuplicates.mockResolvedValue(clean);
    const r = await runDuplicateCheck();
    expect(r.sent).toBe(false);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('時間が重なる打刻があればメールを送る', async () => {
    findDuplicates.mockResolvedValue({
      ...clean,
      attendanceOverlappingPairs: 1,
      attendanceOverlapSamples: [{ tenant_id: 1, username: '山田<script>', date: '2026-10-16', id_a: 1, in_a: '08:00', out_a: '17:00', id_b: 2, in_b: '08:50', out_b: '17:00' }],
    });
    const r = await runDuplicateCheck();
    expect(r.sent).toBe(true);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const { to, subject, html } = mail.sendMail.mock.calls[0][0];
    expect(to).toBe('iizuka_token@tosouapp.com');
    expect(subject).toContain('重複');
    expect(html).toContain('1 組');
    expect(html).toContain('山田&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('同じ内容の日報があればメールを送る', async () => {
    findDuplicates.mockResolvedValue({
      ...clean,
      workReportIdenticalGroups: 2, workReportExtraRows: 3,
      workReportIdenticalSamples: [{ tenant_id: 2, username: '佐藤', date: '2026-10-15', site: 'A現場', cnt: 2, ids: '10,11' }],
    });
    const r = await runDuplicateCheck();
    expect(r.sent).toBe(true);
    expect(mail.sendMail.mock.calls[0][0].html).toContain('余分 3 行');
  });

  it('チェック自体が失敗してもサーバーを止めない', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    findDuplicates.mockRejectedValue(new Error('DB down'));
    const r = await runDuplicateCheck();
    expect(r.sent).toBe(false);
    expect(r.error.message).toBe('DB down');
    console.error.mockRestore();
  });
});
