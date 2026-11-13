/**
 * 打刻編集（管理者・マネージャー）: 取消は原本を残す・元に戻せる・理由必須・自分は不可・本人に通知。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn(async () => {}) }));
jest.mock('../../src/modules/notices/notices.repository', () => ({ createNotice: jest.fn(async () => {}) }));
jest.mock('../../src/modules/attendance/attendance.utils', () => ({ assertMonthWritable: jest.fn(async () => {}) }));
jest.mock('../../src/modules/attendance/attendance.summary.repository', () => ({ markDirty: jest.fn(async () => {}) }));

const db = require('../../src/core/database/mysql');
const notices = require('../../src/modules/notices/notices.repository');
const audit = require('../../src/modules/audit/audit.repository');
const pe = require('../../src/modules/attendance/attendance.punchEdit');
const { voidPunch, restorePunch, editPunch, addPunch } = pe._impl;

const EMP = { id: 23, role: 'employee', username: '小林', tenant_id: 1 };
const ROW = { id: 77, userId: 23, checkIn: '2026-11-12 08:00:00', checkOut: '2026-11-12 08:08:00', out_locationSource: 'simple' };
const req = (body, role = 'manager') => ({ user: { id: 5, role }, tenantId: 1, body, method: 'POST', originalUrl: '/x', headers: {} });

/** SQL ごとに返す値を決める簡易 DB */
function fakeDb(handlers) {
  const calls = [];
  db.query.mockImplementation(async (sql, params) => {
    calls.push({ sql, params });
    for (const [re, fn] of handlers) if (re.test(sql)) return fn(params);
    if (/^\s*CREATE TABLE/i.test(sql)) return [{}];
    if (/INSERT INTO attendance_punch_edits/.test(sql)) return [{ insertId: 900 }];
    if (/information_schema/.test(sql)) return [[{ c: 'tenant_id' }]];
    return [[]];
  });
  return calls;
}
const userQ = [/FROM users WHERE id/, () => [[EMP]]];
const rowQ = [/SELECT \* FROM attendance WHERE id/, () => [[{ ...ROW }]]];
const REASON = { reason: '本人から誤打刻の連絡' };

beforeEach(() => jest.clearAllMocks());

describe('理由と権限', () => {
  it('理由なしは 400', async () => {
    fakeDb([userQ, rowQ]);
    await expect(voidPunch(req({ attendanceId: 77 }))).rejects.toMatchObject({ status: 400 });
  });
  it('「その他」は内容が必要', async () => {
    fakeDb([userQ, rowQ]);
    await expect(voidPunch(req({ attendanceId: 77, reason: 'その他' }))).rejects.toMatchObject({ status: 400 });
  });
  it('自分の打刻は編集できない', async () => {
    fakeDb([userQ, [/SELECT \* FROM attendance WHERE id/, () => [[{ ...ROW, userId: 5 }]]]]);
    await expect(voidPunch(req({ attendanceId: 77, ...REASON }))).rejects.toMatchObject({ status: 403 });
  });
  it('マネージャーは管理者の打刻を編集できない', async () => {
    fakeDb([[/FROM users WHERE id/, () => [[{ ...EMP, role: 'admin' }]]], rowQ]);
    await expect(voidPunch(req({ attendanceId: 77, ...REASON }))).rejects.toMatchObject({ status: 403 });
  });
  it('別の会社の社員は見つからない', async () => {
    const calls = fakeDb([[/FROM users WHERE id/, () => [[]]], rowQ]);
    await expect(voidPunch(req({ attendanceId: 77, ...REASON }))).rejects.toMatchObject({ status: 404 });
    expect(calls.find(c => /FROM users/.test(c.sql)).params).toEqual([23, 1]);
  });
});

