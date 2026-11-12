'use strict';
// 月次勤怠記録（複数社員×1ヶ月分を1画面で見る新しいレジャー画面）専用コントローラー。
// 既存の legacy-attendance.page.js（1日単位のロスター）とは別の新規ルートから使う —
// 実働/法定外残業/深夜の計算は attendance.rules.js の computeRange をそのまま再利用し、
// 二重実装しない。
//
// 200人規模を想定: ユーザーごとに毎回クエリを投げる (N+1) と遅すぎるので、
// listByUserIdsBetween/listDailyBetweenForUsers で1クエリにまとめて取得し、
// 一覧はページング (デフォルト100行/ページ) して返す。集計カードは全件で計算する。

const repo = require('./attendance.repository');
const userRepo = require('../users/user.repository');
const departmentRepo = require('../departments/department.repository');
const { computeRange } = require('./attendance.rules');
const ExcelJS = require('exceljs');

function _pad(n) { return String(n).padStart(2, '0'); }
function _lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function todayJST() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

// computeRange は checkOut が無い(＝退勤前でまだ勤務中の)行を集計から除外するため
// (月次確定計算が目的で、未完了の日は計算できないのは正しい)、そこだけを見ると
// 「出勤中」の社員が勤怠記録に一切出てこない。ライブ状況表示のため、checkOut が
// まだ無い raw の出勤打刻だけは別途拾っておく。
function jstDateOf(val) {
  if (!val) return '';
  const s = typeof val === 'string' ? val : String(val);
  const p = s.split(' ')[0].split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

const HOLIDAY_WORK_KUBUN = new Set(['休日出勤', '法定休日出勤', '代替出勤']);

function fmtHm(v) {
  if (!v) return '';
  try {
    const s = typeof v === 'string' ? v : new Date(v).toISOString();
    const m = /T?(\d{2}):(\d{2})/.exec(s.replace(' ', 'T'));
    return m ? `${m[1]}:${m[2]}` : '';
  } catch { return ''; }
}

// month-ledger / export.xlsx 共通のデータ組み立て (ユーザー×日付の全行 + 集計)。
// ページングはこの関数の外 (呼び出し側) でやる — export は全件必要なため。
async function buildLedgerRows({ tenantId, month, departmentId }) {
    const [y, m] = month.split('-').map(n => parseInt(n, 10));
    const lastDay = _lastDay(y, m);
    const from = `${month}-01`;
    const to = `${month}-${_pad(lastDay)}`;

    const { rows: users } = await userRepo.listUsersPaged({
      role: 'employee',
      departmentId,
      employmentStatus: 'active',
      limit: 5000,
      tenantId
    });
    const userIds = users.map(u => u.id);
    const userMap = new Map(users.map(u => [u.id, u]));

    // ユーザーごとに毎回クエリを投げず、全員分を1クエリずつ (計2クエリ) で取得する
    const [allRawRows, allDailyRows] = userIds.length
      ? await Promise.all([
          repo.listByUserIdsBetween(userIds, from, to, { tenantId }),
          repo.listDailyBetweenForUsers(userIds, from, to, { tenantId })
        ])
      : [[], []];

    const dailyByUser = new Map();
    for (const d of allDailyRows) {
      const uid = d.userId;
      if (!dailyByUser.has(uid)) dailyByUser.set(uid, new Map());
      dailyByUser.get(uid).set(String(d.date).slice(0, 10), d);
    }

    const { days } = await computeRange(allRawRows, tenantId || 0);
    // 社員+日 → その日の行（出勤の早い順）。1つ目がその日の行、2つ目以降は 追加勤務
    const itemsByUserDate = new Map();
    for (const day of days) {
      for (const item of day.items) {
        const key = `${item.userId}|${item.date}`;
        if (!itemsByUserDate.has(key)) itemsByUserDate.set(key, []);
        itemsByUserDate.get(key).push(item);
      }
    }
    for (const list of itemsByUserDate.values()) list.sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')));
    const computedByUserDate = new Map();
    for (const [key, list] of itemsByUserDate) computedByUserDate.set(key, list[0]);

    // 退勤前(checkOutがまだ無い)の出勤打刻を拾う — computeRangeの集計対象外なので別扱い。
    const openCheckInByUserDate = new Map();
    for (const r of allRawRows) {
      if (r.checkIn && !r.checkOut) {
        openCheckInByUserDate.set(`${r.userId}|${jstDateOf(r.checkIn)}`, r.checkIn);
      }
    }

    const rows = [];
    const totals = { attendDays: 0, regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, holidayWorkMinutes: 0,
      actualWorkedMinutes: 0, actualOvertimeMinutes: 0, actualHolidayWorkMinutes: 0 };

    for (const u of users) {
      const dailyMap = dailyByUser.get(u.id) || new Map();
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${month}-${_pad(d)}`;
        const daily = dailyMap.get(dateStr) || null;
        const computed = computedByUserDate.get(`${u.id}|${dateStr}`) || null;
        const openCheckIn = !computed ? openCheckInByUserDate.get(`${u.id}|${dateStr}`) : null;
        const kubun = daily?.kubun || (computed ? '通常' : (openCheckIn ? '出勤' : ''));
        if (!daily && !computed && !openCheckIn) continue; // ノーデータの日は出さない
        const isHolidayWork = HOLIDAY_WORK_KUBUN.has(kubun);
        const isOff = ['休日', '法定休日', '休み'].includes(kubun) && !computed;
        if (computed) {
          totals.attendDays += 1;
          totals.regularMinutes += computed.regularMinutes || 0;
          totals.overtimeMinutes += computed.overtimeMinutes || 0;
          totals.nightMinutes += computed.nightMinutes || 0;
          if (isHolidayWork) totals.holidayWorkMinutes += (computed.regularMinutes || 0) + (computed.overtimeMinutes || 0);
          totals.actualWorkedMinutes += computed.actualWorkedMinutes || 0;
          totals.actualOvertimeMinutes += computed.actualOvertimeMinutes || 0;
          if (isHolidayWork) totals.actualHolidayWorkMinutes += computed.actualWorkedMinutes || 0;
        }
        rows.push({
          date: dateStr,
          userId: u.id,
          employeeCode: u.employee_code,
          username: u.username,
          departmentId: u.departmentId,
          kubun: isOff ? (kubun || '休日') : (kubun || '通常'),
          checkIn: computed ? fmtHm(computed.checkIn) : (openCheckIn ? fmtHm(openCheckIn) : ''),
          checkOut: computed ? fmtHm(computed.checkOut) : '',
          // 丸め後の出勤・退勤 (出勤は30分切り上げ、退勤は30分切り捨て) と 実績(丸め前)の実働・残業
          roundedIn: computed?.roundedIn || '',
          roundedOut: computed?.roundedOut || '',
          actualWorkedMinutes: computed?.actualWorkedMinutes || 0,
          actualOvertimeMinutes: computed?.actualOvertimeMinutes || 0,
          // daily.break_minutes chỉ có giá trị khi ai đó từng NHẬP TAY (admin sửa,
          // hoặc nhân viên tự lưu qua 簡易登録画面) — nếu chưa ai đụng tới thì vẫn
          // NULL dù giờ công (実働) đã trừ đúng giờ nghỉ mặc định của ca. Hiện fallback
          // sang computed.breakMinutes (giờ nghỉ THẬT đã dùng để tính 実働) thay vì để
          // trống, tránh hiểu nhầm "chưa nghỉ trưa" trong khi thực ra đã trừ rồi.
          breakMinutes: daily?.break_minutes ?? computed?.breakMinutes ?? null,
          regularMinutes: computed?.regularMinutes || 0,
          overtimeMinutes: computed?.overtimeMinutes || 0,
          nightMinutes: computed?.nightMinutes || 0,
          isHolidayWork,
          // 月次勤怠入力画面は列ごとに別カラム: 作業内容→attendance_daily.memo、
          // 理由(遅刻/早退)→.reason、備考→.notes。勤怠記録の備考は同画面の「備考」列
          // (.notes)とだけ揃える — .memoは実は「作業内容」の中身なので出さない
          // (これを備考に出していたせいで作業内容が混ざって見えていた)。
          memo: daily?.notes || null
        });
        // 2行目以降（追加勤務。例: 退勤後の社内会議）はすぐ下に別の行で出す
        const extras = (itemsByUserDate.get(`${u.id}|${dateStr}`) || []).slice(1);
        for (const ex of extras) {
          totals.regularMinutes += ex.regularMinutes || 0;
          totals.overtimeMinutes += ex.overtimeMinutes || 0;
          totals.nightMinutes += ex.nightMinutes || 0;
          if (isHolidayWork) totals.holidayWorkMinutes += (ex.regularMinutes || 0) + (ex.overtimeMinutes || 0);
          totals.actualWorkedMinutes += ex.actualWorkedMinutes || 0;
          totals.actualOvertimeMinutes += ex.actualOvertimeMinutes || 0;
          if (isHolidayWork) totals.actualHolidayWorkMinutes += ex.actualWorkedMinutes || 0;
          rows.push({
            date: dateStr,
            userId: u.id,
            employeeCode: u.employee_code,
            username: u.username,
            departmentId: u.departmentId,
            kubun: '追加勤務',
            isExtra: true,
            checkIn: fmtHm(ex.checkIn),
            checkOut: fmtHm(ex.checkOut),
            roundedIn: ex.roundedIn || '',
            roundedOut: ex.roundedOut || '',
            actualWorkedMinutes: ex.actualWorkedMinutes || 0,
            actualOvertimeMinutes: ex.actualOvertimeMinutes || 0,
            breakMinutes: ex.breakMinutes ?? 0,
            regularMinutes: ex.regularMinutes || 0,
            overtimeMinutes: ex.overtimeMinutes || 0,
            nightMinutes: ex.nightMinutes || 0,
            isHolidayWork,
            // 追加勤務の 作業内容（例: 社内会議）
            memo: ex.memo || null
          });
        }
      }
    }

    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (userMap.get(a.userId)?.username || '').localeCompare(userMap.get(b.userId)?.username || '')));

    return { rows, totals, users, userMap };
}

// GET /api/admin/attendance/month-ledger?month=YYYY-MM&departmentId=&page=&pageSize=
exports.getMonthLedger = async (req, res) => {
  try {
    const month = String(req.query.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Missing/invalid month (YYYY-MM)' });
    const tenantId = req.tenantId || null;
    const departmentId = req.query.departmentId || null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.pageSize, 10) || 100));

    const { rows, totals } = await buildLedgerRows({ tenantId, month, departmentId });
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

    // 本日時点の稼働状況（出勤中/退勤済/休日・休暇）— 旧勤怠記録画面にあったチップをこのページにも表示する。
    // ページング前の全件(rows)から数える — 表示中のページだけだと人数が漏れるため。
    const today = todayJST();
    let workingCount = 0;
    let checkedOutCount = 0;
    let offOrLeaveCount = 0;
    for (const r of rows) {
      if (r.isExtra) continue;
      if (r.date !== today) continue;
      if (r.checkIn && !r.checkOut) workingCount++;
      else if (r.checkIn && r.checkOut) checkedOutCount++;
      else offOrLeaveCount++;
    }

    res.status(200).json({
      month,
      totals: {
        attendDays: totals.attendDays,
        regularMinutes: totals.regularMinutes,
        overtimeMinutes: totals.overtimeMinutes,
        nightMinutes: totals.nightMinutes,
        holidayWorkMinutes: totals.holidayWorkMinutes,
        actualWorkedMinutes: totals.actualWorkedMinutes,
        actualOvertimeMinutes: totals.actualOvertimeMinutes,
        actualHolidayWorkMinutes: totals.actualHolidayWorkMinutes
      },
      todayStatus: { date: today, working: workingCount, checkedOut: checkedOutCount, offOrLeave: offOrLeaveCount },
      page, pageSize, total, pages: pageCount,
      rows: pageRows
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
function weekdayJa(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_JA[d.getUTCDay()] || '';
}
function hm(min) {
  const n = Math.round(Number(min) || 0);
  const h = Math.floor(n / 60);
  const mm = n % 60;
  return `${h}:${String(mm).padStart(2, '0')}`;
}

// GET /api/attendance/ledger/export.xlsx?month=YYYY-MM&departmentId=
exports.exportXlsx = async (req, res) => {
  try {
    const month = String(req.query.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Missing/invalid month (YYYY-MM)' });
    const tenantId = req.tenantId || null;
    const departmentId = req.query.departmentId || null;
    // 画面の 実績/丸め 切替に合わせる (既定は 丸め = 従来の出力)
    const isActual = String(req.query.mode || '') === 'actual';

    const [{ rows }, departments] = await Promise.all([
      buildLedgerRows({ tenantId, month, departmentId }),
      departmentRepo.getAllDepartments(tenantId, { includeInactive: true }).catch(() => [])
    ]);
    const deptNameById = new Map((departments || []).map(d => [Number(d.id), d.name]));

    const columns = [
      { header: '日付', width: 13 },
      { header: '曜日', width: 7 },
      { header: '社員', width: 15 },
      { header: '部署', width: 13 },
      { header: '区分', width: 11 },
      { header: '出勤', width: 9 },
      { header: '退勤', width: 9 },
      { header: '休憩(分)', width: 11 },
      { header: '実働', width: 9 },
      { header: '法定外残業', width: 13 },
      { header: '深夜', width: 9 },
      { header: '休日', width: 9 },
      { header: '備考', width: 26 }
    ];
    const xlsxRows = rows.map(r => {
      const workedMinutes = isActual ? (r.actualWorkedMinutes || 0) : (r.regularMinutes || 0) + (r.overtimeMinutes || 0);
      const overtimeMinutes = isActual ? (r.actualOvertimeMinutes || 0) : (r.overtimeMinutes || 0);
      const holidayMinutes = r.isHolidayWork ? workedMinutes : 0;
      return [
        r.date,
        weekdayJa(r.date),
        r.username || '',
        deptNameById.get(Number(r.departmentId)) || '',
        r.kubun || '',
        (isActual ? r.checkIn : (r.roundedIn || r.checkIn)) || '',
        (isActual ? r.checkOut : (r.roundedOut || r.checkOut)) || '',
        r.breakMinutes ?? '',
        hm(workedMinutes),
        hm(overtimeMinutes),
        hm(r.nightMinutes),
        hm(holidayMinutes),
        r.memo || ''
      ];
    });

    // ユーザー提供のExcel雛形に合わせた配色 (共通utils/xlsxの標準スタイルとは別に、
    // このエクスポート専用でヘッダーはえんじ色、データ行は薄いピンクで塗る)。
    const HEADER_FILL = 'FFE74C3C';
    const ROW_FILL = 'FFFBE1E1';
    const BORDER_COLOR = 'FFE8B4B4';
    const thinBorder = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } }
    };

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(`勤怠記録_${month}_${isActual ? '実績' : '丸め'}`.slice(0, 31));
    ws.columns = columns.map(c => ({ header: c.header, width: c.width }));
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

    const headerRow = ws.getRow(1);
    columns.forEach((c, ci) => {
      const cell = headerRow.getCell(ci + 1);
      cell.font = { name: 'MS Pゴシック', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder;
    });
    headerRow.height = 20;

    xlsxRows.forEach((cells, ri) => {
      const wsRow = ws.getRow(ri + 2);
      cells.forEach((v, ci) => {
        const cell = wsRow.getCell(ci + 1);
        cell.value = v;
        cell.font = { name: 'MS Pゴシック', size: 11, color: { argb: 'FF000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_FILL } };
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: ci === 12 ? 'left' : 'center' };
      });
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `attendance_ledger_${month}_${isActual ? 'actual' : 'rounded'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
