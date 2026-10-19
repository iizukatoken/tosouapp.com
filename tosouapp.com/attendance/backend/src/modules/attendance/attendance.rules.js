const { parseMySQLJSTToDate } = require('../../utils/dateTime');
// Chuyển chuỗi DATETIME (JST) sang Date (theo UTC) để tính toán

function minutesBetween(a, b) {
  // Tính chênh lệch phút giữa hai thời điểm, không âm
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

const getJSTDateStr = (val) => {
  if (!val) return '';
  if (typeof val === 'string') {
    const p = val.split(' ')[0].split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  }
  const dateObj = val instanceof Date ? val : new Date(val);
  if (isNaN(dateObj.getTime())) return '';
  const jst = new Date(dateObj.getTime() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`;
};

/**
 * Hàm thuần để dễ test (ưu tiên 2)
 * Tách logic tính toán ra khỏi DB để viết được Unit Test.
 */
const CoreRules = {
  /**
   * Tính thời gian làm việc cơ bản và các cờ bất thường
   */
  calculateWorkMetrics(checkIn, checkOut, shift, isOff = false) {
    if (!checkIn || !checkOut) {
      return { 
        regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, 
        isAnomaly: true, anomalyType: !checkOut ? 'MISSING_CHECKOUT' : 'MISSING_CHECKIN' 
      };
    }

    const inJ = parseMySQLJSTToDate(checkIn);
    const outJ = parseMySQLJSTToDate(checkOut);

    if (outJ < inJ) {
      // Dữ liệu sai (退勤 trước 出勤): chỉ ngày này tính 0 và gắn cờ bất thường.
      // Trước đây ném lỗi → computeRange hỏng → API tháng / 給与 / 台帳 lỗi 500 cho CẢ THÁNG.
      return {
        regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0,
        isAnomaly: true, anomalyType: 'CHECKOUT_BEFORE_CHECKIN'
      };
    }

    const worked = minutesBetween(inJ, outJ);
    const breakMin = shift?.breakMinutes ?? 60;
    
    // 1. Tính baseline (theo ca làm việc)
    // Giờ ca cũng được parse đúng định dạng
    const shiftStart = shift?.start ? parseMySQLJSTToDate(shift.start) : new Date();
    const shiftEnd = shift?.end ? parseMySQLJSTToDate(shift.end) : new Date();

    // Tính số phút theo lịch dựa trên start/end của ca (chưa trừ nghỉ tự động ở đây)
    const scheduled = isOff ? 0 : minutesBetween(shiftStart, shiftEnd);
    
    // Số phút công chuẩn = tối đa (scheduled - breakMin), nhưng không vượt (worked - breakMin)
    const regular = isOff ? 0 : Math.min(worked - breakMin, scheduled - breakMin);
    const overtime = Math.max(0, worked - scheduled);

    // 2. Tính giờ làm đêm (22:00 - 05:00)
    let night = 0;
    const y = inJ.getUTCFullYear();
    const m = inJ.getUTCMonth();
    const d = inJ.getUTCDate();
    const nightWindows = [];
    // JST là UTC+9, nên 22:00 JST = 13:00 UTC, 05:00 JST = 20:00 UTC (ngày trước hoặc cùng ngày)
    // Đơn giản hóa để khớp với logic hiện tại:
    for (let k = -1; k < 2; k++) { 
      const start = new Date(Date.UTC(y, m, d + k, 22 - 9, 0, 0));
      const end = new Date(Date.UTC(y, m, d + k + 1, 5 - 9, 0, 0));
      nightWindows.push({ start, end });
    }
    for (const w of nightWindows) {
      const s = inJ > w.start ? inJ : w.start;
      const e = outJ < w.end ? outJ : w.end;
      const mins = Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
      night += mins;
    }

    // 3. Xử lý cờ bất thường (chặn rủi ro nghiệp vụ)
    let isAnomaly = false;
    let anomalyType = null;

    // Kiểm tra ngày theo giờ JST (UTC+9)
    const inJST = new Date(inJ.getTime() + 9 * 3600 * 1000);
    const outJST = new Date(outJ.getTime() + 9 * 3600 * 1000);
    const inJSTDate = inJST.getUTCDate();
    const outJSTDate = outJST.getUTCDate();

    if (worked > 12 * 60) {
      isAnomaly = true;
      anomalyType = 'OVERWORK_GT_12H';
    } else if (inJSTDate !== outJSTDate) {
      isAnomaly = true;
      anomalyType = 'OVERNIGHT_SHIFT';
    } else if (inJST.getUTCHours() < 7) { // Trước 7:00 sáng JST
      isAnomaly = true;
      anomalyType = 'EARLY_CHECKIN';
    }

    return {
      regularMinutes: regular,
      overtimeMinutes: overtime,
      nightMinutes: night,
      isAnomaly,
      anomalyType
    };
  }
};

async function computeRecord(rec, ctx = null) {
  const settingsRepo = require('../settings/settings.repository');
  const userRepo = require('../users/user.repository');
  const attendanceRepo = require('./attendance.repository');
  const calendarRepo = require('../calendar/calendar.repository');
  // Tính phút công chuẩn và phút tăng ca cho một bản ghi attendance
  const cfg = ctx?.cfg !== undefined ? ctx.cfg : await settingsRepo.getSettings().catch(() => null);
  const baseBreak = cfg?.breakMinutes || 60;
  
  const dateStr = getJSTDateStr(rec.checkIn || rec.checkOut);
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10) - 1;
  const d = parseInt(dStr, 10);
  const jst = (hh, mm) => new Date(Date.UTC(y, m, d, hh - 9, mm, 0));
  let shift;
  let template = false;
  if (rec.shiftId) {
    const def = ctx?.shiftCache ? ctx.shiftCache[rec.shiftId] : await attendanceRepo.getShiftById(rec.shiftId);
    if (def) {
      const [sH, sM] = String(def.start_time).split(':').map(n => parseInt(n, 10));
      const [eH, eM] = String(def.end_time).split(':').map(n => parseInt(n, 10));
      const shiftStartDate = jst(sH, sM || 0);
      let shiftEndDate = jst(eH, eM || 0);
      // Ca qua đêm (VD 22:00-06:00): end_time <= start_time nghĩa là kết thúc
      // vào ngày hôm sau — cộng thêm 24h, tránh minutesBetween() ra số âm rồi
      // bị Math.max(0, ...) kẹp về 0 giờ công (xem dòng ~296).
      if (shiftEndDate.getTime() <= shiftStartDate.getTime()) {
        shiftEndDate = new Date(shiftEndDate.getTime() + 24 * 3600 * 1000);
      }
      shift = { name: def.name, start: shiftStartDate, end: shiftEndDate, breakMinutes: def.break_minutes ?? baseBreak };
      try {
        const wt = String(rec.work_type || rec.workType || '').trim();
        const labels = String(rec.labels || '').trim();
        // Lấy trực tiếp HH:MM từ chuỗi JST gốc trong DB (KHÔNG dựng Date rồi đọc
        // getUTCHours/getUTCMinutes) — vì Date từ parseMySQLJSTToDate() lùi sang
        // ngày UTC hôm trước khi giờ JST < 9:00 (ca 8:00 rất phổ biến), khiến
        // getUTCHours() trả về ~23 thay vì 8 và không bao giờ khớp def.start_time.
        const fmtHm = v => v ? String(v).replace('T', ' ').slice(11, 16) : '';
        const inHm = fmtHm(rec.checkIn);
        const outHm = fmtHm(rec.checkOut);
        if (!wt && !labels && inHm === String(def.start_time || '').trim() && outHm === String(def.end_time || '').trim()) {
          template = true;
        }
      } catch (e) { /* bỏ qua nếu lỗi */ }
    }
  }
  if (!shift) {
    const u = ctx?.userCache ? ctx.userCache[rec.userId] : await userRepo.getUserById(rec.userId).catch(() => null);
    const empType = String(u?.employment_type || 'full_time').toLowerCase();
    if (empType === 'full_time') {
      let deptNameRaw = '';
      if (u?.departmentId) {
        const dept = ctx?.deptCache ? ctx.deptCache[u.departmentId] : await userRepo.getDepartmentById(u.departmentId).catch(() => null);
        deptNameRaw = String(dept?.name || '').trim().toLowerCase();
      }
      const isConstruction = ['工事', 'kouji', 'koji', 'construction', 'engineering'].some(k => deptNameRaw.includes(k));
      const isAccounting = ['経理', 'keiri', 'accounting', 'finance'].some(k => deptNameRaw.includes(k));
      if (isConstruction) {
        shift = { name: 'day_8_17', start: jst(8, 0), end: jst(17, 0), breakMinutes: 60 };
      } else if (isAccounting) {
        shift = { name: 'day_9_17', start: jst(9, 0), end: jst(17, 0), breakMinutes: 60 };
      } else if (cfg?.workStart && cfg?.workEnd) {
        const [sH, sM] = String(cfg.workStart).split(':').map(n => parseInt(n, 10));
        const [eH, eM] = String(cfg.workEnd).split(':').map(n => parseInt(n, 10));
        shift = { name: `settings_${cfg.workStart}_${cfg.workEnd}`, start: jst(sH, sM || 0), end: jst(eH, eM || 0), breakMinutes: baseBreak };
      } else {
        shift = { name: 'day_8_17', start: jst(8, 0), end: jst(17, 0), breakMinutes: 60 };
      }
    } else {
      let worked2 = 0;
      let inJ2 = null;
      let outJ2 = null;
      if (rec.checkIn && rec.checkOut) {
        inJ2 = parseMySQLJSTToDate(rec.checkIn);
        outJ2 = parseMySQLJSTToDate(rec.checkOut);
        worked2 = minutesBetween(inJ2, outJ2);
      }
      const s1 = { name: 'day_8_17', start: jst(8, 0), end: jst(17, 0), breakMinutes: 60 };
      const s2 = { name: 'day_9_17', start: jst(9, 0), end: jst(17, 0), breakMinutes: 60 };
      const s3 = { name: 'part_9_14', start: jst(9, 0), end: jst(14, 0), breakMinutes: 0 };
      if (worked2 >= 7 * 60) {
        if (inJ2 <= jst(8, 30) && outJ2 >= jst(17, 0)) {
          shift = s1;
        } else if (inJ2 <= jst(9, 30) && outJ2 >= jst(16, 0)) {
          shift = s2;
        } else {
          shift = s3;
        }
      } else {
        shift = s3;
      }
    }
  }
  let breakMin = shift.breakMinutes ?? baseBreak;
  
  let dailyRec = null;
  if (ctx?.dailyCache && ctx.dailyCache[rec.userId] && ctx.dailyCache[rec.userId][dateStr]) {
    dailyRec = ctx.dailyCache[rec.userId][dateStr];
  } else if (!ctx?.dailyCache) {
    dailyRec = await attendanceRepo.getDaily(rec.userId, dateStr).catch(() => null);
  }
  
  if (dailyRec && dailyRec.break_minutes != null) {
    breakMin = Number(dailyRec.break_minutes);
    shift = { ...shift, breakMinutes: breakMin };
  }

  let worked = 0;
  let inJ = null;
  let outJ = null;
  if (rec.checkIn && rec.checkOut) {
    inJ = parseMySQLJSTToDate(rec.checkIn);
    outJ = parseMySQLJSTToDate(rec.checkOut);
    worked = minutesBetween(inJ, outJ);
  }
  
  // Trừ thời gian ra ngoài vì việc cá nhân
  let privateGoOutMinutes = 0;
  let workGoOutMinutes = 0;
  let goOuts = [];
  if (ctx?.goOutCache && ctx.goOutCache[rec.userId] && ctx.goOutCache[rec.userId][dateStr]) {
    goOuts = ctx.goOutCache[rec.userId][dateStr];
  } else if (!ctx?.goOutCache) {
    goOuts = await attendanceRepo.getGoOutRecords(rec.userId, dateStr).catch(() => []);
  }
  for (const g of goOuts) {
    if (g.go_out_time) {
      const gIn = parseMySQLJSTToDate(g.go_out_time);
      let gOut = null;
      if (g.return_time) {
        gOut = parseMySQLJSTToDate(g.return_time);
      } else if (rec.checkOut) {
        gOut = parseMySQLJSTToDate(rec.checkOut);
      }
      
      if (gOut) {
        const mins = Math.max(0, minutesBetween(gIn, gOut));
        if (g.type === '私用') {
          privateGoOutMinutes += mins;
        } else if (g.type === '業務') {
          workGoOutMinutes += mins;
        }
      }
    }
  }
  
  // Trừ đi thời gian đi việc riêng và thời gian nghỉ
  worked = Math.max(0, worked - privateGoOutMinutes - breakMin);
  // ─── Làm tròn ────────────────────────────────────────────────────────────
  // Quy tắc:
  // - Giờ vào: nếu trước ca -> tính từ giờ ca, nếu trong/ sau -> làm tròn LÊN 30 phút
  // - Giờ ra: nếu sau ca -> phần OT làm tròn XUỐNG 30 phút; nếu trong ca -> làm tròn XUỐNG 30 phút
  const ROUND_STEP = 30; // phút
  // Hàm làm tròn
  const ceilToStep = (v, step) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.ceil(n / step) * step;
  };
  const floorToStep = (v, step) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n / step) * step;
  };

  // Tính số phút thực tế trôi qua kể từ giờ bắt đầu ca (neo theo shift.start bằng
  // hiệu thời gian thực - KHÔNG dùng getUTCHours()*60+getUTCMinutes()). Lý do: các
  // Date ở đây được dựng bằng Date.UTC(y,m,d,hh-9,...) để quy đổi JST->UTC, nên với
  // giờ JST < 9:00 (VD ca 8:00-17:00 rất phổ biến), hh-9 âm khiến Date lùi sang ngày
  // UTC hôm trước với getUTCHours() nhảy vọt lên ~23 — làm "phút trong ngày" không
  // còn tuyến tính quanh mốc 9h JST, khiến so sánh rOutMin < shiftStartMin sai lệch
  // nghiêm trọng (từng tính ra vài trăm phút tăng ca ảo cho ca làm chưa tới 1 giờ).
  const diffMinutes = (a, b) => (a && b) ? Math.round((b.getTime() - a.getTime()) / 60000) : null;
  const inMin = diffMinutes(shift.start, inJ);
  const outMin = diffMinutes(shift.start, outJ);
  const shiftStartMin = 0;
  const shiftEndMin = diffMinutes(shift.start, shift.end);

  // Tính giá trị làm tròn
  let rInMin = null;
  let rOutMin = null;
  if (inMin != null) {
    // Luôn làm tròn LÊN theo bước 30 phút, không ép về giờ bắt đầu ca
    rInMin = ceilToStep(inMin, ROUND_STEP);
  }
  if (outMin != null) {
    if (shiftEndMin != null && outMin > shiftEndMin) {
      const otRaw = outMin - shiftEndMin;
      const otRounded = floorToStep(otRaw, ROUND_STEP);
      rOutMin = shiftEndMin + otRounded;
    } else {
      rOutMin = floorToStep(outMin, ROUND_STEP);
      if (shiftStartMin != null && rOutMin < shiftStartMin) rOutMin = shiftStartMin;
    }
  }

  let isOff = ctx?.offDayCache ? (ctx.offDayCache[dateStr] || false) : await calendarRepo.isOff(dateStr, ctx?.tenantId || 0).catch(() => false);
  if (dailyRec && dailyRec.kubun) {
    isOff = ['休日', '法定休日', '欠勤'].includes(dailyRec.kubun);
  }

  const scheduled = isOff ? 0 : Math.max(0, minutesBetween(shift.start, shift.end) - breakMin);

  // Dựa trên giá trị đã làm tròn để tính công chuẩn và tăng ca
  let workedRounded = 0;
  if (rInMin != null && rOutMin != null) {
    workedRounded = Math.max(0, rOutMin - rInMin - breakMin);
  }

  // 実働 = 丸め後の退勤 − 丸め後の出勤 − 休憩 (出勤は30分切り上げ、退勤は30分切り捨て)。
  // 所定内 = 実働のうち所定時間まで、残業 = それを超えた分 → 所定内+残業 は常に実働と一致する。
  // (以前は 残業=定時後の分だけ・所定内=min(実働,所定) だったため、遅刻+残業の日は遅刻分が
  //  二重に数えられ (08:16-23:00 が 14:00)、早出の日は早出分が消えていた (07:00-17:00 が 8:00)。)
  const regular = Math.min(workedRounded, scheduled);
  const overtime = Math.max(0, workedRounded - regular);
  // 実績 (丸め前): 実際の打刻どおりの 実働 (退勤−出勤−私用外出−休憩) と、同じ分け方の残業。
  // 勤怠記録画面の 実績/丸め 切替で使う。給与計算などは従来どおり丸め後の値を使う。
  const actualWorkedMinutes = worked;
  const actualOvertimeMinutes = Math.max(0, worked - Math.min(worked, scheduled));
  // 丸め後の出勤・退勤 (HH:MM, JST)
  const toJstHm = (min) => (min == null || !shift.start) ? null
    : new Date(shift.start.getTime() + min * 60000 + 9 * 3600 * 1000).toISOString().slice(11, 16);
  const roundedIn = toJstHm(rInMin);
  const roundedOut = toJstHm(rOutMin);

  // Dùng CoreRules để lấy thêm thông tin bất thường
  const metrics = CoreRules.calculateWorkMetrics(rec.checkIn, rec.checkOut, shift, isOff);

  return {
    id: rec.id,
    userId: rec.userId,
    date: dateStr,
    checkIn: rec.checkIn,
    checkOut: rec.checkOut,
    shift: shift.name,
    template,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    actualWorkedMinutes,
    actualOvertimeMinutes,
    roundedIn,
    roundedOut,
    breakMinutes: breakMin,
    nightMinutes: metrics.nightMinutes,
    isAnomaly: metrics.isAnomaly,
    anomalyType: metrics.anomalyType,
    privateGoOutMinutes,
    workGoOutMinutes,
    workType: rec.work_type || rec.workType || null,
    location: rec.location || null,
    memo: rec.memo || null,
    notes: rec.notes || null
  };
}

async function computeRange(rows, tenantId = 0) {
  // Tổng hợp theo ngày và tổng cộng trong khoảng từ danh sách bản ghi đã chốt
  const items = [];
  if (!rows || rows.length === 0) return { days: [], total: { regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0 } };

  const settingsRepo = require('../settings/settings.repository');
  const userRepo = require('../users/user.repository');
  const attendanceRepo = require('./attendance.repository');
  const calendarRepo = require('../calendar/calendar.repository');

  const cfg = await settingsRepo.getSettings().catch(() => null);
  const userCache = {};
  const deptCache = {};
  const shiftCache = {};
  const offDayCache = {};

  const years = new Set();
  for (const r of rows) {
    if (r.checkIn) {
      const dStr = typeof r.checkIn === 'string' ? r.checkIn : (r.checkIn instanceof Date ? r.checkIn.toISOString() : String(r.checkIn));
      years.add(parseInt(dStr.slice(0, 4), 10));
    }
  }
  
  await Promise.all(
    Array.from(years)
      .filter((y) => y && !isNaN(y))
      .map(async (y) => {
        const cal = await calendarRepo.computeYear(y, tenantId).catch(() => null);
        if (cal && cal.off_days) {
          for (const d of cal.off_days) {
            offDayCache[d] = true;
          }
        }
      })
  );

  const userIds = Array.from(new Set(rows.map(r => r.userId)));
  const users = await Promise.all(userIds.map((uid) => userRepo.getUserById(uid).catch(() => null)));
  const departmentIds = new Set();
  users.forEach((u, index) => {
    const uid = userIds[index];
    userCache[uid] = u;
    if (u?.departmentId) departmentIds.add(u.departmentId);
  });
  await Promise.all(
    Array.from(departmentIds).map(async (departmentId) => {
      deptCache[departmentId] = await userRepo.getDepartmentById(departmentId).catch(() => null);
    })
  );

  const shiftIds = Array.from(new Set(rows.map(r => r.shiftId).filter(Boolean)));
  await Promise.all(shiftIds.map(async sid => {
    shiftCache[sid] = await attendanceRepo.getShiftById(sid).catch(() => null);
  }));

  const goOutCache = {};
  const dailyCache = {};
  if (rows.length > 0) {
    const uniqueDates = Array.from(new Set(rows.map(r => getJSTDateStr(r.checkIn))));
    const minDate = uniqueDates.reduce((a, b) => a < b ? a : b);
    const maxDate = uniqueDates.reduce((a, b) => a > b ? a : b);
    const ymList = Array.from(new Set(uniqueDates.map(d => d.slice(0, 7))));
    await Promise.all(userIds.map(async (uid) => {
      goOutCache[uid] = {};
      dailyCache[uid] = {};
      const goOutResults = await Promise.all(
        ymList.map(async (ym) => {
          const [yy, mm] = ym.split('-');
          return attendanceRepo.getGoOutRecordsByMonth(uid, yy, mm).catch(() => []);
        })
      );
      for (const goOuts of goOutResults) {
        for (const g of goOuts) {
          if (!goOutCache[uid][g.date]) goOutCache[uid][g.date] = [];
          goOutCache[uid][g.date].push(g);
        }
      }

      const dailies = await attendanceRepo.listDailyBetween(uid, minDate, maxDate).catch(() => []);
      for (const d of dailies) {
        if (d.date) {
          const dStr = getJSTDateStr(d.date);
          dailyCache[uid][dStr] = d;
        }
      }
    }));
  }
  const ctx = { cfg, userCache, deptCache, shiftCache, offDayCache, goOutCache, dailyCache, tenantId };
  const computedItems = await Promise.all(
    rows
      .filter((r) => r.checkOut)
      .map((r) => computeRecord(r, ctx))
  );
  for (const x of computedItems) {
    if (x?.template) continue;
    items.push(x);
  }
  const byDay = {};
  for (const it of items) {
    if (!byDay[it.date]) byDay[it.date] = { date: it.date, regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, privateGoOutMinutes: 0, workGoOutMinutes: 0, items: [] };
    byDay[it.date].regularMinutes += it.regularMinutes;
    byDay[it.date].overtimeMinutes += it.overtimeMinutes;
    byDay[it.date].nightMinutes += it.nightMinutes;
    byDay[it.date].privateGoOutMinutes += it.privateGoOutMinutes || 0;
    byDay[it.date].workGoOutMinutes += it.workGoOutMinutes || 0;
    byDay[it.date].items.push(it);
  }
  const days = Object.values(byDay);
  const total = days.reduce((acc, d) => {
    acc.regularMinutes += d.regularMinutes;
    acc.overtimeMinutes += d.overtimeMinutes;
    acc.nightMinutes += d.nightMinutes;
    acc.privateGoOutMinutes += d.privateGoOutMinutes;
    acc.workGoOutMinutes += d.workGoOutMinutes;
    return acc;
  }, { regularMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, privateGoOutMinutes: 0, workGoOutMinutes: 0 });
  return { days, total };
}

module.exports = { computeRecord, computeRange, CoreRules };
