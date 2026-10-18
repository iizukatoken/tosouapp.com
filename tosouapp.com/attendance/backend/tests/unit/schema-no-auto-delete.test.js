/**
 * 起動時のスキーマ確認で、重複がある場合に勤怠データを自動削除しないことのテスト。
 * (以前は UNIQUE 追加に失敗すると attendance / user_work_details の重複行を
 *  バックアップなしで DELETE していた)
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const db = require('../../src/core/database/mysql');
const schema = require('../../src/modules/attendance/attendance.repository.schema');

const duplicateError = () => Object.assign(new Error("Duplicate entry '5-2026-10-16 08:00:00'"), { code: 'ER_DUP_ENTRY' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  db.query.mockImplementation(async (sql) => {
    const s = String(sql);
    if (/ADD CONSTRAINT unique_user_checkin|ADD UNIQUE KEY uniq_uwd_user_start/.test(s)) throw duplicateError();
    if (/groups_cnt/.test(s)) return [[{ groups_cnt: 2, extra_rows: 3 }]];
    return [[]];
  });
});

afterEach(() => {
  console.warn.mockRestore();
});

const deleteCalls = () => db.query.mock.calls.filter(([sql]) => /^\s*DELETE\b/i.test(String(sql)));

describe('起動時に重複行を自動削除しない', () => {
  it('attendance: UNIQUE を追加できなくても DELETE せず、件数を警告する', async () => {
    await schema.ensureAttendanceSchemaPublic();
    expect(deleteCalls()).toHaveLength(0);
    const warned = console.warn.mock.calls.find(c => String(c[0]).includes('unique_user_checkin'));
    expect(warned).toBeDefined();
    expect(warned[2]).toEqual({ duplicateGroups: 2, extraRows: 3 });
  });

  it('user_work_details: UNIQUE を追加できなくても DELETE しない', async () => {
    await schema.ensureWorkDetailsSchemaPublic();
    expect(deleteCalls()).toHaveLength(0);
    expect(console.warn.mock.calls.some(c => String(c[0]).includes('uniq_uwd_user_start'))).toBe(true);
  });

  it('user_work_details: UNIQUE が既にあれば追加を試みない', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SHOW INDEX FROM user_work_details/.test(String(sql))) return [[{ Key_name: 'uniq_uwd_user_start' }]];
      return [[]];
    });
    await schema.ensureWorkDetailsSchemaPublic();
    expect(db.query.mock.calls.some(([sql]) => /ADD UNIQUE KEY uniq_uwd_user_start/.test(String(sql)))).toBe(false);
    expect(deleteCalls()).toHaveLength(0);
  });
});
