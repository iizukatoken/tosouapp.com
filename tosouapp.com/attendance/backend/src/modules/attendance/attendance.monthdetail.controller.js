/**
 * @file attendance.monthdetail.controller.js
 * @description Xử lý API lấy toàn bộ chi tiết bảng chấm công của 1 tháng.
 *
 * API trong file này:
 *   - getMonthDetail → Lấy đầy đủ dữ liệu tháng để hiển thị màn hình nhập liệu chính:
 *                      từng ngày (kubun, segment, go-out), shift, phép năm, work details,
 *                      month summary, thông tin nhân viên.
 *
 * Lưu ý quan trọng về input/output:
 *   - KHÔNG thay đổi cấu trúc response — frontend phụ thuộc vào chính xác các field này
 *   - Tất cả data lấy song song (Promise.all) để tối ưu tốc độ
 *   - skipRows: không query nếu tháng tương lai + chưa approved (tránh query thừa)
 *
 * Kết nối:
 *   attendance.repository.js     → listByUserBetween, listDailyBetween, getMonthStatus...
 *   workReports.repository.js    → Ghi chú công việc theo ngày (bổ sung vào daily)
 *   leave.repository.js          → Phép năm đã được duyệt trong tháng
 *   users/user.repository.js     → Thông tin nhân viên + số ngày phép được cấp
 *   attendance.utils.js          → resolveTargetUserId, getUserOffDaySet
 *   utils/leaveRules.js          → calculatePaidLeaveEntitlement
 *   utils/employmentDate.js      → resolveEmploymentStartDate
 */
'use strict';

// Import phụ thuộc
const repo           = require('./attendance.repository');                // Đọc DB chấm công
const workReportRepo = require('../workReports/workReports.repository'); // Ghi chú công việc
const leaveRepo      = require('../leave/leave.repository');              // Phép năm
const userRepo       = require('../users/user.repository');               // Thông tin nhân viên
const db             = require('../../core/database/mysql');              // Query trực tiếp
const { formatInputToMySQLJST }          = require('../../utils/dateTime');
const { calculatePaidLeaveEntitlement }  = require('../../utils/leaveRules');
const { resolveEmploymentStartDate }     = require('../../utils/employmentDate');
const {
  resolveTargetUserId, // Kiểm tra RBAC: ai được xem của ai
  getUserOffDaySet,    // Set ngày nghỉ theo năm + bộ phận (工事部 có rule riêng)
  resolveDefaultApproverName, // 承認者の既定名（設定されたマネージャー）
} = require('./attendance.utils');

