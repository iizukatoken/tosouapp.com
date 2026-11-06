'use strict';
/**
 * attendance.export.monthly.js
 * Xuất Excel chấm công theo tháng (exportMonthXlsx).
 * Tách ra từ attendance.export.controller.js cho dễ bảo trì.
 */
const service = require('./attendance.service');
const auditRepo = require('../audit/audit.repository');
const rules = require('./attendance.rules');
const repo = require('./attendance.repository');
const { formatInputToMySQLJST } = require('../../utils/dateTime');
const userRepo = require('../users/user.repository');
const workReportRepo = require('../workReports/workReports.repository');
const salaryInputRepo = require('../salary/salaryInput.repository');
const leaveRepo = require('../leave/leave.repository');
const noticesRepo = require('../notices/notices.repository');
const db = require('../../core/database/mysql');
const calendarRepo = require('../calendar/calendar.repository');
const log = require('../../core/logger');
const {
  resolveTargetUserId, parseMonth, isEditableMonth, getMonthStatusValue,
  assertMonthWritable,
  getUserOffDaySet
} = require('./attendance.utils');
const { timesheetMaxDays } = require('../../config/env');
const { classifyDay } = require('./attendance.dayCount');

// 遅刻/早退 の表示 (分単位の出勤・退勤・ca). Khớp đúng rule bảng tháng (attendance-monthly.render.js):
// muộn nếu vào > giờ ca bắt đầu, sớm nếu ra < giờ ca kết thúc. Ca qua đêm (vd 22:00-06:00): giờ kết thúc
// và giờ ra sau 0:00 cộng 24h trước khi so sánh, nếu không ra 06:00 bị tính là 早退.
// 退勤が未打刻 (outMin = null) でも 遅刻 は出勤時刻だけで判定する (画面と同じ)。
function lateEarlyLabel(inMin, outMin, startMin, endMin, isHolidayWork) {
  if (isHolidayWork) return '';
  const late = inMin != null && inMin > startMin;
  const overnight = endMin < startMin;
  const endAbs = overnight ? endMin + 24 * 60 : endMin;
  const outAbs = outMin == null ? null : (overnight && outMin < startMin ? outMin + 24 * 60 : outMin);
  const early = outAbs != null && outAbs < endAbs;
  if (late && early) return '遅刻/早退';
  if (late) return '遅刻';
  if (early) return '早退';
  return '';
}
exports._lateEarlyLabel = lateEarlyLabel;
const { nowJSTMySQL } = require('../../utils/dateTime');

