/**
 * 入力用Excel の 遅刻/早退 判定のテスト (画面 attendance-monthly.render.js と同じルール)。
 * 夜勤 (日をまたぐシフト) で、翌朝の定時退勤が「早退」にならないこと。
 */
'use strict';

const { _lateEarlyLabel: label } = require('../../src/modules/attendance/attendance.export.monthly');

const m = (hm) => { const [h, mi] = hm.split(':').map(Number); return h * 60 + mi; };

describe('Excel 遅刻/早退', () => {
  it('日勤: 定時どおりなら空欄', () => {
    expect(label(m('08:00'), m('17:00'), m('08:00'), m('17:00'), false)).toBe('');
  });
  it('日勤: 遅れて出勤、早く退勤', () => {
    expect(label(m('08:10'), m('17:00'), m('08:00'), m('17:00'), false)).toBe('遅刻');
    expect(label(m('08:00'), m('16:30'), m('08:00'), m('17:00'), false)).toBe('早退');
    expect(label(m('08:10'), m('16:30'), m('08:00'), m('17:00'), false)).toBe('遅刻/早退');
  });
  it('夜勤 22:00-06:00: 翌朝 06:00 退勤は早退ではない', () => {
    expect(label(m('22:00'), m('06:00'), m('22:00'), m('06:00'), false)).toBe('');
  });
  it('夜勤 22:00-06:00: 翌朝 07:00 退勤 (残業) も早退ではない', () => {
    expect(label(m('22:00'), m('07:00'), m('22:00'), m('06:00'), false)).toBe('');
  });
  it('夜勤 22:00-06:00: 翌朝 05:00 退勤は早退', () => {
    expect(label(m('22:00'), m('05:00'), m('22:00'), m('06:00'), false)).toBe('早退');
  });
  it('夜勤 22:00-06:00: 日付が変わる前 23:30 に退勤は早退', () => {
    expect(label(m('22:00'), m('23:30'), m('22:00'), m('06:00'), false)).toBe('早退');
  });
  it('休日出勤は 遅刻/早退 を付けない', () => {
    expect(label(m('09:00'), m('15:00'), m('08:00'), m('17:00'), true)).toBe('');
  });
});