// ─── API: Lấy toàn bộ chi tiết tháng ─────────────────────────────────────────
// GET /api/attendance/month/detail?year=2026&month=3
// Trả về: thông tin nhân viên, monthStatus, days[], shiftAssignments, workDetails,
//         monthSummary, leaveSummary
exports.getMonthDetail = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.query || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });
    // Xem dữ liệu của người khác thì phải cùng tenant
    const tid = req.tenantId || null;
    if (tid != null && String(userId) !== String(req.user?.id)) {
      const [userRows] = await db.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1', [userId, tid]);
      if (!userRows || userRows.length === 0) return res.status(404).json({ message: 'User not found in tenant' });
    }

    const pad     = n => String(n).padStart(2, '0');
    const y       = parseInt(year, 10);
    const m       = parseInt(month, 10);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from    = `${y}-${pad(m)}-01`;
    const to      = `${y}-${pad(m)}-${pad(lastDay)}`;

    const role         = String(req.user?.role || '').toLowerCase();
    const monthStatusObj = await repo.getMonthStatus(userId, y, m);
    const monthStatus  = monthStatusObj?.status || 'draft';
    const approverName = monthStatusObj?.approved_by_name || null;
    const todayStr     = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // Không lấy attendance rows nếu tháng tương lai + chưa approved (tránh query thừa)
    const skipRows = role !== 'payroll' && monthStatus !== 'approved' && todayStr < from;

    // Lấy tất cả data song song để tối ưu tốc độ
    const [
      rows, dailyRows, planRows, shiftReqRows, workReportRows, off,
      shiftDefs, assigns, workDetailsRows, monthSummaryRow, goOutRecordsRows,
    ] = await Promise.all([
      skipRows ? [] : repo.listByUserBetween(userId, from, to),
      repo.listDailyBetween(userId, from, to).catch(() => []),
      repo.listPlanBetween(userId, from, to).catch(() => []),
      db.query(
        'SELECT * FROM shift_requests WHERE userId = ? AND date BETWEEN ? AND ?',
        [userId, from, to]
      ).then(r => r[0]).catch(() => []),
      workReportRepo.listByUserMonth(userId, `${y}-${pad(m)}`).catch(() => []),
      getUserOffDaySet(y, userId, tid || 0),
      repo.listShiftDefinitions().catch(() => []),
      repo.listShiftAssignmentsBetween(userId, from, to).catch(() => []),
      repo.listWorkDetailsBetween(userId, from, to).catch(() => []),
      repo.getMonthSummary(userId, y, m).catch(() => null),
      repo.getGoOutRecordsByMonth(userId, y, m).catch(() => []),
    ]);

    // シフトが差戻しされた月は、その休暇（LEAVE）を休みとして表示しない（承認されていないため）
    let shiftMonthRejected = false;
    let shiftMonthStatus = ''; // PENDING / APPROVED / REJECTED（画面: 承認済みのシフトの休暇は確定として表示）
    try {
      const [[sms] = []] = await db.query('SELECT status FROM shift_month_status WHERE userId = ? AND month = ? LIMIT 1', [userId, `${y}-${pad(m)}`]);
      shiftMonthStatus = String(sms?.status || '');
      shiftMonthRejected = shiftMonthStatus === 'REJECTED';
    } catch (e) { /* 表示用 */ }

    // Dựng map shift request (date → {status, leaveType, reason, detail})
    const shiftReqMap = new Map();
    for (const r of shiftReqRows || []) {
      if (shiftMonthRejected && r.status === 'LEAVE') continue;
      const dStr = String(r.date || '');
      const d = dStr.includes('T')
        ? dStr.slice(0, 10)
        : (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : dStr.slice(0, 10));
      if (d && ['WORKING', 'OFF', 'LEAVE'].includes(r.status)) {
        shiftReqMap.set(d, { status: r.status, leaveType: r.leaveType, reason: r.reason, detail: r.detail || null, halfPeriod: (r.half_period === 'am' || r.half_period === 'pm') ? r.half_period : null });
      }
    }

    // Dựng map định nghĩa ca (id → def, name → def)
    const shiftById   = new Map((shiftDefs || []).map(s => [String(s.id), s]));
    const shiftByName = new Map((shiftDefs || []).map(s => [String(s.name), s]));
    const resolveDefForAssign = a => {
      const byId   = shiftById.get(a?.shiftId != null ? String(a.shiftId) : '');
      const byName = !byId ? shiftByName.get(a?.shift != null ? String(a.shift) : '') : null;
      return byId || byName || null;
    };

    // Dựng map segment chấm công (date → [segment])
    const toMySQLDT = v => {
      if (!v) return '';
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 19);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s.replace('T', ' ').slice(0, 19);
      try { return formatInputToMySQLJST(v); } catch { return s; }
    };
    const segMap = new Map();
    for (const r of (rows || [])) {
      const inStr  = toMySQLDT(r.checkIn);
      const outStr = toMySQLDT(r.checkOut);
      const d = String(inStr || '').slice(0, 10) || String(outStr || '').slice(0, 10);
      if (!d) continue;
      if (!segMap.has(d)) segMap.set(d, []);
      segMap.get(d).push({
        id: r.id, checkIn: inStr || null, checkOut: outStr || null,
        shiftId: r.shiftId || null, workType: r.work_type || r.workType || null,
        labels: r.labels || null, location: r.location || null,
        memo: r.memo || null, notes: r.notes || null,
        // 追加勤務の行（2行目以降）の休憩・理由
        break_minutes: r.break_minutes != null ? Number(r.break_minutes) : null,
        extra_reason: r.extra_reason || null,
      });
    }

    // Dựng map daily (date → daily record)
    // work_report cung cấp workType/location/memo dự phòng nếu attendance_daily không có
    // (chỉ dùng khi đúng 1 báo cáo/ngày — nhiều báo cáo thì không đoán, để trống)
    const reportsByDate = new Map();
    for (const r of workReportRows || []) {
      const d = String(r?.date || '').slice(0, 10);
      if (!d) continue;
      if (!reportsByDate.has(d)) reportsByDate.set(d, []);
      reportsByDate.get(d).push(r);
    }
    const reportMap = new Map();
    for (const [d, list] of reportsByDate.entries()) {
      if (list.length !== 1) continue;
      const r = list[0];
      reportMap.set(d, { workType: r?.work_type || null, location: r?.site || null, memo: r?.work || null });
    }
    const dailyMap = new Map();
    for (const r of dailyRows || []) {
      const d   = String(r?.date || '').slice(0, 10);
      if (!d) continue;
      const rpt = reportMap.get(d) || null;
      const kc  = Number(r.kubun_confirmed || 0) ? 1 : (String(r.kubun || '').trim() ? 1 : 0);
      dailyMap.set(d, {
        kubun:             r.kubun    || null,
        kubunConfirmed:    kc,
        workType:          (r.work_type != null && r.work_type !== '') ? r.work_type : (rpt?.workType || null),
        location:          (r.location  != null && r.location  !== '') ? r.location  : (rpt?.location || null),
        reason:            r.reason   || null,
        memo:              (r.memo != null && r.memo !== '') ? r.memo : (rpt?.memo || null),
        notes:             r.notes    || null,
        late_minutes:      r.late_minutes  == null ? null : Number(r.late_minutes),
        early_minutes:     r.early_minutes == null ? null : Number(r.early_minutes),
        lateMinutes:       r.late_minutes  == null ? null : Number(r.late_minutes),
        earlyMinutes:      r.early_minutes == null ? null : Number(r.early_minutes),
        breakMinutes:      r.break_minutes       == null ? null : Number(r.break_minutes),
        nightBreakMinutes: r.night_break_minutes == null ? null : Number(r.night_break_minutes),
        status:            r.status   || null,
        // 半休の 午前休(am) / 午後休(pm)。未選択は null
        halfPeriod:        (r.half_period === 'am' || r.half_period === 'pm') ? r.half_period : null,
      });
    }
    // Điền thêm từ workReport cho ngày không có daily record
    for (const [d, rpt] of reportMap.entries()) {
      if (!dailyMap.has(d)) {
        dailyMap.set(d, {
          kubun: null, kubunConfirmed: 0,
          workType: rpt?.workType || null, location: rpt?.location || null,
          reason: null, memo: rpt?.memo || null,
          breakMinutes: null, nightBreakMinutes: null,
        });
      }
    }

    // Helper: tìm định nghĩa ca áp dụng cho ngày cụ thể
    // Lấy assignment gần nhất có start_date <= ds và end_date >= ds (hoặc không có end_date)
    const shiftForDate = ds => {
      let best = null;
      for (const a of assigns || []) {
        const sd = String(a?.start_date || '').slice(0, 10);
        if (!sd || sd > ds) continue;
        const ed = a?.end_date ? String(a.end_date).slice(0, 10) : '';
        if (ed && ed < ds) continue;
        best = a;
      }
      if (!best) return null;
      const def = resolveDefForAssign(best);
      return def ? {
        id: def.id, name: def.name, start_time: def.start_time,
        end_time: def.end_time, break_minutes: def.break_minutes,
        standard_minutes: def.standard_minutes,
      } : null;
    };

    // Dựng danh sách gán ca
    const shiftAssignments = (assigns || []).map(a => {
      const def = resolveDefForAssign(a);
      return {
        id:         a?.id || null,
        start_date: String(a?.start_date || '').slice(0, 10) || null,
        end_date:   a?.end_date ? String(a.end_date).slice(0, 10) : null,
        shift: def ? {
          id: def.id, name: def.name, start_time: def.start_time,
          end_time: def.end_time, break_minutes: def.break_minutes,
          standard_minutes: def.standard_minutes,
        } : null,
      };
    });

    // Dựng danh sách work details
    const workDetails = (workDetailsRows || []).map(r => ({
      id:                  r.id,
      startDate:           String(r.start_date || '').slice(0, 10) || null,
      endDate:             r.end_date ? String(r.end_date).slice(0, 10) : null,
      companyName:         r.company_name         || null,
      workPlaceAddress:    r.work_place_address   || null,
      workContent:         r.work_content         || null,
      roleTitle:           r.role_title           || null,
      responsibilityLevel: r.responsibility_level || null,
    }));

    // Dựng month summary (tổng hợp do admin nhập)
    const safeParse = s => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
    const monthSummary = monthSummaryRow ? {
      all:       safeParse(monthSummaryRow.summary_all),
      inhouse:   safeParse(monthSummaryRow.summary_inhouse),
      updatedBy: monthSummaryRow.updated_by || null,
      updatedAt: monthSummaryRow.updated_at || null,
    } : null;

    // Dựng leave summary (phép năm đã dùng trong tháng)
    const leaveSummary = await (async () => {
      // Helper: số ngày trong khoảng [a, b] giao [bStart, bEnd]
      const daysBetween = (a, b) => Math.max(0, Math.ceil(
        (new Date(String(b).slice(0, 10) + 'T00:00:00Z') - new Date(String(a).slice(0, 10) + 'T00:00:00Z')) / 86400000
      ) + 1);
      const overlap = (aS, aE, bS, bE) => {
        const s = aS > bS ? aS : bS, e = aE < bE ? aE : bE;
        return s > e ? 0 : daysBetween(s, e);
      };
      try {
        const [all, grants] = await Promise.all([
          leaveRepo.listApprovedByUserOverlap(userId, from, to).catch(() => []),
          leaveRepo.listGrants(userId, 'paid').catch(() => []),
        ]);
        let paidDays = 0, substituteDays = 0, unpaidDays = 0, standbyDays = 0;
        let grantedDaysTotal = 0, grantedDays = 0;
        for (const r of (all || [])) {
          const s = String(r?.startDate || '').slice(0, 10);
          const e = String(r?.endDate   || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) continue;
          const ov = overlap(s, e, from, to);
          if (ov <= 0) continue;
          const t = String(r?.type || '').toLowerCase();
          if (t === 'paid')       paidDays += ov;
          else if (t === 'paid_half') paidDays += 0.5;
          else if (t.includes('sub') || t.includes('daikyu') || t.includes('comp')) substituteDays += ov;
          else if (t.includes('unpaid') || t.includes('nopay') || t.includes('no_pay')) unpaidDays += ov;
          else if (t.includes('standby') || t.includes('wait') || t.includes('taiki')) standbyDays += ov;
        }
        // Đối chiếu thêm với kubun trong attendance_daily (trường hợp chưa có leave_request)
        try {
          let kRSql = `SELECT COUNT(*) as cnt FROM attendance_daily WHERE userId = ? AND date BETWEEN ? AND ? AND kubun = '有給休暇'`;
          const kRParams = [userId, from, to];
          if (tid != null) { kRSql += ` AND tenant_id = ?`; kRParams.push(tid); }
          const [kR] = await db.query(kRSql, kRParams);
          let kHSql = `SELECT COUNT(*) as cnt FROM attendance_daily WHERE userId = ? AND date BETWEEN ? AND ? AND kubun = '半休(有給)'`;
          const kHParams = [userId, from, to];
          if (tid != null) { kHSql += ` AND tenant_id = ?`; kHParams.push(tid); }
          const [kH] = await db.query(kHSql, kHParams);
          const kubunPaid = Number(kR?.[0]?.cnt || 0) + Number(kH?.[0]?.cnt || 0) * 0.5;
          if (kubunPaid > paidDays) paidDays = kubunPaid;
        } catch (e) { /* bỏ qua */ }
        // 有給付与: 有給管理と同じ算出（労基法の法定付与＋登録付与、2年時効）を使う。
        // 失敗時のみ登録付与(leave_grants)にフォールバックする。
        let effGrants = null;
        try {
          const { computeUserBalance } = require('../leave/leave.controller');
          effGrants = (await computeUserBalance(userId, tid || null))?.grants || null;
        } catch (e) { effGrants = null; }
        if (effGrants) {
          const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
          for (const g of effGrants) {
            const gd = String(g?.grantDate || '').slice(0, 10);
            const ge = String(g?.expiryDate || '').slice(0, 10);
            if (ge >= todayStr) grantedDaysTotal += Number(g?.daysGranted || 0); // 有効な付与の合計（有給カードの分母と同じ）
            if (ge < from || gd > to) continue;
            grantedDays += Number(g?.daysGranted || 0);
          }
          return { paidDays, substituteDays, unpaidDays, standbyDays, grantedDays, grantedDaysTotal };
        }
        for (const g of (grants || [])) {
          grantedDaysTotal += Number(g?.daysGranted || 0);
          const gd = String(g?.grantDate  || '').slice(0, 10);
          const ge = String(g?.expiryDate || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(gd) || !/^\d{4}-\d{2}-\d{2}$/.test(ge)) continue;
          if (ge < from || gd > to) continue;
          grantedDays += Number(g?.daysGranted || 0);
        }
        return { paidDays, substituteDays, unpaidDays, standbyDays, grantedDays, grantedDaysTotal };
      } catch {
        return { paidDays: 0, substituteDays: 0, unpaidDays: 0, standbyDays: 0, grantedDays: 0, grantedDaysTotal: 0 };
      }
    })();

    // Dựng map ra ngoài (date → [go_out records])
    const goOutMap = new Map();
    for (const r of goOutRecordsRows) {
      const d = String(r.date).slice(0, 10);
      if (!goOutMap.has(d)) goOutMap.set(d, []);
      goOutMap.get(d).push({
        id: r.id, go_out_time: r.go_out_time, return_time: r.return_time,
        type: r.type, reason: r.reason,
      });
    }

    // Thông tin nhân viên (lấy sớm để dùng cho suy diễn 休日 tự động bên dưới)
    const u = await userRepo.getUserById(userId).catch(() => null);
    const isPartTime = u?.employment_type === 'part_time';

    // Các kubun được coi là "đi làm" (nếu đã set thì KHÔNG tự chuyển 休日)
    const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
    // Các kubun nghỉ/đã xác định rõ (nếu đã set thì giữ nguyên, không auto)
    const explicitKubunSet = new Set(['休日', '有給休暇', '欠勤', '無給休暇', '代替休日', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤', '出勤']);

    // Dựng danh sách từng ngày trong tháng
    const days = [];
    for (let day = 1; day <= lastDay; day++) {
      const ds   = `${y}-${pad(m)}-${pad(day)}`;
      const plan = planRows.find(p => String(p.date).slice(0, 10) === ds) || null;
      const dailyForDay = dailyMap.get(ds) || null;
      const shiftReqForDay = shiftReqMap.get(ds) || null;
      const segsForDay = segMap.get(ds) || [];

      // ── Suy diễn "tự động 休日" ─────────────────────────────────────────────
      // Khi ngày đó đã KẾT THÚC (từ hôm sau trở đi) mà nhân viên KHÔNG chấm công và
      // KHÔNG có kubun cụ thể, hệ thống tự hiển thị 休日 (không bắt nhập tay).
      //   - 正社員: ngày nghỉ theo lịch (CN/ngày đỏ/công ty) hoặc đã đăng ký OFF.
      //   - パート: ngày đăng ký OFF, hoặc 予定なし (không đăng ký), hoặc ngày nghỉ lịch.
      // Hôm nay và ngày tương lai vẫn giữ 休日予定 / 出勤予定 / 予定なし (hôm nay còn có thể đi làm).
      let autoOff = 0;
      const kubun0 = String(dailyForDay?.kubun || '').trim();
      const hasPunch = segsForDay.some(s => !!s?.checkIn || !!s?.checkOut);
      const reqStatus = shiftReqForDay?.status || null;
      const isDatePassed = ds < todayStr;                  // hết ngày rồi mới tự 休日 (không gồm hôm nay)
      const hasExplicitKubun = explicitKubunSet.has(kubun0);
      const isWorkingReq = reqStatus === 'WORKING';
      // LEAVE は休暇の種類（有給・半休・欠勤 など）がある時だけ休暇扱い。種類の無い LEAVE はただの休み（OFF と同じ）
      const SHIFT_LEAVE_TYPES = ['paid', 'paid_half', 'half', 'unpaid', 'substitute', 'special'];
      const isLeaveReq = reqStatus === 'LEAVE' && SHIFT_LEAVE_TYPES.includes(String(shiftReqForDay?.leaveType || ''));
      const isPlainOffReq = reqStatus === 'OFF' || (reqStatus === 'LEAVE' && !isLeaveReq);

      if (isDatePassed && !hasPunch && !hasExplicitKubun && !isWorkingReq && !isLeaveReq) {
        if (isPartTime) {
          // Part-time: mọi ngày không đi làm & không có WORKING/LEAVE -> 休日 tự động
          // (bao gồm OFF đã đăng ký, 予定なし, và ngày nghỉ lịch)
          autoOff = 1;
        } else {
          // 正社員: chỉ tự 休日 cho ngày nghỉ (lịch đỏ/CN/công ty) hoặc đã đăng ký OFF
          if (off.has(ds) || isPlainOffReq) autoOff = 1;
        }
      }

      days.push({
        date:         ds,
        is_off:       off.has(ds) ? 1 : 0,
        autoOff,
        shift:        shiftForDate(ds),
        daily:        dailyForDay,
        plan:         plan ? { shiftId: plan.shiftId, workType: plan.work_type, location: plan.location, memo: plan.memo } : null,
        shiftRequest: shiftReqForDay,
        segments:     segsForDay,
        goOutRecords: goOutMap.get(ds)  || [],
      });
    }
    const paidLeaveEntitlement = calculatePaidLeaveEntitlement(resolveEmploymentStartDate(u));
    const user = u ? {
      id:               u.id,
      employee_code:    u.employee_code  || null,
      employeeCode:     u.employee_code  || null,
      username:         u.username       || null,
      email:            u.email          || null,
      departmentId:     u.departmentId   || null,
      departmentName:   u.departmentName || null,
      office_code:      u.office_code    || null,
      officeCode:       u.office_code    || null,
      employment_type:  u.employment_type || null,
      is_flex:          Number(u.is_flex || 0) === 1 ? 1 : 0, // フレックス: 遅刻・早退を表示しない
      paidLeaveEntitlement,
      paidLeaveGrantedDays:      Number(leaveSummary?.grantedDays      || 0),
      paidLeaveGrantedTotalDays: Number(leaveSummary?.grantedDaysTotal || 0),
    } : null;

    // 休暇の日ごとの申請状況（承認済み / 申請中 / 差戻し）— 画面の「状態」を
    // 未確認 ではなく 申請中・承認済み と表示するため。自動生成・自動取消の行は除く。
    let leaveStatusByDate = {};
    try {
      leaveStatusByDate = await leaveRepo.listLeaveStatusByDate(userId, from, to, tid || null);
    } catch (e) { /* 表示用。取れなければ従来どおり */ }

    // 確認済みの日の 承認者 に出す名前（月次Excel と同じ: 設定されたマネージャー）
    let defaultApproverName = '';
    try { defaultApproverName = await resolveDefaultApproverName(u, userId, tid); } catch (e) { /* 表示用 */ }

    // 管理者・マネージャーが打刻編集した日（画面の ✎ と、マウスを乗せたときの原本の説明）
    const punchEditsByDate = {};
    try {
      const punchEdit = require('./attendance.punchEdit');
      const map = await punchEdit.editedMap({ tenantId: tid || null, userIds: [userId], from, to });
      for (const [key, list] of map) {
        punchEditsByDate[key.split('|')[1]] = {
          lines: punchEdit.describeEdits(list),
          in: list.some(e => ['edit_in', 'void_row', 'add'].includes(e.action)),
          out: list.some(e => e.action !== 'edit_in')
        };
      }
    } catch (e) { /* ✎ が出ないだけ */ }

    // 履歴 › 表示 の件数（打刻編集 ＋ 承認した調整申請）。0件の日は普通の 表示 ボタン
    const changeCountByDate = {};
    for (const [d, v] of Object.entries(punchEditsByDate)) changeCountByDate[d] = (v.lines || []).length;
    try {
      const [ar] = await db.query(
        "SELECT DATE_FORMAT(COALESCE(requestedCheckIn, requestedCheckOut), '%Y-%m-%d') AS d, COUNT(*) AS n FROM time_adjust_requests WHERE userId = ? AND status = 'approved' AND DATE(COALESCE(requestedCheckIn, requestedCheckOut)) BETWEEN ? AND ? GROUP BY d",
        [userId, from, to]
      );
      for (const r of ar || []) changeCountByDate[r.d] = (changeCountByDate[r.d] || 0) + Number(r.n || 0);
    } catch (e) { /* 調整申請のテーブルがない環境 */ }

    // Trả kết quả
    res.status(200).json({
      year: y, month: m, from, to,
      user,
      leaveStatusByDate,
      punchEditsByDate,
      changeCountByDate,
      shiftMonthStatus,
      monthStatus: {
        status:      monthStatus,
        approved_by: monthStatusObj?.approved_by || null,
        approved_at: monthStatusObj?.approved_at || null,
        approverName,
        defaultApproverName,
      },
      shiftAssignments,
      workDetails,
      monthSummary,
      leaveSummary,
      days,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
