/**
 * 半休の 午前休 / 午後休: シフト申請の値の分け方・戻し方
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn(async () => [[]]), getConnection: jest.fn() }));

const ctrl = require('../../src/modules/attendance/attendance.shifts.controller');

describe('シフト申請の 半休', () => {
  it('画面の値を 種類 と 午前・午後 に分ける（種類は今までどおり）', () => {
    expect(ctrl._splitHalfLeave('paid_half_am')).toEqual({ leaveType: 'paid_half', halfPeriod: 'am' });
    expect(ctrl._splitHalfLeave('half_pm')).toEqual({ leaveType: 'half', halfPeriod: 'pm' });
    expect(ctrl._splitHalfLeave('paid')).toEqual({ leaveType: 'paid', halfPeriod: null });
    expect(ctrl._splitHalfLeave(null)).toEqual({ leaveType: null, halfPeriod: null });
  });
  it('読み込み時は 画面の値 に戻す。午前・午後 が無い以前の申請はそのまま', () => {
    expect(ctrl._joinHalfLeave({ leaveType: 'paid_half', half_period: 'pm' })).toMatchObject({ leaveType: 'paid_half_pm', halfPeriod: 'pm' });
    expect(ctrl._joinHalfLeave({ leaveType: 'paid_half', half_period: null })).toEqual({ leaveType: 'paid_half', half_period: null });
    expect(ctrl._joinHalfLeave({ leaveType: 'paid', half_period: 'am' })).toEqual({ leaveType: 'paid', half_period: 'am' });
  });
});
