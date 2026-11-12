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
      .mockResolvedValueOnce([[{ userId: 20, ym: '2026-09', offDays: 8, paidDays: 2, otherLeaveDays: 0 }]])
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

  it("allMonths: 承認待ちは月で絞らない（SQLに日付条件を付けない）", async () => {
    await fetchMerged({ tenantId: 1, month: "2026-11", dept: "", userId: null, status: "", q: "", allMonths: true });
    const [leaveSql, leaveParams] = db.query.mock.calls[0];
    const [adjSql, adjParams] = db.query.mock.calls[1];
    expect(leaveParams).not.toContain("2026-11-01");
    expect(adjSql).not.toContain('created_at) BETWEEN');
    expect(adjParams).toEqual([1]);
  });

  it("調整申請は作成日の月で数え、出勤/退勤が別の日なら日付も表示する", async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 9, userId: 23, requestedCheckIn: "2026-10-07 08:00:00", requestedCheckOut: "2026-10-08 17:00:00", reason: "打刻し忘れ", status: "pending", created_at: "2026-11-06 10:04:00", username: "employee" }]]);
    const rows = await fetchMerged({ tenantId: 1, month: "2026-11", dept: "", userId: null, status: "", q: "" });
    const [adjSql, adjParams] = db.query.mock.calls[1];
    expect(adjSql).toContain('DATE(tar.created_at) BETWEEN');
    expect(adjParams.slice(0, 2)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(rows[0].content).toBe("出勤 10/07 08:00 / 退勤 10/08 17:00");
    expect(rows[0].createdAt).toBe("2026-11-06");
  });
});

describe('fillDefaultProcessor（処理者の記録がない処理済み申請）', () => {
  const { fillDefaultProcessor } = require('../../src/modules/requestsHub/requestsHub.admin.routes');

  it('本人に設定されたマネージャーの名前を出す。承認待ち・記録ありはそのまま', async () => {
    db.query.mockResolvedValueOnce([[{ id: 10, departmentId: 1, tenant_id: 1, m_name: '鈴木' }]]);
    const rows = [
      { userId: 10, status: 'approved', processedByName: null },
      { userId: 10, status: 'pending', processedByName: null },
      { userId: 10, status: 'rejected', processedByName: '佐藤' }
    ];
    await fillDefaultProcessor(rows, 1);
    expect(rows.map(r => r.processedByName)).toEqual(['鈴木', null, '佐藤']);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('マネージャー未設定なら同じ部署の manager → admin を、全員分まとめて1回で引く', async () => {
    db.query
      .mockResolvedValueOnce([[
        { id: 10, departmentId: 1, tenant_id: 1, m_name: null },
        { id: 11, departmentId: 2, tenant_id: 1, m_name: null }
      ]])
      .mockResolvedValueOnce([[
        { id: 5, tenant_id: 1, departmentId: 1, role: 'admin', full_name: '管理 太郎', username: 'adm' },
        { id: 7, tenant_id: 1, departmentId: 1, role: 'manager', full_name: '', username: 'mgr1' },
        { id: 8, tenant_id: 1, departmentId: 2, role: 'admin', full_name: '部長', username: 'a2' }
      ]]);
    const rows = [{ userId: 10, status: 'approved' }, { userId: 11, status: 'approved' }];
    await fillDefaultProcessor(rows, 1);
    expect(rows.map(r => r.processedByName)).toEqual(['mgr1', '部長']);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('シフト提出: processed_by 列が無い DB', () => {
  it('列なしで取り直して一覧は出る', async () => {
    const bad = Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR', errno: 1054 });
    db.query.mockImplementation(async (sql) => {
      if (/FROM shift_month_status/.test(sql) && /processed_by/.test(sql)) throw bad;
      if (/FROM shift_month_status/.test(sql)) return [[{ id: 3, userId: 10, month: '2026-11', status: 'PENDING', username: '長野' }]];
      return [[]];
    });
    const rows = await fetchMerged({ tenantId: 1, month: '2026-11' });
    expect(rows.find(r => r.category === 'shift')).toBeTruthy();
  });
});