exports.exportMonthXlsx = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.query || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    const pad = (n) => String(n).padStart(2, '0');
    const y = parseInt(year, 10), m = parseInt(month, 10);
    if (!y || !m) return res.status(400).json({ message: 'Invalid year/month' });
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${y}-${pad(m)}-01`;
    const to = `${y}-${pad(m)}-${pad(lastDay)}`;
    const monthStatusObj = await repo.getMonthStatus(userId, y, m).catch(() => null);
    const monthStatus = String(monthStatusObj?.status || '').trim() || 'draft';
    const monthApproverName = monthStatus === 'approved' ? String(monthStatusObj?.approved_by_name || '') : '';
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'payroll' && monthStatus !== 'approved') {
      return res.status(403).json({ message: 'Forbidden: month is not closed' });
    }

    const user = await userRepo.getUserById(userId).catch(() => null);
    const employeeCode = String(user?.employee_code || user?.employeeCode || '').trim();
    const employeeName = String(
      user?.full_name ||
      user?.fullName ||
      user?.display_name ||
      user?.displayName ||
      user?.name ||
      user?.username ||
      user?.email ||
      employeeCode ||
      (userId ? `社員${userId}` : '') ||
      ''
    ).trim();

    // 承認者 (Excel): tháng đã 承認 → người duyệt; chưa → マネージャー của nhân viên (社員管理, users.manager_id);
    // chưa gán → manager rồi admin cùng phòng ban (đang làm việc); không có → người đang xuất nếu là manager/admin.
    // Nhân viên tự xuất file cũng thấy tên người quản lý.
    const displayName = (u) => String(u?.full_name || u?.fullName || u?.display_name || u?.username || '').trim();
    const approverDisplayName = await (async () => {
      if (monthApproverName) return monthApproverName;
      const mid = user?.manager_id || user?.managerId;
      if (mid) {
        // マネージャーは users.tenant_id が別会社でも tenant_users でこの会社に所属していることがある
        const tidM = user?.tenant_id ?? req.tenantId ?? null;
        const [mrows] = await db.query(
          `SELECT u.full_name, u.username FROM users u
             LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = ?
            WHERE u.id = ? AND (? IS NULL OR u.tenant_id = ? OR tu.tenant_id = ?) LIMIT 1`,
          [tidM, mid, tidM, tidM, tidM]
        ).catch(() => [[]]);
        const nmM = displayName(Array.isArray(mrows) ? mrows[0] : null);
        if (nmM) return nmM;
      }
      const deptId = user?.departmentId ?? user?.department_id ?? null;
      const tid = user?.tenant_id ?? req.tenantId ?? null;
      if (deptId != null && tid != null) {
        for (const r of ['manager', 'admin']) {
          const [found] = await db.query(
            `SELECT full_name, username FROM users
              WHERE tenant_id = ? AND departmentId = ? AND role = ? AND id <> ?
                AND (employment_status IS NULL OR employment_status = 'active')
              ORDER BY id LIMIT 1`,
            [tid, deptId, r, userId]
          ).catch(() => [[]]);
          const nm = displayName(Array.isArray(found) ? found[0] : null);
          if (nm) return nm;
        }
      }
      if (role === 'manager' || role === 'admin') {
        const me = await userRepo.getUserById(req.user?.id, req.tenantId || null).catch(() => null);
        return displayName(me);
      }
      return '';
    })();

    const rows = await repo.listByUserBetween(userId, from, to);
    const dailyRows = await repo.listDailyBetween(userId, from, to).catch(() => []);
    const planRows = await repo.listPlanBetween(userId, from, to).catch(() => []);
    const shiftDefs = await repo.listShiftDefinitions().catch(() => []);
    const shiftById = new Map((shiftDefs || []).map(s => [String(s.id), s]));
    const off = await getUserOffDaySet(y, userId, req.tenantId || 0);

    const dailyMap = new Map();
    for (const r of dailyRows || []) {
      const d = String(r?.date || '').slice(0, 10);
      if (!d) continue;
      dailyMap.set(d, {
        kubun: r.kubun || null,
        workType: r.work_type || null,
        location: r.location || null,
        reason: r.reason || null,
        memo: r.memo || null,
        notes: r.notes || null,
        lateMinutes: r.late_minutes == null ? null : Number(r.late_minutes),
        earlyMinutes: r.early_minutes == null ? null : Number(r.early_minutes),
        breakMinutes: r.break_minutes == null ? null : Number(r.break_minutes),
        nightBreakMinutes: r.night_break_minutes == null ? null : Number(r.night_break_minutes)
      });
    }

    const segMap = new Map();
    for (const r of (rows || [])) {
      const d = String(r.checkIn || '').slice(0, 10) || String(r.checkOut || '').slice(0, 10);
      if (!d) continue;
      if (!segMap.has(d)) segMap.set(d, []);
      segMap.get(d).push({
        id: r.id,
        checkIn: r.checkIn || null,
        checkOut: r.checkOut || null,
        shiftId: r.shiftId || null,
        workType: r.work_type || r.workType || null,
        labels: r.labels || null,
        location: r.location || null,
        memo: r.memo || null,
        notes: r.notes || null
      });
    }

    const dowJa = (dateStr) => {
      try {
        const [yy, mm, dd] = String(dateStr).slice(0, 10).split('-').map(x => parseInt(x, 10));
        const dt = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0));
        return ['日', '月', '火', '水', '木', '金', '土'][dt.getUTCDay()];
      } catch {
        return '';
      }
    };
    const hm = (dtStr) => {
      const s = String(dtStr || '');
      if (!s) return '';
      if (s.includes('T')) return s.slice(11, 16);
      return s.slice(11, 16);
    };
    const fmtHm = (mins) => {
      const m0 = Math.max(0, Number(mins || 0));
      const h = Math.floor(m0 / 60);
      const mm = Math.floor(m0 % 60);
      return `${h}:${String(mm).padStart(2, '0')}`;
    };
    const ceilToStep = (minValue, step) => {
      const v = Number(minValue || 0);
      if (!Number.isFinite(v)) return 0;
      return Math.ceil(v / step) * step;
    };
    const floorToStep = (minValue, step) => {
      const v = Number(minValue || 0);
      if (!Number.isFinite(v)) return 0;
      return Math.floor(v / step) * step;
    };
    // Chuyển phút sang giờ thập phân, làm tròn LÊN tới bước 0.5 giờ
    const minutesToHalfHourCeilDisplay = (mins) => {
      const m = Math.max(0, Number(mins || 0));
      const hours = m / 60;
      const rounded = Math.ceil(hours * 2) / 2; // ceil to 0.5
      return rounded.toFixed(1);
    };
    const hmToMinutes = (s) => {
      const t = String(s || '').trim();
      const m = t.match(/^(\d+):(\d{2})$/);
      if (!m) return 0;
      return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
    };
    const minutesBetween = (aStr, bStr) => {
      const a = String(aStr || '');
      const b = String(bStr || '');
      if (!a || !b) return 0;
      const aD = a.slice(0, 10);
      const bD = b.slice(0, 10);
      const aT = a.slice(11, 16);
      const bT = b.slice(11, 16);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(aD) || !/^\d{4}-\d{2}-\d{2}$/.test(bD)) return 0;
      if (!/^\d{2}:\d{2}$/.test(aT) || !/^\d{2}:\d{2}$/.test(bT)) return 0;
      const [ay, am, ad] = aD.split('-').map(n => parseInt(n, 10));
      const [by, bm, bd] = bD.split('-').map(n => parseInt(n, 10));
      const [ah, amn] = aT.split(':').map(n => parseInt(n, 10));
      const [bh, bmn] = bT.split(':').map(n => parseInt(n, 10));
      const aUtc = Date.UTC(ay, (am || 1) - 1, ad || 1, (ah || 0) - 9, amn || 0, 0);
      const bUtc = Date.UTC(by, (bm || 1) - 1, bd || 1, (bh || 0) - 9, bmn || 0, 0);
      return Math.max(0, Math.round((bUtc - aUtc) / 60000));
    };
    const brLabel = (min) => {
      if (min === '') return '';
      if (min === 0) return '0:00';
      return fmtHm(min);
    };
    const nbLabel = (min) => {
      if (min === '') return '';
      if (min === 0) return '0:00';
      return fmtHm(min);
    };
    const reasonLabel = (r) => {
      const s = String(r || '').trim();
      if (s === 'private') return '私用';
      if (s === 'late') return '遅刻';
      if (s === 'early') return '早退';
      if (s === 'other') return 'その他';
      return s;
    };

    const workDetailsRows = await repo.listWorkDetailsBetween(userId, from, to).catch(() => []);
    const workDetails = (workDetailsRows || []).map(r => ({
      startDate: String(r.start_date || '').slice(0, 10) || null,
      endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
      companyName: r.company_name || null,
      workContent: r.work_content || null
    }));
    const resolveWorkDetail = (ds) => {
      let best = null;
      for (const w of workDetails) {
        const sd = String(w?.startDate || '').slice(0, 10);
        if (!sd || sd > ds) continue;
        const ed = w?.endDate ? String(w.endDate).slice(0, 10) : '';
        if (ed && ed < ds) continue;
        best = w;
      }
      return best;
    };

    const assigns = await repo.listShiftAssignmentsBetween(userId, from, to).catch(() => []);
    const shiftByName = new Map((shiftDefs || []).map(s => [String(s.name), s]));
    const shiftForDate = (ds) => {
      let best = null;
      for (const a of assigns || []) {
        const sd = String(a?.start_date || '').slice(0, 10);
        if (!sd || sd > ds) continue;
        const ed = a?.end_date ? String(a.end_date).slice(0, 10) : '';
        if (ed && ed < ds) continue;
        best = a;
      }
      if (!best) return null;
      let def = null;
      const sid = best?.shiftId != null ? String(best.shiftId) : '';
      if (sid) def = shiftById.get(sid) || null;
      if (!def) {
        const nm = best?.shift != null ? String(best.shift) : '';
        if (nm) def = shiftByName.get(nm) || null;
      }
      if (!def) return null;
      const st = String(def.start_time || '').trim();
      const et = String(def.end_time || '').trim();
      if (!/^\d{2}:\d{2}$/.test(st) || !/^\d{2}:\d{2}$/.test(et)) return null;
      const [sh, sm] = st.split(':').map(n => parseInt(n, 10));
      const [eh, em] = et.split(':').map(n => parseInt(n, 10));
      return { 
        id: def.id,
        start_time: def.start_time,
        end_time: def.end_time,
        break_minutes: def.break_minutes,
        startMin: (sh || 0) * 60 + (sm || 0), 
        endMin: (eh || 0) * 60 + (em || 0) 
      };
    };

    const columns = [
      { header: '社員番号', width: 14 },
      { header: '氏名', width: 18 },
      { header: '日付', width: 12 },
      { header: '曜日', width: 6 },
      { header: '勤務区分', width: 10 },
      { header: '現場（任意）', width: 28 },
      { header: '出社', width: 6 },
      { header: '在宅', width: 6 },
      { header: '現場', width: 14 },
      { header: '開始時刻', width: 10 },
      { header: '終了時刻', width: 10 },
      { header: '開始(丸め)', width: 10 },
      { header: '終了(丸め)', width: 10 },
      { header: '休憩時間', width: 10 },
      { header: '深夜休憩', width: 10 },
      { header: '勤務時間', width: 10 },
      { header: '勤務時間(丸め)', width: 12 },
      { header: '超過時間', width: 10 },
      { header: '遅刻/早退', width: 10 },
      { header: '理由', width: 12 },
      { header: '社内業務', width: 14 },
      { header: '備考', width: 26 },
      { header: '承認ステータス', width: 12 },
      { header: '承認者', width: 12 }
    ];

    const sheetRows = [];
    // 当月サマリの総労働時間/総残業時間/法定外時間 = 各行の「勤務」「超過」の合計（画面と同じ）
    let rowsWorkedMin = 0;
    let rowsOtMin = 0;
    const planSheetRows = [];
    const planColumns = [
      { header: '日付', width: 12 },
      { header: '勤務区分', width: 10 },
      { header: '変換勤務区分', width: 14 },
      { header: '現場（任意）', width: 20 },
      { header: '開始時刻', width: 10 },
      { header: '終了時刻', width: 10 },
      { header: '休憩時間', width: 10 },
      { header: '深夜休憩', width: 10 },
      { header: '勤務時間', width: 10 },
      { header: '勤務形態', width: 14 }
    ];

    for (let day = 1; day <= lastDay; day++) {
      const ds = `${y}-${pad(m)}-${pad(day)}`;
      const dow = dowJa(ds);
      
      // Xác định isOff theo đúng cách frontend làm (dựa vào rule lịch)
      const isOff = off.has(ds);
      
      // Sheet 1: 入力用勤怠表
      const segs0 = (segMap.get(ds) || []).slice().sort((a, b) => String(a?.checkIn || '').localeCompare(String(b?.checkIn || '')));
      const segs = segs0.filter(s => {
        try {
          const sid = s?.shiftId != null ? String(s.shiftId) : '';
          const def = sid ? (shiftById.get(sid) || null) : null;
          const wt = String(s?.workType || '').trim();
          const labels = String(s?.labels || '').trim();
          const inHm = hm(s?.checkIn);
          const outHm = hm(s?.checkOut);
          if (def && !wt && !labels && inHm === String(def.start_time || '').trim() && outHm === String(def.end_time || '').trim()) {
            return false;
          }
        } catch (e) { /* bỏ qua lỗi lọc */ }
        return true;
      });
      const seg = segs[0] || null;
      const daily = dailyMap.get(ds) || null;
      const wd = resolveWorkDetail(ds);
      
      const isPartTime = String(user?.employment_type || '').toLowerCase() === 'part_time';
      const shiftDef = shiftForDate(ds);
      const shiftStart = shiftDef ? shiftDef.start_time : '09:00';
      const shiftEnd = shiftDef ? shiftDef.end_time : '18:00';
      
      let defaultBr = 60;
      if (shiftDef && shiftDef.break_minutes != null) {
        defaultBr = Number(shiftDef.break_minutes);
      } else if (isPartTime) {
        const sM = hmToMinutes(shiftStart);
        const eM = hmToMinutes(shiftEnd);
        if (sM && eM && (eM - sM <= 5 * 60)) {
          defaultBr = 0;
        }
      }

      let inHm = hm(seg?.checkIn);
      let outHm = hm(seg?.checkOut);
      const hasTime = !!inHm || !!outHm;
      const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
      const dailyKubun = String(daily?.kubun || '').trim();
      const plannedLabel = isOff ? '【予定休日】' : '【予定出勤】';
      const kubunInfo = (() => {
        if (isOff) {
          if (dailyKubun === '出勤') return { display: '出勤', effective: '出勤' };
          if (dailyKubun === '休日' || dailyKubun === '休日出勤' || dailyKubun === '代替出勤') {
            return { display: dailyKubun, effective: dailyKubun };
          }
          if (hasTime) return { display: '休日出勤', effective: '休日出勤' };
          return { display: plannedLabel, effective: '休日' };
        }
        const allowed = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休日']);
        if (allowed.has(dailyKubun) && dailyKubun) return { display: dailyKubun, effective: dailyKubun };
        return { display: plannedLabel, effective: '出勤' };
      })();
      const kubun = kubunInfo.display;
      const isWorkKubun = workKubunSet.has(kubunInfo.effective);
      
      // Chỉ xuất dữ liệu THỰC, không xuất dữ liệu placeholder mờ trên UI.
      const shouldShowDefaultShift = !isOff && (kubun === '' || kubun === '出勤' || kubun === '【予定出勤】' || kubun === '休日出勤' || kubun === '代替出勤');
      
      let wt = isWorkKubun ? String(seg?.workType || daily?.workType || '').trim() : '';
      if (isWorkKubun && !wt && hasTime) wt = 'onsite';
      const wtOn = (wt === 'onsite' && hasTime) ? { v: '✓', s: 'checkOn' } : '';
      const wtRe = (wt === 'remote' && hasTime) ? { v: '✓', s: 'checkOn' } : '';
      const wtSa = (wt === 'satellite' && hasTime) ? { v: '✓', s: 'checkOn' } : '';
      
      const holidayLock = !isWorkKubun;
      // 休日に出勤した日 (部署の休日設定で休みの日 or 休日出勤): 定時が無いので遅刻・早退は付けず、
      // 6時間以下の勤務なら休憩の既定値は 0 (労基法: 6時間以下は休憩不要)。画面と同じルール。
      const isHolidayWork = !isPartTime && isWorkKubun && (isOff || kubunInfo.effective === '休日出勤');

      let exportInHm = '';
      let exportOutHm = '';
      let exportBrMin = '';
      let exportNbMin = '';
      let exportWorkedMin = '';
      let exportOtMin = '';

      if (hasTime) {
        exportInHm = inHm;
        exportOutHm = outHm;
        const isHankyuu = kubunInfo.effective === '半休' || kubunInfo.effective === '半休(有給)';
        const spanMin = (inHm && outHm) ? hmToMinutes(outHm) - hmToMinutes(inHm) : null;
        const autoBr = (isHolidayWork && spanMin != null && spanMin > 0 && spanMin <= 6 * 60) ? 0 : defaultBr;
        exportBrMin = (holidayLock || isHankyuu) ? 0 : (daily?.breakMinutes == null ? autoBr : Number(daily.breakMinutes));
        exportNbMin = (holidayLock || isHankyuu) ? 0 : (daily?.nightBreakMinutes == null ? 0 : Number(daily.nightBreakMinutes));
        // 画面 (実績) ・サーバー (給与) と同じ: 始業前の出勤 (早出) も実働に含める
        exportWorkedMin = holidayLock ? 0 : Math.max(0, hmToMinutes(outHm) - hmToMinutes(inHm) - exportBrMin - exportNbMin);
        // 超過時間 = checkout - shift_end (giờ sau khi kết thúc ca)
        const shiftEndMin = shiftDef ? shiftDef.endMin : (17 * 60);
        const outMin = hmToMinutes(outHm);
        exportOtMin = holidayLock ? 0 : Math.max(0, outMin - shiftEndMin);
        if (inHm && outHm) {
          rowsWorkedMin += exportWorkedMin;
          if (exportWorkedMin > 0) rowsOtMin += exportOtMin;
        }
      }

      // 丸め (giá trị đã làm tròn)
      let roundedIn = '';
      let roundedOut = '';
      let roundedWorkedMin = '';
      if (hasTime && exportInHm && exportOutHm) {
        const rStep = 30;
        const shiftStartMin = shiftDef ? shiftDef.startMin : (8 * 60);
        const shiftEndMin2 = shiftDef ? shiftDef.endMin : (17 * 60);
        const inMin = hmToMinutes(exportInHm);
        const outMinR = hmToMinutes(exportOutHm);
        // Giờ vào: luôn làm tròn LÊN theo bước rStep (không ép về giờ bắt đầu ca)
        let rInMin = ceilToStep(inMin, rStep);
        // Giờ ra: nếu sau ca thì phần OT làm tròn XUỐNG theo bước rStep
        let rOutMin = outMinR;
        if (outMinR > shiftEndMin2) {
          const otRaw = outMinR - shiftEndMin2;
          const otRounded = floorToStep(otRaw, rStep);
          rOutMin = shiftEndMin2 + otRounded;
        } else {
          // Nếu rơi trong ca (<= shift end) thì làm tròn XUỐNG về bước 30 gần nhất
          rOutMin = floorToStep(outMinR, rStep);
          // Tuy nhiên không được nhỏ hơn shift start
          if (rOutMin < shiftStartMin) rOutMin = shiftStartMin;
        }
        roundedIn = fmtHm(rInMin);
        roundedOut = fmtHm(rOutMin);
        const brVal = exportBrMin || 0;
        roundedWorkedMin = holidayLock ? 0 : Math.max(0, rOutMin - rInMin - brVal);
      }
      const lateEarly = (() => {
        if (holidayLock) return '';
        // 半休/半休(有給): nghỉ nửa ngày là hợp lệ nên không tính đi muộn/về sớm
        if (kubunInfo.effective === '半休' || kubunInfo.effective === '半休(有給)') return '';
        if (!exportInHm && !exportOutHm) return '';
        const parse = (t) => {
          const s = String(t || '');
          if (!/^\d{2}:\d{2}$/.test(s)) return null;
          const [h, mi] = s.split(':').map(n => parseInt(n, 10));
          return (h || 0) * 60 + (mi || 0);
        };
        const a = parse(exportInHm);
        const b = parse(exportOutHm);
        if (a == null && b == null) return '';
        const se = shiftForDate(ds);
        const startBase = se?.startMin ?? (8 * 60);
        const endBase = se?.endMin ?? (17 * 60);
        return lateEarlyLabel(a, b, startBase, endBase, isHolidayWork);
      })();

      const workLocation = (() => {
        const segLoc = seg ? String(seg?.location || '').trim() : '';
        const dLoc = String(daily?.location || '').trim();
        return segLoc || dLoc || '';
      })();
      
      const workContent = (() => {
        const segMemo = seg ? String(seg?.memo || '').trim() : '';
        const dMemo = String(daily?.memo || '').trim();
        return segMemo || dMemo || '';
      })();
      
      const notesText = (() => {
        const segNotes = seg ? String(seg?.notes || '').trim() : '';
        const dNotes = String(daily?.notes || '').trim();
        return segNotes || dNotes || '';
      })();

      const inhouseWork = String(wd?.workContent || '').trim();
      const goOuts = await repo.getGoOutRecords(userId, ds).catch(() => []);
      
      let goOutDetail = '';
      if (Array.isArray(goOuts) && goOuts.length > 0) {
        const parts = goOuts.map(g => {
          const t1 = hm(g.go_out_time);
          const t2 = hm(g.return_time) || '未戻';
          const r = g.reason || '';
          return `${t1}-${t2}(${r})`;
        });
        goOutDetail = parts.join(', ');
      }
      
      // 承認ステータス: cùng quy tắc với cột ステータス trên màn hình (attendance-monthly.render.js)
      const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const leaveKubunSet = new Set(['休日', '代替休日', '有給休暇', '無給休暇', '欠勤']);
      const isRegularOffRow = isOff && !hasTime && (dailyKubun === '休日' || dailyKubun === '代替休日');
      const isLeaveApplied = !!dailyKubun && leaveKubunSet.has(dailyKubun) && !hasTime && !isRegularOffRow;
      const isConfirmedRow = !!inHm && !!outHm && !!workContent;
      const isAutoConfirmedNoWork = !hasTime && ds <= todayJst && (dailyKubun === '' || dailyKubun === '休日') && isOff;
      const approveStatus = (() => {
        if (monthStatus === 'approved') return '承認済み';
        if (isConfirmedRow || isAutoConfirmedNoWork) return '確認済み';
        if (!dailyKubun && !hasTime) return '未申請';
        if (isLeaveApplied || hasTime) return '承認待ち';
        return '';
      })();
      // 承認者: chỉ ghi tên ở ngày đã 確認済み/承認済み VÀ có dữ liệu (có giờ, hoặc đã chọn 区分 như 有給).
      // Ngày chưa đi làm / chưa có dữ liệu thì để trống.
      const rowHasData = hasTime || (!!dailyKubun && !isRegularOffRow && dailyKubun !== '休日');
      const approverForRow = (approveStatus === '確認済み' || approveStatus === '承認済み') && rowHasData ? approverDisplayName : '';
      sheetRows.push({
        isOff,
        cells: [
          employeeCode || '',
          employeeName || '',
          ds,
          dow,
          kubun,
          workLocation,
          wtOn,
          wtRe,
          wtSa,
          exportInHm,
          exportOutHm,
          roundedIn,
          roundedOut,
          brLabel(exportBrMin),
          nbLabel(exportNbMin),
          exportWorkedMin !== '' ? fmtHm(exportWorkedMin) : '',
          roundedWorkedMin !== '' ? minutesToHalfHourCeilDisplay(roundedWorkedMin) : '',
          exportOtMin !== '' ? fmtHm(exportOtMin) : '',
          lateEarly,
          reasonLabel(daily?.reason || ''),
          workContent,
          notesText,
          approveStatus,
          inhouseWork,
          goOutDetail,
          approverForRow // [25] 承認者
        ]
      });

      // Export thêm rows cho segments 2+ trong cùng ngày
      for (let si = 1; si < segs.length; si++) {
        const extraSeg = segs[si];
        const extraIn = hm(extraSeg?.checkIn);
        const extraOut = hm(extraSeg?.checkOut);
        if (!extraIn && !extraOut) continue;
        const extraWt = String(extraSeg?.workType || '').trim();
        const extraWtOn = extraWt === 'onsite' ? { v: '✓', s: 'checkOn' } : '';
        const extraWtRe = extraWt === 'remote' ? { v: '✓', s: 'checkOn' } : '';
        const extraWtSa = extraWt === 'satellite' ? { v: '✓', s: 'checkOn' } : '';
        const extraLoc = String(extraSeg?.location || '').trim();
        const extraMemo = String(extraSeg?.memo || '').trim();
        const extraNotes = String(extraSeg?.notes || '').trim();
        const extraBr = holidayLock ? 0 : defaultBr;
        const extraWorked = holidayLock ? 0 : Math.max(0, hmToMinutes(extraOut) - hmToMinutes(extraIn) - extraBr);
        const extraShiftEndMin = shiftDef ? shiftDef.endMin : (17 * 60);
        const extraOt = holidayLock ? 0 : Math.max(0, hmToMinutes(extraOut) - extraShiftEndMin);
        if (extraIn && extraOut) {
          rowsWorkedMin += extraWorked;
          if (extraWorked > 0) rowsOtMin += extraOt;
        }
        sheetRows.push({
          isOff,
          cells: [
            '', '', ds, dow, '',
            extraLoc,
            extraWtOn, extraWtRe, extraWtSa,
            extraIn,
            extraOut,
            '', '',
            brLabel(extraBr),
            '0:00',
            fmtHm(extraWorked),
            '',
            fmtHm(extraOt),
            '', '',
            extraMemo,
            extraNotes,
            '', '', ''
          ]
        });
      }

      // Sheet 2: 予定
      const plan = planRows.find(p => String(p.date).slice(0, 10) === ds) || null;
      const planShiftDef = plan?.shiftId ? shiftById.get(String(plan.shiftId)) : shiftDef;
      const planKubun = isOff ? '休日' : '出勤';
      const planStartTime = plan?.startTime || planShiftDef?.start_time || '';
      const planEndTime = plan?.endTime || planShiftDef?.end_time || '';
      
      let planBreak = 60;
      if (plan?.breakMinutes != null) {
        planBreak = plan.breakMinutes;
      } else if (planShiftDef && planShiftDef.break_minutes != null) {
        planBreak = Number(planShiftDef.break_minutes);
      } else if (isPartTime) {
        const sM = hmToMinutes(planStartTime);
        const eM = hmToMinutes(planEndTime);
        if (sM && eM && (eM - sM <= 5 * 60)) {
          planBreak = 0;
        }
      }
      
      const planWorkType = plan?.work_type || (isOff ? '' : '契約なし');
      
      planSheetRows.push({
        isOff,
        cells: [
          `${m}月${day}日(${dow})`,
          planKubun,
          planKubun,
          plan?.location || '',
          planStartTime ? planStartTime.split(':')[0] : '',
          planStartTime ? planStartTime.split(':')[1] : '',
          planEndTime ? planEndTime.split(':')[0] : '',
          planEndTime ? planEndTime.split(':')[1] : '',
          Math.floor(planBreak / 60),
          planBreak % 60,
          0, 0, // 深夜休憩
          { f: `MAX(0, (G${day+1}*60+H${day+1})-(E${day+1}*60+F${day+1})-(I${day+1}*60+J${day+1}))` }, // Công thức tính phút
          planWorkType
        ]
      });
    }

    const safeFile = (s) => String(s || '').replace(/[\\\/:*?"<>|]/g, '_');
    const fileNameRaw = safeFile(`${employeeName}_${employeeCode}_${y}年${String(m).padStart(2,'0')}月.xlsx`);
    const fileNameAscii = `attendance_${employeeCode || userId}_${y}-${String(m).padStart(2,'0')}.xlsx`;
    const fileNameEncoded = encodeURIComponent(fileNameRaw);
    const { buildXlsxArchive } = require('../../utils/xlsx');
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const colRef = (n) => {
      let x = Number(n || 1);
      let out = '';
      while (x > 0) {
        const r = (x - 1) % 26;
        out = String.fromCharCode(65 + r) + out;
        x = Math.floor((x - 1) / 26);
      }
      return out || 'A';
    };
    const cell = (ref, value, style = 0) => {
      const v = String(value == null ? '' : value);
      if (!v) return `<c r="${ref}" s="${style}"/>`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const numberCell = (ref, value, style = 0) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return `<c r="${ref}" s="${style}"/>`;
      return `<c r="${ref}" s="${style}"><v>${String(n)}</v></c>`;
    };
    const formulaCell = (ref, formula, value = '', style = 0) => {
      const v = String(value == null ? '' : value);
      return `<c r="${ref}" t="str" s="${style}"><f>${esc(formula)}</f><v>${esc(v)}</v></c>`;
    };
    const splitHmDisplay = (s, showColonOnly = true) => {
      const t = String(s || '').trim();
      const m = t.match(/^(\d+):(\d{2})$/);
      if (m) return [m[1], ':', m[2]];
      return ['', showColonOnly ? ':' : '', ''];
    };
    // ── Style registry: cellXfs được sinh theo nhu cầu nên chỉ số style luôn tồn tại (trước đây
    //    ghi tay danh sách xf và từng tham chiếu s="26" không có → Excel báo lỗi khi mở file).
    const F = { normal: 0, bold: 1, white: 2, red: 3, title: 4, note: 5, blue: 6, section: 7, muted: 8, tick: 9, redBold: 10, smallBold: 11, green: 12, amber: 13 };
    const xlsxFonts = [
      '<font><sz val="10"/><color rgb="FF1F2937"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="10"/><color rgb="FF1F2937"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Meiryo"/></font>',
      '<font><sz val="10"/><color rgb="FFDC2626"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="16"/><color rgb="FF0B2C66"/><name val="Meiryo"/></font>',
      '<font><sz val="9"/><color rgb="FF64748B"/><name val="Meiryo"/></font>',
      '<font><sz val="10"/><color rgb="FF2563EB"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="11"/><color rgb="FF0B2C66"/><name val="Meiryo"/></font>',
      '<font><sz val="10"/><color rgb="FF94A3B8"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="11"/><color rgb="FF2563EB"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="10"/><color rgb="FFDC2626"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="9"/><color rgb="FF1F2937"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="10"/><color rgb="FF15803D"/><name val="Meiryo"/></font>',
      '<font><b/><sz val="10"/><color rgb="FFB45309"/><name val="Meiryo"/></font>'
    ];
    const xlsxFills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const fillIdx = new Map();
    const fillOf = (rgb) => {
      if (!rgb) return 0;
      if (!fillIdx.has(rgb)) {
        fillIdx.set(rgb, xlsxFills.length);
        xlsxFills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`);
      }
      return fillIdx.get(rgb);
    };
    // border 0 = không viền, 1 = viền mảnh xám
    const xlsxBorders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      '<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>'
    ];
    const xfList = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const xfIdx = new Map();
    const st = ({ font = F.normal, fill = '', border = 0, h = '', wrap = false } = {}) => {
      const key = [font, fill, border, h, wrap].join('|');
      if (xfIdx.has(key)) return xfIdx.get(key);
      const align = `<alignment${h ? ` horizontal="${h}"` : ''} vertical="center"${wrap ? ' wrapText="1"' : ''}/>`;
      xfList.push(`<xf numFmtId="0" fontId="${font}" fillId="${fillOf(fill)}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
      xfIdx.set(key, xfList.length - 1);
      return xfList.length - 1;
    };
    const NAVY = 'FF0B2C66';
    const sHeader = st({ font: F.white, fill: NAVY, border: 1, h: 'center', wrap: true });

    const rowXml = (r, cells, ht = null) => `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`;
    const sheet1Rows = [];
    const push1 = (r, list, ht = null) => { sheet1Rows.push(rowXml(r, list, ht)); };
    const monthLabel = `${y}年${m}月`;
    push1(1, [cell('A1', `月次勤怠表（入力用）　${monthLabel}`, st({ font: F.title }))], 30);
    push1(2, [cell('A2', '編集可能セルのみ入力してください（行/列の追加・削除・移動は不可）。', st({ font: F.note }))], 16);
    push1(3, [cell('A3', '承認済み・承認依頼中の行は取り込み対象外です。', st({ font: F.note }))], 16);
    push1(4, [cell('A4', `社員番号：${employeeCode || '—'}　　氏名：${employeeName || '—'}　　対象月：${monthLabel}${monthStatus === 'approved' ? '　　承認済み' : ''}`, st({ font: F.bold }))], 24);
    push1(5, [cell('A5', '日次実績', st({ font: F.section }))], 22);
    // Thứ tự cột khớp với màn hình web: ...現場 | 現場(任意) | 作業内容 | 開始時刻...
    const sheet1Headers = ['日付', '勤務区分', '出社', '在宅', '現場', '現場（任意）', '作業内容', '開始時刻', '終了時刻',
      '休憩時間', '深夜休憩', '勤務時間', '超過時間', '遅刻/早退', '理由', '備考', '承認ステータス', '承認者'];
    push1(6, sheet1Headers.map((h, i) => cell(`${colRef(i + 1)}6`, h, sHeader)), 26);
    for (let i = 0; i < sheetRows.length; i++) {
      const r = sheetRows[i];
      const src = Array.isArray(r?.cells) ? r.cells : [];
      const rowDow = String(src[3] || '').trim();
      // Màu nền cả dòng theo kubun (nhạt, đồng nhất mọi cột); ngày làm bình thường để trắng
      const rowKubun = String(src[4] || '').trim();
      const rowHasTime = !!(src[9] || src[10]); // có 開始 hoặc 終了
      const rowIsOff = r?.isOff;
      const rowFill = (() => {
        if (rowKubun === '有給休暇') return 'FFFEF9C3'; // vàng nhạt
        if (rowKubun === '欠勤') return 'FFFEE2E2'; // đỏ nhạt
        if (rowKubun === '半休' || rowKubun === '半休(有給)') return 'FFDCFCE7'; // xanh lá nhạt
        if (rowKubun === '休日' || rowKubun === '【予定休日】' || rowIsOff) return 'FFF1F5F9'; // xám nhạt (ngày nghỉ)
        return '';
      })();
      // Ngày: CN / ngày nghỉ lễ = đỏ, Thứ 7 = xanh (giống màn hình)
      const dateFont = (rowDow === '日' || (rowIsOff && rowDow !== '土')) ? F.red : (rowDow === '土' ? F.blue : F.normal);
      const dayText = (() => {
        const ds = String(src[2] || '');
        const dow = String(src[3] || '');
        const d = /^\d{4}-(\d{2})-(\d{2})$/.exec(ds);
        return d ? `${parseInt(d[1], 10)}月${parseInt(d[2], 10)}日(${dow})` : ds;
      })();
      // Thứ tự khớp màn hình web (18 cột A→R):
      // [0]日付 [1]勤務区分 [2]出社 [3]在宅 [4]現場 [5]現場(任意) [6]作業内容
      // [7]開始時刻 [8]終了時刻 [9]休憩時間 [10]深夜休憩 [11]勤務時間
      // [12]超過時間 [13]遅刻/早退 [14]理由 [15]備考 [16]承認ステータス [17]承認者
      const vals = [
        dayText,
        src[4] || '',
        (src[6] && typeof src[6] === 'object' ? src[6].v : '') || '', // 出社 ✓
        (src[7] && typeof src[7] === 'object' ? src[7].v : '') || '', // 在宅 ✓
        (src[8] && typeof src[8] === 'object' ? src[8].v : '') || '', // 現場 ✓
        src[5] || '',  // 現場(任意): tên hiện trường (workLocation)
        src[20] || '', // 作業内容: nội dung công việc (workContent)
        src[9] || '',  // 開始時刻
        src[10] || '', // 終了時刻
        src[13] || '0:00', // 休憩時間
        src[14] || '0:00', // 深夜休憩
        src[15] || '0:00', // 勤務時間
        src[17] || '0:00', // 超過時間
        src[18] || '', // 遅刻/早退
        src[19] || '', // 理由
        src[21] || '', // 備考: ghi chú (notes), KHÔNG phải nội dung công việc
        src[22] || '', // 承認ステータス (cùng quy tắc với màn hình)
        src[25] || ''  // 承認者: chỉ ngày đã xác nhận và có dữ liệu
      ];
      const rowNum = 7 + i;
      // Index cột (0-based): 出社/在宅/現場 tick = 2,3,4; ô text 現場(任意)/作業内容 = 5,6;
      // các cột giờ (開始..超過) = 7..12; cột wrapText = 5,6,15.
      const TICK_CI = [2, 3, 4];
      const WRAP_CI = [5, 6, 15]; // 現場(任意)/作業内容/備考: căn trái, xuống dòng
      const TIME_DEFAULT_CI = [9, 10, 11, 12]; // 休憩/深夜/勤務/超過 → '0:00' khi có giờ, để trống khi ngày không có giờ
      const xmlCells = vals.map((v, ci) => {
        const ref = `${colRef(ci + 1)}${rowNum}`;
        let cellValue = String(v || '');
        // 勤務区分: nếu là 休日出勤 nhưng không có tick nào và không có giờ → hiển thị 休日 (giữ hành vi cũ)
        if (ci === 1 && cellValue === '休日出勤' && !vals[2] && !vals[3] && !vals[4] && !vals[7] && !vals[8]) {
          const ds = String(src[2] || '');
          const daily = ds ? dailyMap.get(ds) : null;
          if (daily?.kubun !== '休日出勤') cellValue = '休日';
        }
        if (TIME_DEFAULT_CI.includes(ci)) cellValue = rowHasTime ? (cellValue || '0:00') : '';

        let font = F.normal;
        if (ci === 0) font = dateFont;
        else if (ci === 1 && cellValue.includes('予定')) font = F.muted; // dự kiến → chữ xám
        else if (TICK_CI.includes(ci) && cellValue === '✓') font = F.tick;
        else if (ci === 13 && cellValue) font = F.redBold; // 遅刻/早退
        else if (ci === 16 && cellValue) font = (cellValue === '確認済み' || cellValue === '承認済み') ? F.green : F.amber;
        const wrap = WRAP_CI.includes(ci);
        return cell(ref, cellValue, st({ font, fill: rowFill, border: 1, h: wrap ? 'left' : 'center', wrap }));
      });
      // Cột ẩn số phút (dùng cho import sau này) đặt ở S (cột 19), sau 18 cột hiển thị.
      xmlCells.push(numberCell(`S${rowNum}`, hmToMinutes(src[13] || '0:00'), 0));
      push1(rowNum, xmlCells);
    }

    // 当月サマリ (tổng hợp tháng)
    const summaryStartRow = 7 + sheetRows.length + 2; // cách 2 dòng
    const totalWorkingDays = lastDay - [...off].filter(d => d >= from && d <= to).length;
    let sumAttendDays = 0;
    let sumHolidayWorkDays = 0;
    let sumTotalWorkedMin = 0;
    let sumOvertimeMin = 0;
    let sumPaidDays = 0;
    let sumHalfPaidDays = 0;
    let sumSubstituteDays = 0;
    let sumUnpaidDays = 0;
    let sumAbsentDays = 0;
    let sumOnsiteDays = 0;
    let sumRemoteDays = 0;
    let sumSatelliteDays = 0;
    let sumStandbyDays = 0;
    let sumHalfUnpaidDays = 0;
    let sumDaigaeWorkDays = 0;
    let sumFurikaeWorkDays = 0;
    let sumOffDays = 0;

    for (let day = 1; day <= lastDay; day++) {
      const ds = `${y}-${pad(m)}-${pad(day)}`;
      const isOffDay = off.has(ds);
      const daily = dailyMap.get(ds) || null;
      const segs0 = segMap.get(ds) || [];
      const hasActual = segs0.some(s => !!s?.checkIn || !!s?.checkOut);
      const kubun = String(daily?.kubun || '').trim();

      // 出勤日数 / 休日出勤日数: 画面・給与と共通のルール (attendance.dayCount.js)
      const dayCount = classifyDay({ kubun, hasActual, isOffDay, isPartTime: String(user?.employment_type || '').toLowerCase() === 'part_time' });
      sumAttendDays += dayCount.attend;
      sumHolidayWorkDays += dayCount.holidayWork;
      if (kubun === '半休') sumHalfUnpaidDays += 0.5;
      if (kubun === '代替出勤') sumDaigaeWorkDays++;
      if (kubun === '振替出勤') sumFurikaeWorkDays++;
      if (kubun === '休日' || (!kubun && isOffDay && !hasActual)) sumOffDays++;

      if (hasActual) {
        // Đếm theo hình thức làm việc
        const wt = String(segs0[0]?.workType || daily?.workType || '').trim();
        if (wt === 'onsite') sumOnsiteDays++;
        else if (wt === 'remote') sumRemoteDays++;
        else if (wt === 'satellite') sumSatelliteDays++;
        else if (hasActual && !isOffDay) sumOnsiteDays++; // mặc định là onsite nếu có chấm công
      }

      if (kubun === '有給休暇') sumPaidDays++;
      if (kubun === '半休(有給)') sumHalfPaidDays += 0.5;
      if (kubun === '代替休日') sumSubstituteDays++;
      if (kubun === '無給休暇') sumUnpaidDays++;
      if (kubun === '欠勤') sumAbsentDays++;

      // Tính giờ làm và overtime cho ngày có actual
      if (hasActual) {
        for (const s of segs0) {
          const sIn = hm(s?.checkIn);
          const sOut = hm(s?.checkOut);
          if (!sIn || !sOut) continue;
          const raw = hmToMinutes(sOut) - hmToMinutes(sIn);
          if (raw > 0) sumTotalWorkedMin += raw;
        }
        // Giờ làm thêm
        const seg = segs0[0];
        const outHmS = hm(seg?.checkOut);
        if (outHmS) {
          const shiftDefS = shiftForDate(ds);
          const shiftEndMinS = shiftDefS ? shiftDefS.endMin : (17 * 60);
          const outMinS = hmToMinutes(outHmS);
          if (outMinS > shiftEndMinS) sumOvertimeMin += (outMinS - shiftEndMinS);
        }
      }
    }

    // Trừ break từ tổng giờ làm
    let sumBreakMin = 0;
    for (let day = 1; day <= lastDay; day++) {
      const ds = `${y}-${pad(m)}-${pad(day)}`;
      const daily = dailyMap.get(ds) || null;
      const segs0 = segMap.get(ds) || [];
      const hasActual = segs0.some(s => !!s?.checkIn || !!s?.checkOut);
      if (!hasActual) continue;
      const kubun = String(daily?.kubun || '').trim();
      const isHankyuuS = kubun === '半休' || kubun === '半休(有給)';
      if (isHankyuuS) continue;
      const shiftDefS = shiftForDate(ds);
      const defBr = (shiftDefS && shiftDefS.break_minutes != null) ? Number(shiftDefS.break_minutes) : 60;
      const br = daily?.breakMinutes != null ? Number(daily.breakMinutes) : defBr;
      const nb = daily?.nightBreakMinutes != null ? Number(daily.nightBreakMinutes) : 0;
      sumBreakMin += br + nb;
    }
    const sumNetWorkedMin = Math.max(0, sumTotalWorkedMin - sumBreakMin);

    const totalPaidLeave = sumPaidDays + sumHalfPaidDays;
    // Số ngày phép được cấp
    // 有給付与: 画面の当月サマリ・有給管理と同じ（労基法の法定付与＋登録付与のうち有効なものの合計）。
    // 以前は resolveEmploymentStartDate に userId を渡していたため常に「—」になっていた。
    let entitlementDays = '—';
    try {
      const { computeUserBalance } = require('../leave/leave.controller');
      const bal = await computeUserBalance(userId, req.tenantId || null);
      const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const total = (bal?.grants || []).reduce((s, g) => s + (String(g?.expiryDate || '').slice(0, 10) >= todayStr ? Number(g?.daysGranted || 0) : 0), 0);
      entitlementDays = String(total);
    } catch (e) { /* bỏ qua lỗi tính phép */ }

    // Ghi các dòng tổng hợp
    // 当月サマリ: lưới 8 cột đặt ở H〜O (các cột cùng độ rộng ~10) — trước đây đặt từ cột A nên
    // nhãn rơi vào cột 出社/在宅/現場 (rộng 5) và bị chồng chữ.
    const SUM_COL0 = 8; // H
    const sSumLabel = st({ font: F.smallBold, fill: 'FFEEF2F7', border: 1, h: 'center', wrap: true });
    const sSumValue = st({ font: F.normal, border: 1, h: 'center' });
    push1(summaryStartRow, [cell(colRef(SUM_COL0) + summaryStartRow, '当月サマリ', st({ font: F.section }))], 22);
    const summaryBlocks = [
      [['所定日数', `${totalWorkingDays}日`], ['出勤日数', `${sumAttendDays}日`], ['休日出勤日数', `${sumHolidayWorkDays}日`],
        ['待機日数', `${sumStandbyDays}日`], ['総労働時間', fmtHm(rowsWorkedMin)], ['深夜時間', '0:00'],
        ['総残業時間', fmtHm(rowsOtMin)], ['法定外時間', fmtHm(rowsOtMin)]],
      [['有休日数', `${totalPaidLeave}日`], ['有給付与', `${entitlementDays}日`], ['代休日数', `${sumSubstituteDays}日`],
        ['無給休暇', `${sumUnpaidDays}日`], ['欠勤日数', `${sumAbsentDays}日`], ['控除時間', '0:00'],
        ['出社日数', `${sumOnsiteDays}日`], ['在宅日数', `${sumRemoteDays}日`]],
      [['半休(有給)', `${sumHalfPaidDays.toFixed(1)}日`], ['半休', `${sumHalfUnpaidDays.toFixed(1)}日`],
        ['代替出勤', `${sumDaigaeWorkDays}日`], ['振替出勤', `${sumFurikaeWorkDays}日`], ['休日日数', `${sumOffDays}日`]]
    ];
    summaryBlocks.forEach((items, bi) => {
      const rl = summaryStartRow + 1 + bi * 2;
      push1(rl, items.map(([label], i) => cell(`${colRef(SUM_COL0 + i)}${rl}`, label, sSumLabel)), 30);
      push1(rl + 1, items.map(([, val], i) => cell(`${colRef(SUM_COL0 + i)}${rl + 1}`, val, sSumValue)), 22);
    });

    // Thứ tự khớp màn hình: 日付|勤務区分|出社|在宅|現場|現場(任意)|作業内容|開始|終了|休憩|深夜|勤務|超過|遅刻早退|理由|備考|承認ステータス|承認者
    const sheet1VisibleCols = [13, 12, 6, 6, 6, 24, 36, 10, 10, 10, 10, 10, 10, 10, 12, 28, 14, 12];
    const sheet1Cols = [
      ...sheet1VisibleCols.map((w, i) => {
        return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
      }),
      // Cột ẩn số phút dời từ 17 -> 19 (S)
      `<col min="19" max="19" width="2" hidden="1" customWidth="1"/>`
    ].join('');
    const sheet1Merges = [
      'A1:R1', 'A2:R2', 'A3:R3',
      'A4:R4',
      'A5:R5',
      `${colRef(SUM_COL0)}${summaryStartRow}:${colRef(SUM_COL0 + 7)}${summaryStartRow}`
    ].map(r => `<mergeCell ref="${r}"/>`).join('');
    const lastSheet1Row = 6 + Math.max(1, sheetRows.length);
    const sheet1Validations = [
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="C7:C${lastSheet1Row}"><formula1>",✓"</formula1></dataValidation>`,
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="D7:D${lastSheet1Row}"><formula1>",✓"</formula1></dataValidation>`,
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="E7:E${lastSheet1Row}"><formula1>",✓"</formula1></dataValidation>`
    ].join('');
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A7" sqref="A7"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${sheet1Cols}</cols>
  <sheetData>${sheet1Rows.join('')}</sheetData>
  <sheetProtection sheet="1" objects="1" scenarios="1" />
  <mergeCells count="${(sheet1Merges.match(/<mergeCell /g) || []).length}">${sheet1Merges}</mergeCells>
  <dataValidations count="3">${sheet1Validations}</dataValidations>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.3" right="0.3" top="0.4" bottom="0.5" header="0.2" footer="0.25"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <headerFooter><oddFooter>&amp;L${esc(`${employeeName || ''}　${monthLabel}`)}&amp;R&amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`;
    const sheet2Header = planColumns.map((c, i) => cell(`${colRef(i + 1)}1`, c.header, 3));
    const sheet2Rows = [rowXml(1, sheet2Header, 22)];
    for (let i = 0; i < planSheetRows.length; i++) {
      const vals = Array.isArray(planSheetRows[i]?.cells) ? planSheetRows[i].cells.map(v => (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'v') ? v.v : (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'f') ? String(v.v || '') : v))) : [];
      const rowNum = i + 2;
      const planStartH = Number(vals[4] || 0);
      const planStartM = Number(vals[5] || 0);
      const planEndH = Number(vals[6] || 0);
      const planEndM = Number(vals[7] || 0);
      const breakH = Number(vals[8] || 0);
      const breakM = Number(vals[9] || 0);
      const nightBreakH = Number(vals[10] || 0);
      const nightBreakM = Number(vals[11] || 0);
      const plannedMinutes = Math.max(0, ((planEndH * 60 + planEndM) - (planStartH * 60 + planStartM)) - (breakH * 60 + breakM) - (nightBreakH * 60 + nightBreakM));
      const planWorkStyle = String(vals[13] || '');
      const rowCells = vals.map((v, ci) => cell(`${colRef(ci + 1)}${rowNum}`, v == null ? '' : v, ci === 0 ? 10 : 11));
      rowCells.push(numberCell(`U${rowNum}`, plannedMinutes, 0));
      rowCells.push(cell(`V${rowNum}`, planWorkStyle, 0));
      sheet2Rows.push(rowXml(rowNum, rowCells));
    }
    const sheet2VisibleCols = [12, 10, 14, 20, 8, 8, 8, 8, 8, 8, 10, 12, 12, 12];
    const sheet2Cols = [
      ...sheet2VisibleCols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`),
      ...Array.from({ length: 6 }, (_, idx) => `<col min="${15 + idx}" max="${15 + idx}" width="2" hidden="1" customWidth="1"/>`),
      `<col min="21" max="21" width="2" hidden="1" customWidth="1"/>`,
      `<col min="22" max="22" width="2" hidden="1" customWidth="1"/>`
    ].join('');
    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${sheet2Cols}</cols>
  <sheetData>${sheet2Rows.join('')}</sheetData>
  <sheetProtection sheet="1" objects="1" scenarios="1" />
</worksheet>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${xlsxFonts.length}">${xlsxFonts.join("")}</fonts>
  <fills count="${xlsxFills.length}">${xlsxFills.join("")}</fills>
  <borders count="${xlsxBorders.length}">${xlsxBorders.join("")}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${xfList.length}">${xfList.join("")}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    // Sheet 3: 現場・作業内容
    const sheet3Rows = [];
    const push3 = (r, list, ht = null) => { sheet3Rows.push(rowXml(r, list, ht)); };
    push3(1, [cell('A1', '日付', 3), cell('B1', '現場（任意）', 3), cell('C1', '作業内容', 3)], 22);
    let sheet3Row = 2;
    for (const sr of sheetRows) {
      const cells = sr?.cells || [];
      const dateVal = cells[2] || '';
      const locVal = cells[5] || '';
      const memoVal = cells[20] || '';
      if (!locVal && !memoVal) { sheet3Row++; continue; }
      push3(sheet3Row, [cell(`A${sheet3Row}`, dateVal, 10), cell(`B${sheet3Row}`, locVal, 11), cell(`C${sheet3Row}`, memoVal, 11)]);
      sheet3Row++;
    }
    const sheet3Cols = `<col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="50" customWidth="1"/>`;
    const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${sheet3Cols}</cols>
  <sheetData>${sheet3Rows.join('')}</sheetData>
</worksheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="入力用勤怠表" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'入力用勤怠表'!$6:$6</definedName></definedNames><calcPr calcId="171027" fullCalcOnLoad="1"/></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const buf = buildXlsxArchive([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'xl/workbook.xml', data: workbookXml },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: stylesXml },
      { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml }
    ]);

    // Tự động lưu file xuất lên R2
    const s3Service = require('../../core/services/s3.service');
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/excel/attendance_month/${ts}_${fileNameAscii}`;
      s3Service.uploadToR2(r2Key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileNameAscii}"; filename*=UTF-8''${fileNameEncoded}`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