describe('退勤の取消', () => {
  it('退勤を空にして、原本を履歴に残し、本人に通知', async () => {
    const calls = fakeDb([userQ, rowQ]);
    const r = await voidPunch(req({ attendanceId: 77, part: 'out', ...REASON }));
    expect(r).toEqual({ ok: true, editId: 900 });
    expect(calls.some(c => /UPDATE attendance SET checkOut = NULL/.test(c.sql))).toBe(true);
    expect(calls.some(c => /DELETE FROM attendance/.test(c.sql))).toBe(false);
    const ins = calls.find(c => /INSERT INTO attendance_punch_edits/.test(c.sql));
    expect(ins.params[4]).toBe('void_out');
    expect(JSON.parse(ins.params[5]).checkOut).toBe('2026-11-12 08:08:00');
    expect(ins.params[7]).toBe('本人から誤打刻の連絡');
    expect(audit.writeLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'punch_void_out' }));
    expect(notices.createNotice).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: 23, message: expect.stringContaining('08:08') }));
  });
});

describe('行ごとの取消と元に戻す', () => {
  it('行を丸ごと原本として残す', async () => {
    const calls = fakeDb([userQ, rowQ]);
    await voidPunch(req({ attendanceId: 77, part: 'row', reason: '二重打刻' }));
    const ins = calls.find(c => /INSERT INTO attendance_punch_edits/.test(c.sql));
    expect(ins.params[4]).toBe('void_row');
    expect(JSON.parse(ins.params[5]).row).toMatchObject({ id: 77, checkIn: ROW.checkIn });
  });
  it('元に戻すと同じ id で行が戻る', async () => {
    const edit = { id: 900, tenant_id: 1, user_id: 23, attendance_id: 77, work_date: '2026-11-12', action: 'void_row', before_json: JSON.stringify({ row: ROW }), restored_at: null };
    const calls = fakeDb([userQ, [/FROM attendance_punch_edits WHERE id/, () => [[edit]]], [/SELECT id FROM attendance WHERE id/, () => [[]]]]);
    await restorePunch(req({ editId: 900, ...REASON }));
    const ins = calls.find(c => /INSERT INTO attendance \(/.test(c.sql));
    expect(ins.params).toEqual([77, 23, ROW.checkIn, ROW.checkOut, 'simple']);
    expect(calls.some(c => /SET restored_at/.test(c.sql))).toBe(true);
  });
  it('退勤の取消は、もう新しい退勤があれば元に戻せない', async () => {
    const edit = { id: 901, tenant_id: 1, user_id: 23, attendance_id: 77, work_date: '2026-11-12', action: 'void_out', before_json: JSON.stringify({ checkOut: ROW.checkOut }), restored_at: null };
    fakeDb([userQ, [/FROM attendance_punch_edits WHERE id/, () => [[edit]]], [/SELECT id, checkIn, checkOut FROM attendance WHERE id/, () => [[{ id: 77, checkIn: ROW.checkIn, checkOut: '2026-11-12 17:31:00' }]]]]);
    await expect(restorePunch(req({ editId: 901, ...REASON }))).rejects.toMatchObject({ status: 409 });
  });
  it('一度戻したものは二度戻せない', async () => {
    const edit = { id: 902, tenant_id: 1, user_id: 23, action: 'void_out', restored_at: '2026-11-12 10:00:00' };
    fakeDb([userQ, [/FROM attendance_punch_edits WHERE id/, () => [[edit]]]]);
    await expect(restorePunch(req({ editId: 902, ...REASON }))).rejects.toMatchObject({ status: 409 });
  });
});

describe('修正と追加', () => {
  it('退勤を修正（出勤より前は不可）', async () => {
    fakeDb([userQ, rowQ]);
    await expect(editPunch(req({ attendanceId: 77, part: 'out', time: '07:30', ...REASON }))).rejects.toMatchObject({ status: 400 });
    const calls = fakeDb([userQ, rowQ]);
    await editPunch(req({ attendanceId: 77, part: 'out', time: '17:30', ...REASON }));
    expect(calls.find(c => /UPDATE attendance SET checkOut = \?/.test(c.sql)).params[0]).toBe('2026-11-12 17:30:00');
  });
  it('翌日の退勤', async () => {
    const calls = fakeDb([userQ, rowQ]);
    await editPunch(req({ attendanceId: 77, part: 'out', time: '01:00', nextDay: true, ...REASON }));
    expect(calls.find(c => /UPDATE attendance SET checkOut = \?/.test(c.sql)).params[0]).toBe('2026-11-13 01:00:00');
  });
  it('出勤・退勤を追加すると新しい行（会社つき）', async () => {
    const calls = fakeDb([userQ, [/INSERT INTO attendance \(userId/, () => [{ insertId: 55 }]]]);
    const r = await addPunch(req({ userId: 23, date: '2026-11-12', checkIn: '08:00', checkOut: '17:00', reason: '打刻忘れの申し出' }));
    expect(r.attendanceId).toBe(55);
    expect(calls.find(c => /INSERT INTO attendance \(userId/.test(c.sql)).params).toEqual([23, '2026-11-12 08:00:00', '2026-11-12 17:00:00', 1]);
  });
  it('退勤だけの追加は、退勤前の出勤に入れる', async () => {
    const calls = fakeDb([userQ, [/checkOut IS NULL AND DATE\(checkIn\)/, () => [[{ id: 77, checkIn: ROW.checkIn }]]]]);
    await addPunch(req({ userId: 23, date: '2026-11-12', checkOut: '17:31', reason: '打刻忘れの申し出' }));
    expect(calls.find(c => /UPDATE attendance SET checkOut = \? WHERE id = \?/.test(c.sql)).params).toEqual(['2026-11-12 17:31:00', 77]);
  });
});

describe('締め済みの月', () => {
  it('承認済みの月は 423', async () => {
    const utils = require('../../src/modules/attendance/attendance.utils');
    utils.assertMonthWritable.mockRejectedValueOnce(Object.assign(new Error('Locked'), { status: 423 }));
    const calls = fakeDb([userQ, rowQ]);
    await expect(voidPunch(req({ attendanceId: 77, ...REASON }))).rejects.toMatchObject({ status: 423, message: expect.stringContaining('締め済み') });
    expect(calls.some(c => /UPDATE attendance/.test(c.sql))).toBe(false);
  });
});

describe('dayHistory（履歴 › 表示）', () => {
  const histReq = (role, userId, uid = 5) => ({ user: { id: uid, role }, tenantId: 1, query: { userId, date: '2026-11-13' } });
  it('本人は他の社員の履歴を見られない', async () => {
    fakeDb([userQ]);
    await expect(pe._impl.dayHistory(histReq('employee', 23))).rejects.toMatchObject({ status: 403 });
  });
  it('本人の打刻・管理者の修正・承認した調整申請を新しい順に', async () => {
    fakeDb([
      userQ,
      [/FROM audit_logs/, () => [[{ action: 'checkin', created_at: '2026-11-13 08:19:08', afterData: JSON.stringify({ result: { checkIn: '2026-11-13 08:19:08' } }) }]]],
      [/FROM attendance_punch_edits e LEFT JOIN users/, () => [[{ action: 'edit_in', reason: '本人から誤打刻の連絡', before_json: JSON.stringify({ checkIn: '2026-11-13 08:19:08' }), after_json: JSON.stringify({ checkIn: '2026-11-13 08:00:00' }), created_at: '2026-11-13 09:45:26', byName: '鈴木', byRole: 'manager' }]]],
      [/FROM time_adjust_requests/, () => [[]]]
    ]);
    const r = await pe._impl.dayHistory(histReq('manager', 23));
    expect(r.events.map(e => [e.kind, e.at])).toEqual([['admin', '2026-11-13 09:45'], ['self', '2026-11-13 08:19']]);
    expect(r.events[0].text).toBe('出勤 08:19 → 08:00 に修正');
    expect(r.events[1].time).toBe('08:19');
    expect(r.changeCount).toBe(1);
  });
});

describe('describeEdits', () => {
  it('✎ の説明文', () => {
    expect(pe.describeEdits([{ action: 'void_out', reason: '二重打刻', before: { checkOut: '2026-11-12 08:08:00' } }]))
      .toEqual(['退勤 08:08 を取消（二重打刻）']);
  });
});
