/**
 * DB バックアップ: 毎日 R2 へ。R2 に保存できた日は添付メールを送らない（日曜だけ送る）。
 * R2 に保存できなかった日は曜日に関係なく添付メール。重複実行はしない。
 */
'use strict';

jest.mock('mysqldump', () => jest.fn(async ({ dumpToFile }) => {
  require('fs').writeFileSync(dumpToFile, '-- dump\n');
}), { virtual: true });
jest.mock('../../src/core/services/s3.service', () => ({
  isR2Configured: jest.fn(() => true),
  uploadFileToR2: jest.fn(async () => true)
}));
jest.mock('../../src/core/notifications/email.service', () => ({ sendMail: jest.fn(async () => {}) }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const s3 = require('../../src/core/services/s3.service');
const mail = require('../../src/core/notifications/email.service');
const cron = require('node-cron');
const { runAutoBackup, initBackupCronJob } = require('../../src/cron/dbBackupCron');

const attachMails = () => mail.sendMail.mock.calls.filter(c => Array.isArray(c[0].attachments));

beforeEach(() => { jest.clearAllMocks(); s3.uploadFileToR2.mockResolvedValue(true); });

describe('毎日バックアップ', () => {
  it('毎日 03:00 JST に予約される', () => {
    initBackupCronJob();
    expect(cron.schedule.mock.calls[0][0]).toBe('0 3 * * *');
    expect(cron.schedule.mock.calls[0][2].timezone).toBe('Asia/Tokyo');
  });
  it('平日: R2 に保存できたら添付メールは送らない', async () => {
    await runAutoBackup({ emailCopy: false });
    expect(s3.uploadFileToR2).toHaveBeenCalled();
    expect(attachMails()).toHaveLength(0);
  });
  it('日曜（emailCopy）: 添付メールも送る', async () => {
    await runAutoBackup({ emailCopy: true });
    expect(attachMails()).toHaveLength(1);
  });
  it('R2 に保存できなかった日は平日でも添付メール＋警告', async () => {
    s3.uploadFileToR2.mockResolvedValue(false);
    await runAutoBackup({ emailCopy: false });
    expect(attachMails()).toHaveLength(1);
    expect(mail.sendMail.mock.calls.some(c => /Cảnh báo/.test(c[0].subject))).toBe(true);
  });
  it('実行中に呼ばれても2回目は走らない', async () => {
    await Promise.all([runAutoBackup({ emailCopy: false }), runAutoBackup({ emailCopy: false })]);
    expect(s3.uploadFileToR2).toHaveBeenCalledTimes(1);
  });
});

// テストで作ったダミーのバックアップファイル（中身 "-- dump"）だけを片付ける
afterAll(() => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../src/uploads/db-backups-internal');
  try {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (f.startsWith('tosouapp_backup_') && fs.readFileSync(fp, 'utf8') === '-- dump\n') fs.unlinkSync(fp);
    }
  } catch (e) { /* なければ何もしない */ }
});
