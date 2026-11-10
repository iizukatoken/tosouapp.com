/**
 * 申請・承認 統合ビュー: leave_requests + time_adjust_requests を
 * 1本のリストに正規化・ソートするロジックのテスト。
 * DBは core/database/mysql をモックし、実DBは使わない。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({
  query: jest.fn()
}));

jest.mock('../../src/core/middleware/authMiddleware', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next()
}));

jest.mock('../../src/core/middleware/tenantMiddleware', () => ({
  resolveTenant: (req, res, next) => next()
}));

const db = require('../../src/core/database/mysql');
const { fetchMerged } = require('../../src/modules/requestsHub/requestsHub.admin.routes');

beforeEach(() => {
  jest.clearAllMocks();
  // シフト/プロフィール/その他/警告 の追加クエリは既定で空
  db.query.mockResolvedValue([[]]);
});

describe('fetchMerged', () => {
  it('有給申請と打刻修正を1本のリストにまとめ、日付の新しい順に並べる', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 1, userId: 10, startDate: '2026-09-05', endDate: '2026-09-05', type: 'paid',
          reason: '私用', status: 'pending', processed_by: null, processed_at: null,
          employeeCode: 'EMP010', username: '山田太郎', departmentId: 1, departmentName: '工事部',
          processedByName: null
        }
      ]])
      .mockResolvedValueOnce([[
        {
          id: 2, userId: 11, requestedCheckIn: '2026-09-09 07:00:00', requestedCheckOut: '2026-09-09 17:00:00',
          reason: '出勤時刻の修正', status: 'rejected', created_at: '2026-09-09 18:00:00',
          processed_by: 5, processed_at: '2026-09-11 15:20:00',
          employeeCode: 'EMP011', username: '佐藤花子', departmentId: 1, departmentName: '工事部',
          processedByName: '鈴木一郎'
        }
      ]]);

    const rows = await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });

    expect(rows).toHaveLength(2);
    // sortDate 降順 (09/09 が 09/05 より前に来る)
    expect(rows[0].type).toBe('adjust');
    expect(rows[0].typeLabel).toBe('打刻修正');
    expect(rows[0].content).toBe('出勤 07:00 / 退勤 17:00');
    expect(rows[0].processedByName).toBe('鈴木一郎');
    expect(rows[1].type).toBe('leave');
    expect(rows[1].typeLabel).toBe('有給申請');
    expect(rows[1].content).toBe('有給休暇（全日）');
    expect(rows[1].targetDate).toBe('2026-09-05');
  });

  it('有給申請が複数日にまたがる場合は範囲表示になり（全日）は付かない', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 3, userId: 12, startDate: '2026-09-20', endDate: '2026-09-22', type: 'paid',
          reason: '旅行', status: 'approved', processed_by: 5, processed_at: '2026-09-15 10:00:00',
          employeeCode: 'EMP012', username: '田中健', departmentId: null, departmentName: null,
          processedByName: '鈴木一郎'
        }
      ]])
      .mockResolvedValueOnce([[]]);

    const rows = await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });

    expect(rows).toHaveLength(1);
    expect(rows[0].targetDate).toBe('2026-09-20〜2026-09-22');
    expect(rows[0].content).toBe('有給休暇');
  });

  it('勤怠画面のkubun変更で自動生成された有給行(from_attendance/[AUTO_CANCEL]等)は除外するSQLになっている', async () => {
    db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });
    const [leaveSql] = db.query.mock.calls[0];
    expect(leaveSql).toMatch(/from_attendance/);
    expect(leaveSql).toMatch(/AUTO_CANCEL/);
    expect(leaveSql).toMatch(/AUTO_RECONCILE/);
  });

  it('シフト提出・プロフィール変更・その他の申請もまとめ、それぞれの承認APIを持つ', async () => {
    db.query
      .mockResolvedValueOnce([[]]) // leave
      .mockResolvedValueOnce([[]]) // adjust
      .mockResolvedValueOnce([[{ id: 7, userId: 20, month: '2026-09', status: 'PENDING', updated_at: null, employeeCode: 'E20', username: '高橋', departmentName: '工事部' }]])
      .mockResolvedValueOnce([[{ userId: 20, offDays: 8, paidDays: 2, otherLeaveDays: 0 }]])
      .mockResolvedValueOnce([[{ id: 3, userId: 21, fields_json: JSON.stringify({ phone: '090', role: 'admin' }), status: 'pending', created_at: '2026-09-03 10:00:00', approved_at: null, username: '伊藤' }]])
      .mockResolvedValueOnce([[{ id: 9, userId: 22, request_no: 'R-1', record_type: '残業申請', detail: '9/10 2時間', office: '', status: '申請済み', created_at: '2026-09-10 09:00:00', updated_at: null, username: '渡辺' }]]);

    const rows = await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });
    const byType = Object.fromEntries(rows.map(r => [r.type, r]));

    expect(byType.shift.content).toBe('休日 8日 / 有給 2日');
    expect(byType.shift.actions.approve.body).toEqual({ userId: 20, month: '2026-09', status: 'APPROVED' });
    // プロフィール: 個人情報だけ表示 (role は出さない)
    expect(byType.profile.content).toBe('電話: 090');
    expect(byType.profile.actions.approve.url).toBe('/api/manager/profile-change/3/status');
    expect(byType.other.typeLabel).toBe('残業申請');
    expect(byType.other.status).toBe('pending');
    expect(byType.other.actions.approve.url).toBe('/api/admin/requests/other/9/status');
  });

  it('シフト由来の有給は個別に承認/却下できず、区分由来の欠勤は休暇申請として出る', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 4, userId: 10, startDate: '2026-09-08', endDate: '2026-09-08', type: 'paid', reason: 'from_shift', status: 'approved', username: 'A' },
      { id: 5, userId: 10, startDate: '2026-09-09', endDate: '2026-09-09', type: 'absence', reason: 'from_kubun', status: 'pending', username: 'A' }
    ]]);
    const rows = await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });
    const shiftPaid = rows.find(r => r.requestId === 4);
    const absence = rows.find(r => r.requestId === 5);
    expect(shiftPaid.actions).toBeNull();
    expect(shiftPaid.reason).toBe('シフト提出より');
    expect(absence.typeLabel).toBe('休暇申請');
    expect(absence.content).toBe('欠勤（全日）');
    expect(absence.actions.reject.url).toBe('/api/leave/5/status');
  });

  it('却下した有給なのに月次表が有給のままなら警告を付ける', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 6, userId: 10, startDate: '2026-09-15', endDate: '2026-09-15', type: 'paid', reason: '', status: 'rejected', username: 'A' }]])
      .mockResolvedValueOnce([[]]) // adjust
      .mockResolvedValueOnce([[]]) // shift
      .mockResolvedValueOnce([[]]) // profile
      .mockResolvedValueOnce([[]]) // other
      .mockResolvedValueOnce([[{ userId: 10, date: '2026-09-15' }]]); // attendance_daily
    const rows = await fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' });
    expect(rows[0].warning).toMatch(/有給のまま/);
  });

  it('まだ作られていないテーブル (ER_NO_SUCH_TABLE) は空として扱う', async () => {
    const noTable = Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' });
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(noTable)
      .mockRejectedValueOnce(noTable)
      .mockRejectedValueOnce(noTable);
    await expect(fetchMerged({ tenantId: 1, month: '2026-09', dept: '', userId: null, status: '', q: '' })).resolves.toEqual([]);
  });
});
