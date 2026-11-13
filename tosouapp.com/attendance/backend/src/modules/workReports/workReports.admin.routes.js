const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { rateLimit, rateLimitNamed } = require('../../core/middleware/rateLimit');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
const repo = require('./workReports.repository');
const attendanceRepo = require('../attendance/attendance.repository');
const auditRepo = require('../audit/audit.repository');
const calendarRepo = require('../calendar/calendar.repository');
const db = require('../../core/database/mysql');
const { classifyMonthlyDay } = require('../attendance/attendance.classifier');
const { getDepartmentOffDaySet, isHolidayWorkDay, suppressHolidayWorkLateEarly } = require('../attendance/attendance.utils');

const s3Service = require('../../core/services/s3.service');
const { buildXlsx, buildXlsxBook } = require('../attendance/attendance.controller');

// シフト申請の休暇種別 → 勤務区分（簡易登録・月次勤怠と同じ対応）
const SHIFT_LEAVE_KUBUN = {
  paid: '有給休暇',
  paid_half: '半休(有給)',
  half: '半休',
  unpaid: '欠勤',
  substitute: '代替休日',
  special: '無給休暇'
};
const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isYM = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const monthJST = () => todayJST().slice(0, 7);
const weekdayJa = (dateStr) => {
  const s = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return labels[idx] || '';
};
const monthRange = (month) => {
  const [y, m] = String(month).split('-').map(n => parseInt(n, 10));
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
};
const pickNonEmptyText = (...vals) => {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return null;
};

const roleScopeSql = (req, alias = 'u') => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'manager') return ` AND ${alias}.role = 'employee'`;
  return ` AND ${alias}.role NOT IN ('admin','manager','sysadmin','owner')`;
};

const canManagerAccessUser = async (req, userId) => {
  const [[u]] = await db.query(`SELECT id, role, tenant_id FROM users WHERE id = ? LIMIT 1`, [Number(userId)]);
  if (!u) return false;
  if (req.tenantId != null && String(u.tenant_id) !== String(req.tenantId)) return false;
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'manager') return true;
  return String(u.role || '').toLowerCase() === 'employee';
};

const _logAudit = (req, action, beforeData, afterData) => {
  auditRepo.writeLog({
    userId: req.user?.id,
    tenantId: req.tenantId || null,
    action,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    beforeData: beforeData != null ? JSON.stringify(beforeData) : null,
    afterData: afterData != null ? JSON.stringify(afterData) : null
  }).catch(() => { /* audit ログ失敗で本処理は止めない */ });
};

router.use(authenticate);
router.use(resolveTenant);

router.get('/', authorize('admin', 'manager', 'employee'), async (req, res) => {
  try {
    const date = isISODate(req.query?.date) ? String(req.query.date) : todayJST();
    res.status(200).json(await buildDailyRoster(req, date));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 勤怠記録（日別）の一覧。画面（GET /）と Excel/PDF 出力（/export-daily）で同じものを使う
async function buildDailyRoster(req, date) {
  {

    const [dY] = date.split('-').map(n => parseInt(n, 10));

    const [rows] = await db.query(`
      SELECT
        u.id AS userId,
        u.employee_code AS employeeCode,
        u.username AS username,
        u.departmentId AS departmentId,
        d.name AS departmentName,
        u.branch_id AS branchId,
        br.name AS branchName,
        u.role AS role,
        u.employment_type AS employment_type,
        u.is_flex AS is_flex,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM leave_requests lr
            WHERE lr.userId = u.id
              AND lr.status = 'approved'
              -- 半休 (paid_half / half) は終日の休暇ではない（半日は出勤する）
              AND lr.type NOT IN ('paid_half', 'half')
              AND ? BETWEEN lr.startDate AND lr.endDate
          ) THEN 1 ELSE 0
        END AS has_approved_leave,
        sr.status AS shift_status,
        sr.leaveType AS shift_leave_type,
        sms.status AS shift_month_status,
        a.id AS attendanceId,
        a.checkIn AS checkIn,
        a.checkOut AS checkOut,
        a.open_count AS open_count,
        ax.extra_times AS extra_times,
        ax.extra_rows AS extra_rows,
        COALESCE(ad.work_type, wr.work_type, a.work_type) AS work_type,
        ad.kubun AS daily_kubun,
        COALESCE(NULLIF(TRIM(a.location), ''), NULLIF(TRIM(ad.location), ''), NULLIF(TRIM(wr.site), '')) AS site,
        COALESCE(NULLIF(TRIM(a.memo), ''), NULLIF(TRIM(ad.memo), ''), NULLIF(TRIM(wr.work), '')) AS work,
        ad.late_minutes,
        ad.early_minutes,
        ad.reason,
        ad.notes,
        wr.updated_at AS updated_at
      FROM users u
      LEFT JOIN departments d
        ON d.id = u.departmentId
      LEFT JOIN branches br
        ON br.id = u.branch_id
      LEFT JOIN attendance_daily ad
        ON ad.userId = u.id
       AND ad.date = ?
      LEFT JOIN shift_requests sr
        ON sr.userId = u.id
       AND sr.date = ?
      LEFT JOIN shift_month_status sms
        ON sms.userId = u.id
       AND sms.month = ?
      LEFT JOIN (
        -- その日の1行目（出勤の早い行）。2行目以降（追加勤務）は下の ax で別に出す
        SELECT userId, id, checkIn, checkOut, location, memo, work_type, open_count
        FROM (
          SELECT userId, id, checkIn, checkOut, location, memo, work_type,
                 ROW_NUMBER() OVER (PARTITION BY userId ORDER BY COALESCE(checkIn, checkOut) ASC, id ASC) AS rn,
                 SUM(CASE WHEN checkIn IS NOT NULL AND checkOut IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY userId) AS open_count
          FROM attendance
          WHERE DATE(COALESCE(checkIn, checkOut)) = ?
        ) segs
        WHERE rn = 1
      ) a ON a.userId = u.id
      LEFT JOIN (
        SELECT userId,
               GROUP_CONCAT(CONCAT(COALESCE(DATE_FORMAT(checkIn, '%H:%i'), '—'), '〜', COALESCE(DATE_FORMAT(checkOut, '%H:%i'), ''), '|', COALESCE(extra_reason, ''))
                            ORDER BY COALESCE(checkIn, checkOut) SEPARATOR ' / ') AS extra_times,
               JSON_ARRAYAGG(JSON_OBJECT('sortKey', COALESCE(checkIn, checkOut),
                 'in', DATE_FORMAT(checkIn, '%H:%i'), 'out', DATE_FORMAT(checkOut, '%H:%i'),
                 'reason', extra_reason, 'work', memo, 'notes', notes)) AS extra_rows
        FROM (
          SELECT userId, checkIn, checkOut, extra_reason, memo, notes,
                 ROW_NUMBER() OVER (PARTITION BY userId ORDER BY COALESCE(checkIn, checkOut) ASC, id ASC) AS rn
          FROM attendance
          WHERE DATE(COALESCE(checkIn, checkOut)) = ?
        ) xs
        WHERE rn > 1
        GROUP BY userId
      ) ax ON ax.userId = u.id
      LEFT JOIN (
        SELECT userId, work_type, site, work, updated_at
        FROM (
          SELECT userId, work_type, site, work, updated_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY userId
                   ORDER BY (CASE WHEN (site IS NOT NULL AND site <> '') OR (work IS NOT NULL AND work <> '') THEN 1 ELSE 0 END) DESC,
                            updated_at DESC
                 ) AS rn
          FROM work_reports
          WHERE date = ?
        ) ranked
        WHERE rn = 1
      ) wr ON wr.userId = u.id
      WHERE u.employment_status = 'active'
        ${roleScopeSql(req, 'u')}
        ${req.tenantId ? `AND u.tenant_id = ${parseInt(String(req.tenantId), 10)}` : ''}
      ORDER BY
        CASE WHEN a.checkIn IS NULL THEN 1 ELSE 0 END ASC,
        COALESCE(u.employee_code, '') ASC,
        u.id ASC,
        a.checkIn ASC
    `, [date, date, date, date.slice(0, 7), date, date, date]);

    // Per-department off-day logic — tra department_holidays thật của từng công ty,
    // không hardcode tên bộ phận "工事部" nữa (đã thay bằng cấu hình 休日設定 theo tenant).
    const distinctDeptNames = Array.from(new Set((rows || []).map(r => r.departmentName || '')));
    const isOffTodayByDept = new Map();
    await Promise.all(distinctDeptNames.map(async (deptName) => {
      const off = await getDepartmentOffDaySet(dY, { departmentName: deptName || null, tenantId: req.tenantId || 0 });
      isOffTodayByDept.set(deptName, off.has(date));
    }));
    const isOffForUser = (deptName) => isOffTodayByDept.get(deptName || '') || false;

    const items = (rows || []).map(r => {
      const hasIn = !!r.checkIn;
      // 追加勤務の行がまだ退勤前なら 勤務中 として扱う
      const hasOut = !!r.checkOut && !Number(r.open_count || 0);
      let kubun = String(r.daily_kubun || '').trim();
      if (kubun === '休み') kubun = '休日';
      if (kubun === '半休（有給）') kubun = '半休(有給)';
      // 区分が未保存なら、シフト申請の休暇（有給・半休(有給) など）を使う
      // （シフトが差戻しされた月の休暇は承認されていないので使わない）
      if (!kubun && r.shift_status === 'LEAVE' && r.shift_month_status !== 'REJECTED') kubun = SHIFT_LEAVE_KUBUN[String(r.shift_leave_type || '')] || '';
      const offKubun = new Set(['休日', '代替休日']);
      const leaveKubun = new Set(['有給休暇', '無給休暇', '欠勤']);
      const workKubun = new Set(['出勤', '休日出勤', '代替出勤', '半休', '半休(有給)']);
      // 半休: 午前・午後どちらに出勤してもよいので 遅刻・早退 にしない
      const isHalfDay = kubun === '半休' || kubun === '半休(有給)';
      // フレックス勤務の社員は 遅刻・早退 にしない（社員管理で設定）
      const isFlex = Number(r.is_flex || 0) === 1;
      const isOff = isOffForUser(r.departmentName);
      // 休日出勤日の遅刻・早退は出さない (月次勤怠入力画面と同じ。DBは変更しない)
      const isHolidayWork = isHolidayWorkDay({ kubun, isOffDay: isOff, employmentType: r.employment_type });
      const dayIsOff = offKubun.has(kubun) || (!workKubun.has(kubun) && isOff);
      const forceLeave = leaveKubun.has(kubun) || Number(r.has_approved_leave || 0) === 1;
      const isAbsence = kubun === '欠勤';
      
      // Determine if they were supposed to work (planned)
      const isPlannedToWork = !isOff || workKubun.has(kubun);
      
      let status;
      if (forceLeave && !isAbsence) {
        status = 'leave';
      } else if (isAbsence) {
        status = 'absence';
      } else if (offKubun.has(kubun)) {
        // Kubun explicitly set to holiday (代替休日, 休日) — treat as leave regardless of punch data
        status = 'leave';
      } else if (hasIn || hasOut) {
        status = hasOut ? (dayIsOff ? 'holiday_work' : 'checked_out') : (dayIsOff ? 'holiday_working' : 'working');
      } else if (isHalfDay) {
        // 半休でまだ打刻なし → 未出勤 ではなく 半休 として表示（午後から出勤することもある）
        status = 'leave';
      } else if (dayIsOff && !forceLeave && kubun === '休日' && r.employment_type === 'part_time') {
        status = 'leave'; // explicitly 休日
      } else if (dayIsOff && r.employment_type !== 'part_time') {
        status = 'leave'; // Not expected to work, didn't work
      } else if (isPlannedToWork && r.employment_type === 'full_time') {
        // Seishain expected to work but didn't punch in
        status = 'not_checked_in';
      } else if (r.employment_type === 'part_time') {
        // Part-time without shift registration and no checkin → treat as off day
        console.log('[DEBUG-PT] user', r.employeeCode, 'part_time → status=leave');
        status = 'leave';
      } else {
        // Fallback for others
        status = 'not_checked_in';
      }
      // Normalize display kubun for off-days even when daily record is empty.
      let effectiveKubun = kubun || (forceLeave ? '有給休暇' : (dayIsOff && r.employment_type !== 'part_time' ? '休日' : ''));
      if (r.employment_type === 'part_time' && kubun === '休日') effectiveKubun = '休日';
      if (kubun === '欠勤') effectiveKubun = '欠勤';
      if (r.employment_type === 'part_time' && !kubun) effectiveKubun = '休日';
      // Part-time: off-day work is same rate as weekday — show 出勤 not 休日出勤
      if (r.employment_type === 'part_time' && effectiveKubun === '休日出勤') effectiveKubun = '出勤';
      if (effectiveKubun === '休日出勤' && !hasIn && !hasOut) effectiveKubun = '休日';
      const hasReport = !!(r.site || r.work);
      const wt = r.work_type || null;
      let kubunOut = effectiveKubun;
      if (kubunOut === '休日出勤' && !hasIn && !hasOut && !hasReport) kubunOut = '休日';
      // Part-time: if no kubun saved and has checkin, show 出勤
      if (r.employment_type === 'part_time' && !kubunOut && (hasIn || hasOut)) kubunOut = '出勤';
      return {
        userId: r.userId,
        employeeCode: r.employeeCode || null,
        username: r.username || null,
        departmentId: r.departmentId || null,
        departmentName: r.departmentName || null,
        branchId: r.branchId || null,
        branchName: r.branchName || null,
        role: r.role || null,
        employment_type: r.employment_type || null,
        attendance: {
          id: r.attendanceId || null,
          checkIn: r.checkIn || null,
          checkOut: r.checkOut || null
        },
        // 2行目以降（追加勤務）の時刻。例 "19:00〜22:00"（複数は " / " 区切り）
        extraTimes: r.extra_times || null,
        // 追加勤務の行（出勤の早い順）: [{ in, out, reason, work, notes }]
        extraRows: (() => {
          try {
            const arr = typeof r.extra_rows === 'string' ? JSON.parse(r.extra_rows) : (Array.isArray(r.extra_rows) ? r.extra_rows : []);
            return arr.sort((a, b) => String(a.sortKey || '').localeCompare(String(b.sortKey || '')))
              .map(x => ({ in: x.in || '', out: x.out || '', reason: x.reason || '', work: x.work || '', notes: x.notes || '' }));
          } catch (e) { return []; }
        })(),
        status,
        dailyKubun: kubunOut || null,
        // 終日の休暇（有給・無給・欠勤）なのに打刻がある → 管理画面で要確認
        kubunConflict: leaveKubun.has(kubun) && (hasIn || hasOut),
        lateMinutes: (isHolidayWork || isHalfDay || isFlex) ? 0 : (r.late_minutes || 0),
        earlyMinutes: (isHolidayWork || isHalfDay || isFlex) ? 0 : (r.early_minutes || 0),
        isFlex,
        reason: r.reason || null,
        notes: r.notes || null,
        workType: wt,
        report: hasReport ? {
          workType: wt,
          site: r.site,
          work: r.work,
          updatedAt: r.updated_at || null
        } : null
      };
    });

    // 管理者・マネージャーが打刻編集した社員に ✎（説明文はマウスを乗せたとき・Excel/PDF の注記）
    try {
      const punchEdit = require('../attendance/attendance.punchEdit');
      const edits = await punchEdit.editedMap({ tenantId: req.tenantId ?? null, from: date, to: date });
      for (const it of items) {
        const list = edits.get(`${it.userId}|${date}`);
        if (!list || !list.length) continue;
        it.punchEdits = punchEdit.describeEdits(list);
        it.editedIn = list.some(e => ['edit_in', 'void_row', 'add'].includes(e.action));
        it.editedOut = list.some(e => e.action !== 'edit_in');
      }
    } catch (e) { /* ✎ が出ないだけ */ }

    const requiredItems = items.filter(i => i.status === 'checked_out');
    const required = requiredItems.length;
    const submitted = requiredItems.filter(i => !!i.report).length;
    const missing = requiredItems.filter(i => !i.report).length;
    
    return { date, summary: { submitted, required, missing }, items };
  }
}
router.buildDailyRoster = buildDailyRoster;

router.post('/backfill-worktype',
  rateLimitNamed('workreports_backfill_worktype', { windowMs: 60_000, max: 10 }),
  authorize('admin', 'manager'),
  async (req, res) => {
  try {
    const date = isISODate(req.body?.date) ? String(req.body.date) : todayJST();
    const wtRaw = String(req.body?.workType || req.body?.work_type || 'onsite').trim();
    const workType = wtRaw === 'onsite' || wtRaw === 'remote' || wtRaw === 'satellite' ? wtRaw : 'onsite';
    const [r] = await db.query(
      `UPDATE attendance
       SET work_type = ?
       WHERE DATE(checkIn) = ?
         AND checkIn IS NOT NULL
         AND (work_type IS NULL OR work_type = '')`,
      [workType, date]
    );
    res.status(200).json({ date, workType, updated: Number(r?.affectedRows || 0) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Export routes (extracted to workReports.export.routes.js) ──────────────
router.use('/', require('./workReports.export.routes'));

router.get('/month', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const { start, end } = monthRange(month);
    const closed = await repo.isMonthClosed(month, req.tenantId).catch(() => false);
    const reqSort = req.query.sort || 'dateDesc';
    const reqDept = req.query.dept || '';
    const reqQ = req.query.q || '';
    const reqGroup = req.query.group === '1';

    // Same sorting/filtering logic as the frontend
    const normalize = (s) => String(s || '').trim().toLowerCase();
    const cmpStr = (a, b) => {
      const aa = normalize(a);
      const bb = normalize(b);
      if (aa === bb) return 0;
      return aa < bb ? -1 : 1;
    };
    const statusRank = (st) => {
      if (st === 'checkout_missing') return 0;
      if (st === 'missing') return 0;
      if (st === 'checkout_missing_submitted') return 1;
      if (st === 'monthly_input_only') return 1;
      if (st === 'working') return 1;
      if (st === 'submitted') return 2;
      return 3;
    };

    const filterAndSort = (items) => {
      const dept = normalize(reqDept);
      const q = normalize(reqQ);
      let out = Array.isArray(items) ? items.slice() : [];
      if (dept) {
        out = out.filter(x => normalize(x?.departmentName) === dept);
      }
      if (q) {
        out = out.filter(x => {
          const code = normalize(x?.employeeCode);
          const name = normalize(x?.username);
          return (code && code.includes(q)) || (name && name.includes(q));
        });
      }
      out.sort((a, b) => {
        if (reqSort === 'employee') {
          const c1 = cmpStr(a?.employeeCode, b?.employeeCode);
          if (c1) return c1;
          const d1 = cmpStr(b?.date, a?.date);
          if (d1) return d1;
          return Number(a?.userId || 0) - Number(b?.userId || 0);
        }
        if (reqSort === 'name') {
          const n1 = cmpStr(a?.username, b?.username);
          if (n1) return n1;
          const c1 = cmpStr(a?.employeeCode, b?.employeeCode);
          if (c1) return c1;
          const d1 = cmpStr(b?.date, a?.date);
          if (d1) return d1;
          return Number(a?.userId || 0) - Number(b?.userId || 0);
        }
        if (reqSort === 'department') {
          const dep = cmpStr(a?.departmentName, b?.departmentName);
          if (dep) return dep;
          const c1 = cmpStr(a?.employeeCode, b?.employeeCode);
          if (c1) return c1;
          const d1 = cmpStr(b?.date, a?.date);
          if (d1) return d1;
          return Number(a?.userId || 0) - Number(b?.userId || 0);
        }
        if (reqSort === 'missingFirst') {
          const r1 = statusRank(a?.status) - statusRank(b?.status);
          if (r1) return r1;
          const d1 = cmpStr(b?.date, a?.date);
          if (d1) return d1;
          const c1 = cmpStr(a?.employeeCode, b?.employeeCode);
          if (c1) return c1;
          return Number(a?.userId || 0) - Number(b?.userId || 0);
        }
        const d1 = cmpStr(b?.date, a?.date);
        if (d1) return d1;
        const c1 = cmpStr(a?.employeeCode, b?.employeeCode);
        if (c1) return c1;
        return Number(a?.userId || 0) - Number(b?.userId || 0);
      });
      return out;
    };

    // カレンダーの休日（祝日/土日）を取得して判定に利用
    let isOffDate = (ds) => false;
    try {
      const y = parseInt(String(month).slice(0, 4), 10);
      const cal = await calendarRepo.computeYear(y, req.tenantId || 0).catch(() => null);
      const off = new Set((cal?.off_days || []).map((d) => String(d).slice(0, 10)));
      isOffDate = (ds) => off.has(String(ds).slice(0, 10));
    } catch (e) { /* silently ignored */ }

    const [users] = await db.query(`
      SELECT u.id AS userId, u.employee_code AS employeeCode, u.username AS username,
             u.departmentId AS departmentId, d.name AS departmentName,
             u.branch_id AS branchId, br.name AS branchName,
             u.role AS role, u.employment_type AS employment_type
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      LEFT JOIN branches br ON br.id = u.branch_id
      WHERE u.employment_status = 'active'
        ${roleScopeSql(req, 'u')}
        ${req.tenantId ? `AND u.tenant_id = ${parseInt(String(req.tenantId), 10)}` : ''}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC
    `);

    // Load shift definitions to compute planned work/off per user per day
    let shiftDefs = [];
    try {
      shiftDefs = await attendanceRepo.listShiftDefinitions();
    } catch { shiftDefs = []; }
    const shiftById = new Map();
    const shiftByName = new Map();
    for (const s of shiftDefs || []) {
      if (s?.id != null) shiftById.set(Number(s.id), s);
      if (s?.name) shiftByName.set(String(s.name), s);
    }
    const parseWorkingDays = (s) => {
      const t = String(s || '').toLowerCase();
      if (!t || t === 'flexible') return new Set([1,2,3,4,5]); // default Mon-Fri
      if (t.includes('mon-fri-sat') || t.includes('mon-sat')) return new Set([1,2,3,4,5,6]);
      if (t.includes('mon-fri')) return new Set([1,2,3,4,5]);
      if (t.includes('mon-sun') || t.includes('7') || t.includes('all')) return new Set([0,1,2,3,4,5,6]);
      const map = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
      const out = new Set();
      for (const part of t.split(/[^a-z]+/g)) {
        if (map.hasOwnProperty(part)) out.add(map[part]);
      }
      if (out.size === 0) return new Set([1,2,3,4,5]);
      return out;
    };
    const ymToDow = (ds) => {
      const y = parseInt(String(ds).slice(0,4), 10);
      const m = parseInt(String(ds).slice(5,7), 10) - 1;
      const d = parseInt(String(ds).slice(8,10), 10);
      return new Date(Date.UTC(y, m, d, 0, 0, 0)).getUTCDay();
    };
    const getPlanFor = (assignList, ds) => {
      if (!Array.isArray(assignList) || !assignList.length) return isOffDate(ds) ? 'off' : 'work';
      // pick latest assignment effective by ds
      const eff = assignList.filter(a => {
        const st = String(a.start_date || a.date || '').slice(0,10);
        const ed = a.end_date ? String(a.end_date).slice(0,10) : null;
        return st && st <= ds && (!ed || ds <= ed);
      }).slice(-1)[0];
      if (!eff) return isOffDate(ds) ? 'off' : 'work';
      let def = null;
      if (eff.shiftId != null) def = shiftById.get(Number(eff.shiftId)) || null;
      if (!def && eff.shift) def = shiftByName.get(String(eff.shift)) || null;
      const set = parseWorkingDays(def?.working_days);
      const dow = ymToDow(ds);
      return set.has(dow) ? 'work' : 'off';
    };

    // ── Tenant isolation: chỉ lấy dữ liệu của nhân viên thuộc tenant hiện tại ──
    // Lọc theo chủ sở hữu (userId IN users của tenant) để không rò rỉ chấm công chéo công ty.
    const _tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
    const tenantUserClause = _tid ? ' AND userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';
    const tenantUserClauseA = _tid ? ' AND a.userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';

    let latestRows = [];
    try {
      const [x] = await db.query(`
        SELECT a.id, a.userId, a.checkIn, a.checkOut, a.location, a.memo, a.work_type
        FROM attendance a
        WHERE (
            (a.checkIn >= ? AND a.checkIn < DATE_ADD(?, INTERVAL 1 DAY))
            OR (a.checkIn IS NULL AND a.checkOut >= ? AND a.checkOut < DATE_ADD(?, INTERVAL 1 DAY))
          )
          AND a.userId IN (
            SELECT id
            FROM users
            WHERE employment_status = 'active'
              ${String(req.user?.role || '').toLowerCase() === 'manager' ? "AND role = 'employee'" : "AND role IN ('employee','manager')"}
              ${_tid ? 'AND tenant_id = ?' : ''}
          )
      `, [start + ' 00:00:00', end + ' 00:00:00', start + ' 00:00:00', end + ' 00:00:00', ...(_tid ? [_tid] : [])]);
      latestRows = x;
    } catch {
      try {
        const [attRows] = await db.query(`
          SELECT id, userId, checkIn, checkOut, location, memo, work_type
          FROM attendance
          WHERE (
              (checkIn >= ? AND checkIn < DATE_ADD(?, INTERVAL 1 DAY))
              OR (checkIn IS NULL AND checkOut >= ? AND checkOut < DATE_ADD(?, INTERVAL 1 DAY))
            )
            AND userId IN (
              SELECT id
              FROM users
              WHERE employment_status = 'active'
                ${String(req.user?.role || '').toLowerCase() === 'manager' ? "AND role = 'employee'" : "AND role IN ('employee','manager')"}
                ${_tid ? 'AND tenant_id = ?' : ''}
            )
        `, [start + ' 00:00:00', end + ' 00:00:00', start + ' 00:00:00', end + ' 00:00:00', ...(_tid ? [_tid] : [])]);
        latestRows = attRows;
      } catch (e) { /* silently ignored */ }
    }

    const [leaveRows] = await db.query(`
      SELECT userId, startDate, endDate
      FROM leave_requests
      WHERE status = 'approved'
        AND endDate >= ? AND startDate <= ?${tenantUserClause}
    `, [start, end, ...(_tid ? [_tid] : [])]);

    const [dailyRows] = await db.query(`
      SELECT userId, date, kubun
      FROM attendance_daily
      WHERE date >= ? AND date <= ?${tenantUserClause}
    `, [start, end, ...(_tid ? [_tid] : [])]);

    const reports = await repo.listByMonth(month);
    const reportMap = new Map();
    for (const r of (reports || [])) {
      reportMap.set(`${r.userId}|${String(r.date).slice(0, 10)}`, r);
    }

    const [attConcatRows] = await db.query(`
      SELECT userId, DATE(COALESCE(checkIn, checkOut)) AS date,
             GROUP_CONCAT(COALESCE(DATE_FORMAT(checkIn, '%H:%i'), '—') ORDER BY checkIn ASC SEPARATOR ' / ') AS allCheckIns,
             GROUP_CONCAT(COALESCE(DATE_FORMAT(checkOut, '%H:%i'), '—') ORDER BY checkIn ASC SEPARATOR ' / ') AS allCheckOuts,
             GROUP_CONCAT(NULLIF(TRIM(location), '') ORDER BY checkIn ASC SEPARATOR ' / ') AS site,
             GROUP_CONCAT(NULLIF(TRIM(memo), '') ORDER BY checkIn ASC SEPARATOR ' / ') AS work
      FROM attendance
      WHERE DATE(COALESCE(checkIn, checkOut)) >= ? AND DATE(COALESCE(checkIn, checkOut)) <= ?${tenantUserClause}
      GROUP BY userId, DATE(COALESCE(checkIn, checkOut))
    `, [start, end, ...(_tid ? [_tid] : [])]);
    const attConcatMap = new Map();
    for (const r of (attConcatRows || [])) {
      attConcatMap.set(`${r.userId}|${String(r.date).slice(0, 10)}`, r);
    }

    const leaveByUser = new Map();
    for (const lr of (leaveRows || [])) {
      const uid = Number(lr.userId);
      if (!leaveByUser.has(uid)) leaveByUser.set(uid, []);
      leaveByUser.get(uid).push({ start: String(lr.startDate).slice(0, 10), end: String(lr.endDate).slice(0, 10) });
    }
    const isOnLeave = (uid, date) => {
      const arr = leaveByUser.get(uid);
      if (!arr || !arr.length) return false;
      for (const it of arr) {
        if (date >= it.start && date <= it.end) return true;
      }
      return false;
    };
    const dailyByUserDate = new Map();
    for (const r of (dailyRows || [])) {
      const key = `${r.userId}|${String(r.date).slice(0,10)}`;
      dailyByUserDate.set(key, String(r.kubun || '').trim());
    }

    const attLatest = new Map();
    const userAttendanceMap = new Map();
    for (const a of (latestRows || [])) {
      const d = String(a.checkIn || a.checkOut || '').slice(0, 10);
      const key = `${a.userId}|${d}`;
      
      if (!userAttendanceMap.has(key)) userAttendanceMap.set(key, []);
      userAttendanceMap.get(key).push(a);
      
      const prev = attLatest.get(key);
      if (!prev) {
        // Clone the object so we can modify it
        const cloned = { ...a };
        // Get the concatenated location and memo for this user/date
        const concatData = attConcatMap.get(key);
        if (concatData) {
           cloned.location = concatData.site;
           cloned.memo = concatData.work;
        }
        attLatest.set(key, cloned);
        continue;
      }
      const prevHasOut = !!prev.checkOut;
      const curHasOut = !!a.checkOut;
      if (!prevHasOut && curHasOut) {
        const cloned = { ...a };
        const concatData = attConcatMap.get(key);
        if (concatData) { cloned.location = concatData.site; cloned.memo = concatData.work; }
        attLatest.set(key, cloned);
        continue;
      }
      if (prevHasOut && curHasOut) {
        if (String(a.checkOut) > String(prev.checkOut)) {
           const cloned = { ...a };
           const concatData = attConcatMap.get(key);
           if (concatData) { cloned.location = concatData.site; cloned.memo = concatData.work; }
           attLatest.set(key, cloned);
        }
        continue;
      }
      if (!prevHasOut && !curHasOut) {
        if (String(a.checkIn) > String(prev.checkIn)) {
           const cloned = { ...a };
           const concatData = attConcatMap.get(key);
           if (concatData) { cloned.location = concatData.site; cloned.memo = concatData.work; }
           attLatest.set(key, cloned);
        }
        continue;
      }
    }

    const daysInMonth = (() => {
      const out = [];
      const d0 = new Date(start + 'T00:00:00Z');
      const d1 = new Date(end + 'T00:00:00Z');
      for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 60 * 60 * 1000) {
        out.push(new Date(t).toISOString().slice(0, 10));
      }
      return out;
    })();

    let requiredTotal = 0;
    let submittedTotal = 0;
    let missingTotal = 0;

    const items = [];
    for (const u of (users || [])) {
      const uid = Number(u.userId);
      const perDay = {};
      // load assignments for this user once
      let assigns = [];
      try { assigns = await attendanceRepo.listShiftAssignmentsBetween(uid, start, end); } catch { assigns = []; }
      for (const d of daysInMonth) {
        const kubun = dailyByUserDate.get(`${uid}|${d}`) || '';
        const a = attLatest.get(`${uid}|${d}`) || null;
        const plan = getPlanFor(assigns, d);
        const cls = classifyMonthlyDay({
          date: d,
          kubun,
          isOnLeaveApproved: isOnLeave(uid, d),
          isPlannedOff: plan === 'off',
          hasAttendance: !!a,
          hasCheckOut: !!a?.checkOut
        });
        const status = cls.status;
        const rep = reportMap.get(`${uid}|${d}`) || null;
        const attConcat = attConcatMap.get(`${uid}|${d}`) || null;
        const attLatestRow = attLatest.get(`${uid}|${d}`) || null;
        
        // combine work_reports and attendance notes
        const combinedSite = attConcat?.site || attLatestRow?.location || rep?.site || null;
        const combinedWork = attConcat?.work || attLatestRow?.memo || rep?.work || null;
        
        const report = (combinedSite || combinedWork) ? { site: combinedSite, work: combinedWork, updatedAt: rep?.updated_at || rep?.updatedAt || null } : null;
        
        // Use allCheckIns if available, else latestRow
        const attendanceInfo = attLatestRow ? {
          id: attLatestRow.id,
          checkIn: attConcat?.allCheckIns || attLatestRow.checkIn,
          checkOut: attConcat?.allCheckOuts || attLatestRow.checkOut
        } : null;

        const entry = { status, report, attendance: attendanceInfo, kubun: cls.kubun || kubun || null, plan: status === 'planned' ? cls.plan : null };
        if (req.query.debug === '1') entry.debug = { date: d, userId: uid, kubun, plan, isOffDate: isOffDate(d), hasAttendance: !!a, hasOut: !!a?.checkOut, status };
      perDay[d] = entry;
      if (status === 'checked_out') {
        requiredTotal++;
        if (report) submittedTotal++;
        else missingTotal++;
      }
    }
    
    // We only push to items if we're grouping, otherwise we flatten
    if (reqGroup) {
      items.push({
        userId: uid,
        employeeCode: u.employeeCode || null,
        username: u.username || null,
        departmentId: u.departmentId || null,
        departmentName: u.departmentName || null,
        branchId: u.branchId || null,
        branchName: u.branchName || null,
        days: perDay
      });
    } else {
      for (const d of daysInMonth) {
        const entry = perDay[d];
        if (entry.status !== 'checked_out' && entry.status !== 'working' && entry.status !== 'holiday_work' && entry.status !== 'holiday_working') continue;
        
        const a = attLatest.get(`${uid}|${d}`) || null;
        const daily = dailyByUserDate.get(`${uid}|${d}`) || null;

        const hasOut = !!a?.checkOut;
        const hasContent = !!(String(entry.report?.site || '').trim() || String(entry.report?.work || '').trim());
        let effectiveStatusStr = entry.status;
        if (entry.status === 'checked_out') {
          effectiveStatusStr = hasContent ? 'submitted' : 'missing';
        } else if (entry.status === 'working') {
           if (d < todayJST() && !hasOut) {
             effectiveStatusStr = hasContent ? 'checkout_missing_submitted' : 'checkout_missing';
           }
        }
        
        const attConcat = attConcatMap.get(`${uid}|${d}`) || null;

        // Fetch all individual rows instead of relying on attConcatMap to separate them out
        const attRows = userAttendanceMap.get(`${uid}|${d}`) || [];
        
        if (attRows.length === 0) {
           // Original fallback when no attendance but there is an entry
           items.push({
             userId: uid,
             employeeCode: u.employeeCode || null,
             username: u.username || null,
             departmentId: u.departmentId || null,
             departmentName: u.departmentName || null,
             branchId: u.branchId || null,
             branchName: u.branchName || null,
             date: d,
             weekday: weekdayJa(d),
             attendance: { checkIn: null, checkOut: null },
             kubun: entry.kubun || null,
             workType: null,
             holiday: isOffDate(d) || entry.kubun === '休日' || entry.kubun === '所定休日',
             site: entry.report?.site || null,
             work: entry.report?.work || null,
             status: effectiveStatusStr
           });
        } else {
           // For each attendance record on this day, add a separate row
           for (const row of attRows) {
             items.push({
               userId: uid,
               employeeCode: u.employeeCode || null,
               username: u.username || null,
               departmentId: u.departmentId || null,
               departmentName: u.departmentName || null,
               branchId: u.branchId || null,
               branchName: u.branchName || null,
               date: d,
               weekday: weekdayJa(d),
               attendance: { checkIn: row.checkIn, checkOut: row.checkOut },
               kubun: entry.kubun || null,
               workType: row.work_type || null,
               holiday: isOffDate(d) || entry.kubun === '休日' || entry.kubun === '所定休日',
               site: row.location || entry.report?.site || null,
               work: row.memo || entry.report?.work || null,
               status: effectiveStatusStr
             });
           }
        }
      }
    }
  }

  // apply filters before sending response
  let finalItems = items;
  if (!reqGroup) {
    finalItems = filterAndSort(items);
  } else {
    // Basic grouping filter (by dept/search text), we don't sort the group object array deeply here since frontend renders it
    const dept = normalize(reqDept);
    const q = normalize(reqQ);
    if (dept) finalItems = finalItems.filter(x => normalize(x?.departmentName) === dept);
    if (q) {
      finalItems = finalItems.filter(x => {
        const code = normalize(x?.employeeCode);
        const name = normalize(x?.username);
        return (code && code.includes(q)) || (name && name.includes(q));
      });
    }
    if (reqSort === 'employee') {
      finalItems.sort((a,b) => cmpStr(a.employeeCode, b.employeeCode));
    } else if (reqSort === 'name') {
      finalItems.sort((a,b) => cmpStr(a.username, b.username));
    }
  }

  res.status(200).json({
    month,
    closed,
    range: { start, end },
    days: daysInMonth,
    summary: { required: requiredTotal, submitted: submittedTotal, missing: missingTotal },
    items: finalItems
  });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/month/export-table', authorize('admin', 'manager'), async (req, res) => {
  try {
    // Re-use the logic from /month JSON endpoint, but return Excel
    // We'll mock the res.status.json to capture the data and then build Excel from it.
    let responseData = null;
    const mockRes = {
      status: () => mockRes,
      json: (data) => { responseData = data; return mockRes; },
      send: (data) => { responseData = data; return mockRes; }
    };
    
    // Create a mock req with original query but debug off to ensure we get data
    const mockReq = { ...req, query: { ...req.query, debug: '0' }, user: req.user };
    
    // Find the handler for /month/list instead of /month to get all shifts
    const monthHandler = router.stack.find(l => l.route && l.route.path === '/month/list')?.route?.stack[1]?.handle;
    if (!monthHandler) throw new Error('Month handler not found');
    
    await monthHandler(mockReq, mockRes);
    
    if (!responseData || !responseData.items) {
      throw new Error('Failed to generate table data: ' + (responseData ? JSON.stringify(responseData) : 'No response'));
    }

    const fmtHm = (dt) => {
      if (!dt) return '';
      const s = String(dt);
      return s.length >= 16 ? s.slice(11, 16) : s;
    };
    
    const statusMeta = (status) => {
      if (status === 'submitted') return '提出済';
      if (status === 'missing') return '未提出';
      if (status === 'checkout_missing') return '退勤漏れ';
      if (status === 'checkout_missing_submitted') return '退勤漏れ(入力済み)';
      if (status === 'monthly_input_only') return '月次入力済み（打刻なし）';
      if (status === 'off') return '休日';
      if (status === 'paid_leave') return '有給休暇';
      if (status === 'unpaid_leave') return '無給休暇';
      if (status === 'absence') return '欠勤';
      if (status === 'not_punched') return '打刻なし';
      if (status === 'working') return '勤務中';
      return '—';
    };

    const workTypeLabel = (value) => {
      if (value === 'onsite') return '出社';
      if (value === 'remote') return '在宅';
      if (value === 'satellite') return '現場';
      return '—';
    };

    const columns = [
      { header: '日付', width: 12 },
      { header: '曜', width: 6 },
      { header: '社員番号', width: 12 },
      { header: '氏名', width: 14 },
      { header: '部署', width: 22 },
      { header: '支店', width: 22 },
      { header: '勤務区分', width: 12 },
      { header: '出勤', width: 8 },
      { header: '退勤', width: 8 },
      { header: '勤務形態', width: 12 },
      { header: '現場', width: 18 },
      { header: '作業内容', width: 52 },
      { header: '遅刻・早退等', width: 18 },
      { header: '備考', width: 30 },
      { header: '状態', width: 15 }
    ];

    const rows = [];
    const items = responseData.items;
    
    // Helper for late/early reasons
    const getLateEarlyText = (it) => {
      let parts = [];
      const am = it.attendance?.checkIn_memo || it.attendance?.checkInMemo;
      const pm = it.attendance?.checkOut_memo || it.attendance?.checkOutMemo;
      const isLate = it.attendance?.isLate;
      const lateMinutes = it.attendance?.lateMinutes;
      if (isLate) parts.push(`[遅刻] ${lateMinutes || 0}分`);
      if (am) parts.push(`(出) ${am}`);
      if (pm) parts.push(`(退) ${pm}`);
      return parts.join('\n');
    };

    // Flat mode (group=0)
    if (req.query.group !== '1') {
      for (const it of items) {
        const combinedReasonMemo = [it.attendance?.memo, it.attendance?.notes].filter(Boolean).join('\n');
        rows.push({
          cells: [
            it.date,
            it.weekday || '',
            it.employeeCode || '',
            it.username || '',
            it.departmentName || '',
            it.branchName || '',
            it.kubun || '',
            fmtHm(it.attendance?.checkIn),
            fmtHm(it.attendance?.checkOut),
            workTypeLabel(it.workType),
            it.site || '',
            it.work || '',
            getLateEarlyText(it),
            combinedReasonMemo || '',
            statusMeta(it.status)
          ]
        });
      }
    } else {
       // Group mode
       const groups = new Map();
       for (const it of items) {
         const key = `${it.employeeCode || ''}|${it.username || ''}|${it.departmentName || ''}|${it.branchName || ''}`;
         if (!groups.has(key)) groups.set(key, { employeeCode: it.employeeCode, username: it.username, departmentName: it.departmentName, branchName: it.branchName, items: [] });
         groups.get(key).items.push(it);
       }
       for (const g of Array.from(groups.values())) {
          rows.push({
            cells: [ { v: `${g.employeeCode || ''} ${g.username || ''}`, s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' } ]
          });
          for (const it of g.items) {
             const combinedReasonMemo = [it.attendance?.memo, it.attendance?.notes].filter(Boolean).join('\n');
             rows.push({
               cells: [
                 it.date,
                 it.weekday || '',
                 g.employeeCode || '',
                 g.username || '',
                 g.departmentName || '',
                 g.branchName || '',
                 it.kubun || '',
                 fmtHm(it.attendance?.checkIn),
                 fmtHm(it.attendance?.checkOut),
                 workTypeLabel(it.workType),
                 it.site || '',
                 it.work || '',
                 getLateEarlyText(it),
                 combinedReasonMemo || '',
                 statusMeta(it.status)
               ]
             });
          }
       }
    }

    const { buildXlsx } = require('../../utils/xlsx');
    const buf = await buildXlsx({ sheetName: '作業報告一覧', columns, rows });
    
    const fileName = `work_reports_table_${responseData.month}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.status(200).send(buf);

  } catch (err) {
    console.error('Export Table Error:', err);
    res.status(500).json({ message: err.message });
  }
});

router.post('/backfill/daily',
  rateLimitNamed('workreports_backfill_daily', { windowMs: 60_000, max: 10 }),
  authorize('admin', 'manager'),
  async (req, res) => {
  try {
    const { userId, fromDate, toDate, month } = req.body || {};
    const parseMonth = (s) => {
      const m = String(s || '');
      if (!/^\d{4}-\d{2}$/.test(m)) return null;
      const y = parseInt(m.slice(0, 4), 10);
      const mm = parseInt(m.slice(5, 7), 10);
      if (!y || !mm || mm < 1 || mm > 12) return null;
      const pad = (n) => String(n).padStart(2, '0');
      const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
      return { from: `${y}-${pad(mm)}-01`, to: `${y}-${pad(mm)}-${pad(lastDay)}` };
    };
    const range = month ? parseMonth(month) : null;
    const from = String(range ? range.from : fromDate || '').slice(0, 10);
    const to = String(range ? range.to : toDate || '').slice(0, 10);
    if (!from || !to) return res.status(400).json({ message: 'Missing from/to or month' });
    const uid = userId != null ? parseInt(String(userId), 10) : null;
    const params = [];
    let sql = `
      SELECT wr.userId, wr.date, wr.work_type, wr.site, wr.work
      FROM work_reports wr
      WHERE wr.date >= ? AND wr.date <= ?
    `;
    params.push(from, to);
    if (uid) { sql += ` AND wr.userId = ?`; params.push(uid); }
    sql += ` ORDER BY wr.userId ASC, wr.date ASC`;
    const [rows] = await db.query(sql, params);
    let updated = 0;
    let users = new Set();
    for (const r of (rows || [])) {
      const u = Number(r.userId);
      const d = String(r.date).slice(0, 10);
      if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      users.add(u);
      const payload = {
        workType: r.work_type || null,
        location: r.site || null,
        memo: r.work || null
      };
      try {
        const res1 = await attendanceRepo.upsertDaily(u, d, payload);
        updated += Number(res1?.affectedRows || 0);
      } catch (e) { /* silently ignored */ }
    }
    res.status(200).json({ ok: true, users: Array.from(users), from, to, updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/month/list', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const { start, end } = monthRange(month);
    const closed = await repo.isMonthClosed(month, req.tenantId).catch(() => false);
    const today = todayJST();
    const ymDateList = (() => {
      const out = [];
      const d0 = new Date(start + 'T00:00:00Z');
      const d1 = new Date(end + 'T00:00:00Z');
      for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 60 * 60 * 1000) {
        out.push(new Date(t).toISOString().slice(0, 10));
      }
      return out;
    })();
    const years = Array.from(new Set(ymDateList.map(d => parseInt(String(d).slice(0, 4), 10)).filter(Boolean)));

    const leaveTypeToKubun = (type) => {
      const v = String(type || '').toLowerCase();
      if (v === 'paid') return '有給休暇';
      if (v === 'unpaid') return '無給休暇';
      if (v === 'absence') return '欠勤';
      if (v === 'sick') return '欠勤';
      return '休暇';
    };

    const [users] = await db.query(`
      SELECT u.id AS userId,
             u.employee_code AS employeeCode,
             u.username AS username,
             u.shift_id AS shiftId,
             u.departmentId AS departmentId,
             d.name AS departmentName,
             u.branch_id AS branchId,
             br.name AS branchName,
             u.role AS role,
             u.employment_type AS employment_type
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      LEFT JOIN branches br ON br.id = u.branch_id
      WHERE u.employment_status = 'active'
        ${roleScopeSql(req, 'u')}
        ${req.tenantId ? `AND u.tenant_id = ${parseInt(String(req.tenantId), 10)}` : ''}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC
    `);
    const userMap = new Map((users || []).map(u => [Number(u.userId), u]));

    // Per-department off-day logic — tra department_holidays thật của từng công ty,
    // không hardcode tên bộ phận "工事部" nữa (đã thay bằng cấu hình 休日設定 theo tenant).
    const distinctDeptNames = Array.from(new Set((users || []).map(u => u.departmentName || '')));
    const offSetByYearDept = new Map();
    await Promise.all(
      years.flatMap(y => distinctDeptNames.map(async (deptName) => {
        const off = await getDepartmentOffDaySet(y, { departmentName: deptName || null, tenantId: req.tenantId || 0 });
        offSetByYearDept.set(`${y}|${deptName}`, off);
      }))
    );
    const isOffDate = (dateStr, deptName) => {
      const y = parseInt(String(dateStr).slice(0, 4), 10);
      const off = offSetByYearDept.get(`${y}|${deptName || ''}`);
      return off ? off.has(String(dateStr).slice(0, 10)) : false;
    };

    // Fallback checkout time from assigned shift end-time (for monthly-input synchronization view).
    let shiftDefs = [];
    try { shiftDefs = await attendanceRepo.listShiftDefinitions(); } catch { shiftDefs = []; }
    const shiftById = new Map();
    const shiftByName = new Map();
    for (const s of shiftDefs || []) {
      if (s?.id != null) shiftById.set(Number(s.id), s);
      if (s?.name) shiftByName.set(String(s.name), s);
    }
    let assigns = [];
    try {
      const userIds = Array.from(userMap.keys());
      if (userIds.length) {
        const placeholders = userIds.map(() => '?').join(',');
        const [rows] = await db.query(`
          SELECT userId, shiftId, shift, start_date, end_date
          FROM user_shift_assignments
          WHERE userId IN (${placeholders})
            AND start_date <= ?
            AND (end_date IS NULL OR end_date >= ?)
          ORDER BY userId ASC, start_date ASC, id ASC
        `, [...userIds, end, start]);
        assigns = rows || [];
      }
    } catch { assigns = []; }
    const assignByUser = new Map();
    for (const a of assigns) {
      const uid = Number(a.userId || 0);
      if (!uid) continue;
      if (!assignByUser.has(uid)) assignByUser.set(uid, []);
      assignByUser.get(uid).push(a);
    }
    const resolveShiftEndHm = (uid, ds) => {
      const arr = assignByUser.get(Number(uid)) || [];
      let pick = null;
      for (const a of arr) {
        const st = String(a.start_date || '').slice(0, 10);
        const ed = a.end_date ? String(a.end_date).slice(0, 10) : '';
        if (!st || st > ds) continue;
        if (ed && ed < ds) continue;
        pick = a;
      }
      // Fallback 1: user assigned shift end-time
      let def = null;
      if (pick?.shiftId != null) def = shiftById.get(Number(pick.shiftId)) || null;
      if (!def && pick?.shift) def = shiftByName.get(String(pick.shift)) || null;
      const hm = String(def?.end_time || '').trim();
      if (/^\d{2}:\d{2}$/.test(hm)) return hm;
      // Fallback 2: user default shift_id
      const u = userMap.get(Number(uid));
      if (u?.shiftId != null) {
        const d2 = shiftById.get(Number(u.shiftId)) || null;
        const hm2 = String(d2?.end_time || '').trim();
        if (/^\d{2}:\d{2}$/.test(hm2)) return hm2;
      }
      // Fallback 3: default business end time for report sync display
      return '17:00';
    };

    // ── Tenant isolation: chỉ lấy dữ liệu của nhân viên thuộc tenant hiện tại ──
    const _tid2 = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
    const tenantUserClause2 = _tid2 ? ' AND userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';

    const [attRows] = await db.query(`
      SELECT a.userId,
             DATE(COALESCE(a.checkIn, a.checkOut)) AS date,
             a.checkIn AS firstCheckIn,
             a.checkOut AS lastCheckOut,
             a.work_type AS attendanceWorkType,
             a.location AS site,
             a.memo AS work
      FROM attendance a
      WHERE DATE(COALESCE(a.checkIn, a.checkOut)) >= ? AND DATE(COALESCE(a.checkIn, a.checkOut)) <= ?
        AND a.userId IN (
          SELECT id
          FROM users
            WHERE employment_status = 'active'
            ${String(req.user?.role || '').toLowerCase() === 'manager' ? "AND role = 'employee'" : "AND role IN ('employee','manager')"}
            ${_tid2 ? 'AND tenant_id = ?' : ''}
        )
      ORDER BY DATE(COALESCE(a.checkIn, a.checkOut)) ASC, a.userId ASC, a.checkIn ASC
    `, [start, end, ...(_tid2 ? [_tid2] : [])]);

    const [dailyRows] = await db.query(`
      SELECT userId, date, kubun, work_type, location, memo, notes, late_minutes, early_minutes, reason
      FROM attendance_daily
      WHERE date >= ? AND date <= ?${tenantUserClause2}
    `, [start, end, ...(_tid2 ? [_tid2] : [])]);
    // 休日出勤日の遅刻・早退は出さない (月次勤怠入力画面と同じ。DBは変更しない)
    await suppressHolidayWorkLateEarly(dailyRows, _tid2 || 0);
    const dailyMap = new Map();
    for (const r of (dailyRows || [])) {
      dailyMap.set(`${r.userId}|${String(r.date).slice(0, 10)}`, {
        kubun: r.kubun || null,
        workType: r.work_type || null,
        location: r.location || null,
        memo: r.memo || null,
        notes: r.notes || null,
        lateMinutes: r.late_minutes || 0,
        earlyMinutes: r.early_minutes || 0,
        reason: r.reason || ''
      });
    }

    const [leaveRows] = await db.query(`
      SELECT userId, startDate, endDate, type
      FROM leave_requests
      WHERE status = 'approved'
        AND endDate >= ? AND startDate <= ?${tenantUserClause2}
    `, [start, end, ...(_tid2 ? [_tid2] : [])]);
    const leaveByUserDate = new Map();
    for (const r of (leaveRows || [])) {
      const uid = Number(r.userId);
      if (!uid) continue;
      const st = String(r.startDate || '').slice(0, 10);
      const ed = String(r.endDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(st) || !/^\d{4}-\d{2}-\d{2}$/.test(ed)) continue;
      const from = st > start ? st : start;
      const to = ed < end ? ed : end;
      let cur = new Date(from + 'T00:00:00Z');
      const endDt = new Date(to + 'T00:00:00Z');
      while (cur.getTime() <= endDt.getTime()) {
        const ds = cur.toISOString().slice(0, 10);
        const key = `${uid}|${ds}`;
        if (!leaveByUserDate.has(key)) leaveByUserDate.set(key, leaveTypeToKubun(r.type));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    const reports = await repo.listByMonth(month);
    const reportMap = new Map();
    for (const r of (reports || [])) {
      reportMap.set(`${r.userId}|${String(r.date).slice(0, 10)}`, r);
    }

    const workKubun = new Set(['出勤', '休日出勤', '代替出勤', '半休']);
    const holidayKubun = new Set(['休日', '代替休日', '休み']);
    const paidLeaveKubun = new Set(['有給休暇']);
    const unpaidLeaveKubun = new Set(['無給休暇']);
    const absenceKubun = new Set(['欠勤']);

    const items = [];
    let submitted = 0;
    let missing = 0;
    const workingUsers = new Set();
    const keySet = new Set();
    for (const a of (attRows || [])) {
      const userId = Number(a.userId);
      const user = userMap.get(userId);
      if (!user) continue;
      const date = String(a.date || a.firstCheckIn || '').slice(0, 10);
      if (!date) continue;
      const key = `${userId}|${date}`;
      keySet.add(key);
      const rep = reportMap.get(key) || null;
      const daily = dailyMap.get(key) || null;
      const site = pickNonEmptyText(a.site, daily?.location, rep?.site);
      const work = pickNonEmptyText(a.work, daily?.memo, rep?.work);
      const fallbackOutHm = ''; // Do not fallback out time
      const workType = daily?.workType || rep?.work_type || a.attendanceWorkType || null;
      const hasReportContent = !!(site || work);
      const status = a.lastCheckOut
        ? (hasReportContent ? 'submitted' : 'missing')
        : (date < today
            ? (hasReportContent ? 'checkout_missing_submitted' : 'checkout_missing')
            : 'working');
      let kubun = String(daily?.kubun || '').trim();
      if (kubun === '休み') kubun = '休日';
      if (!kubun) {
        const leaveKubun = leaveByUserDate.get(key) || '';
        if (leaveKubun) kubun = leaveKubun;
        else if (status === 'missing' && !hasReportContent && isOffDate(date, user.departmentName)) kubun = '休日';
        else kubun = isOffDate(date, user.departmentName) ? '休日出勤' : '出勤';
        
        const isPartTime = user.employment_type === 'part_time' || user.employmentType === 'part_time';
        if (isPartTime && kubun === '休日') {
           kubun = ''; // Clear default 休日 for part-time if they didn't explicitly punch or set it
        } else if (isPartTime && !daily?.kubun && kubun !== '欠勤') {
           kubun = ''; // Part-time users should not automatically get 休日出勤 or 出勤 text on empty days
        }
      }
      if (kubun === '休日出勤' && !a.firstCheckIn && !a.lastCheckOut) kubun = '休日';
      if (status === 'submitted' || status === 'checkout_missing_submitted') submitted++;
      else if (status === 'missing' || status === 'checkout_missing') missing++;
      workingUsers.add(userId);
      items.push({
        userId,
        employeeCode: user.employeeCode || null,
        username: user.username || null,
        departmentId: user.departmentId || null,
        departmentName: user.departmentName || null,
        branchId: user.branchId || null,
        branchName: user.branchName || null,
        role: user.role || null,
        employment_type: user.employment_type || null,
        date,
        weekday: weekdayJa(date),
        holiday: isOffDate(date, user.departmentName), // Thêm flag holiday
        attendance: {
          checkIn: a.firstCheckIn || null,
          checkOut: a.lastCheckOut || (fallbackOutHm ? `${date} ${fallbackOutHm}:00` : null)
        },
        kubun: kubun || null,
        workType,
        site,
        work,
        memo: daily?.memo || null,
        notes: daily?.notes || null,
        lateMinutes: daily?.lateMinutes || 0,
        earlyMinutes: daily?.earlyMinutes || 0,
        reason: daily?.reason || '',
        status
      });
    }

    // debug log
    console.log("Work Reports Items Count:", items.length);
    const u23 = items.filter(i => i.userId === 23);
    console.log("EMP023 Items:", JSON.stringify(u23, null, 2));

    // Add rows that exist only in monthly input (attendance_daily / work_reports) without punch data.
    const extraKeys = new Set([
      ...Array.from(dailyMap.keys()),
      ...Array.from(reportMap.keys()),
      ...Array.from(leaveByUserDate.keys())
    ]);
    for (const key of extraKeys) {
      if (keySet.has(key)) continue;
      const [uidStr, date] = String(key).split('|');
      const userId = Number(uidStr);
      if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) continue;
      const user = userMap.get(userId);
      if (!user) continue;
      const daily = dailyMap.get(key) || null;
      const rep = reportMap.get(key) || null;
      let kubun = String(daily?.kubun || '').trim();
      if (!kubun) kubun = String(leaveByUserDate.get(key) || '').trim();
      if (kubun === '休み') kubun = '休日';
      const site = pickNonEmptyText(daily?.location, rep?.site);
      const work = pickNonEmptyText(daily?.memo, rep?.work);
      const hasContent = !!(site || work);
      if (kubun === '休日出勤' && !hasContent) kubun = '休日';
      const workType = daily?.workType || rep?.work_type || null;
      const fallbackOutHm = ''; // Do not fallback out time if no checkIn

      let status = '';
      if (holidayKubun.has(kubun)) status = 'off';
      else if (!kubun && isOffDate(date, user.departmentName) && user.employment_type !== 'part_time' && user.employmentType !== 'part_time') status = 'off';
      else if (paidLeaveKubun.has(kubun)) status = 'paid_leave';
      else if (unpaidLeaveKubun.has(kubun)) status = 'unpaid_leave';
      else if (absenceKubun.has(kubun)) status = 'absence';
      else if (workKubun.has(kubun) || hasContent || (!kubun && (user.employment_type === 'part_time' || user.employmentType === 'part_time'))) status = 'not_punched'; // Treat as missing punch rather than monthly input only
      else continue;
      // Hide pure future off-day placeholders (no punch/report content) to match admin expectation.
      if (status === 'off' && String(date).slice(0, 10) > today && !hasContent && !holidayKubun.has(kubun)) continue;
      if (!kubun && status === 'off') kubun = '休日';

      // For part-time without a shift, and not explicitly marked as off, treat as missing
      const isPartTime = user.employment_type === 'part_time' || user.employmentType === 'part_time';
      if (isPartTime && status === 'off' && !holidayKubun.has(kubun)) {
          status = 'not_punched';
          kubun = '';
      }
      
      if (status === 'not_punched' && !hasContent && String(date).slice(0, 10) > today && !holidayKubun.has(kubun) && !absenceKubun.has(kubun)) {
          continue; // Hide pure future not punched to avoid clutter
      }

      if (status === 'not_punched' && hasContent) submitted++;
      workingUsers.add(userId);
      items.push({
        userId,
        employeeCode: user.employeeCode || null,
        username: user.username || null,
        departmentId: user.departmentId || null,
        departmentName: user.departmentName || null,
        branchId: user.branchId || null,
        branchName: user.branchName || null,
        role: user.role || null,
        employment_type: user.employment_type || null,
        date: String(date).slice(0, 10),
        weekday: weekdayJa(date),
        holiday: isOffDate(date, user.departmentName), // Thêm flag holiday
        attendance: { checkIn: null, checkOut: fallbackOutHm ? `${String(date).slice(0, 10)} ${fallbackOutHm}:00` : null },
        kubun: kubun || null,
        workType,
        site,
        work,
        memo: daily?.memo || null,
        notes: daily?.notes || null,
        lateMinutes: daily?.lateMinutes || 0,
        earlyMinutes: daily?.earlyMinutes || 0,
        reason: daily?.reason || '',
        status
      });
    }

    items.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const ac = String(a.employeeCode || '').toUpperCase();
      const bc = String(b.employeeCode || '').toUpperCase();
      if (ac !== bc) return ac < bc ? -1 : 1;
      return Number(a.userId || 0) - Number(b.userId || 0);
    });

    res.status(200).json({
      month,
      closed,
      range: { start, end },
      summary: {
        employees: workingUsers.size,
        workedDays: items.length,
        submitted,
        missing
      },
      items
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/month/:userId', authorize('admin', 'manager'), async (req, res) => {
  try {
    const userId = parseInt(String(req.params.userId || ''), 10);
    if (!userId) return res.status(400).json({ message: 'Invalid userId' });
    if (!(await canManagerAccessUser(req, userId))) return res.status(403).json({ message: 'Forbidden' });
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const { start, end } = monthRange(month);
    const closed = await repo.isMonthClosed(month, req.tenantId).catch(() => false);

    const [[u]] = await db.query(`
      SELECT u.id AS userId, u.employee_code AS employeeCode, u.username AS username,
             u.departmentId AS departmentId, d.name AS departmentName
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      WHERE u.id = ?
      LIMIT 1
    `, [userId]);

    const [attRows] = await db.query(`
      SELECT id, checkIn, checkOut
      FROM attendance
      WHERE userId = ?
        AND (
          (checkIn >= ? AND checkIn < DATE_ADD(?, INTERVAL 1 DAY))
          OR (checkIn IS NULL AND checkOut >= ? AND checkOut < DATE_ADD(?, INTERVAL 1 DAY))
        )
      ORDER BY COALESCE(checkIn, checkOut) ASC
    `, [userId, start + ' 00:00:00', end + ' 00:00:00', start + ' 00:00:00', end + ' 00:00:00']);

    const attLatest = new Map();
    for (const a of (attRows || [])) {
      const d = String(a.checkIn || a.checkOut || '').slice(0, 10);
      const prev = attLatest.get(d);
      if (!prev || String(a.checkIn || a.checkOut || '') > String(prev.checkIn || prev.checkOut || '')) attLatest.set(d, a);
    }

    const [leaveRows] = await db.query(`
      SELECT startDate, endDate
      FROM leave_requests
      WHERE userId = ?
        AND status = 'approved'
        AND endDate >= ? AND startDate <= ?
    `, [userId, start, end]);
    const leaves = (leaveRows || []).map(r => ({ start: String(r.startDate).slice(0, 10), end: String(r.endDate).slice(0, 10) }));
    const isOnLeave = (d) => leaves.some(it => d >= it.start && d <= it.end);

    const reports = await repo.listByUserMonth(userId, month);
    const reportMap = new Map();
    for (const r of (reports || [])) {
      reportMap.set(String(r.date).slice(0, 10), r);
    }

    const days = (() => {
      const out = [];
      const d0 = new Date(start + 'T00:00:00Z');
      const d1 = new Date(end + 'T00:00:00Z');
      for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 60 * 60 * 1000) {
        out.push(new Date(t).toISOString().slice(0, 10));
      }
      return out;
    })();

    const items = days.map(d => {
      const att = attLatest.get(d) || null;
      let status = '';
      if (isOnLeave(d)) status = 'leave';
      else status = att ? (att.checkOut ? 'checked_out' : 'working') : 'not_checked_in';
      const rep = reportMap.get(d) || null;
      const report = rep ? { site: rep.site, work: rep.work, updatedAt: rep.updated_at || rep.updatedAt || null } : null;
      return { date: d, status, report };
    });

    res.status(200).json({
      month,
      closed,
      user: u ? { userId: u.userId, employeeCode: u.employeeCode || null, username: u.username || null, departmentName: u.departmentName || null } : { userId },
      items
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/close-month',
  rateLimitNamed('workreports_close_month', { windowMs: 60_000, max: 5 }),
  authorize('admin', 'manager'),
  async (req, res) => {
  try {
    const month = isYM(req.body?.month) ? String(req.body.month) : null;
    if (!month) return res.status(400).json({ message: 'Missing month' });
    const r = await repo.closeMonth(month, req.user?.id || null, req.tenantId);
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── 過去データ取込 (attendance_daily → work_reports、1回限りの移行用) ──────
router.post('/backfill-from-daily',
  rateLimitNamed('workreports_backfill', { windowMs: 60_000, max: 3 }),
  authorize('admin', 'manager'),
  async (req, res) => {
  try {
    const tenantClause = req.tenantId ? 'AND u.tenant_id = ?' : '';
    const tenantParams = req.tenantId ? [req.tenantId] : [];

    const [existingRows] = await db.query(`SELECT userId, date FROM work_reports`);
    const existingKeys = new Set((existingRows || []).map(r => `${r.userId}|${String(r.date).slice(0, 10)}`));

    const [dailyRows] = await db.query(`
      SELECT ad.userId, ad.date, ad.location, ad.memo, ad.work_type
      FROM attendance_daily ad
      JOIN users u ON u.id = ad.userId
      WHERE ((ad.location IS NOT NULL AND ad.location <> '') OR (ad.memo IS NOT NULL AND ad.memo <> ''))
        ${tenantClause}
    `, tenantParams);

    let created = 0;
    let skippedExisting = 0;
    let skippedEmpty = 0;

    for (const row of (dailyRows || [])) {
      const work = String(row.memo || '').trim();
      if (!work) { skippedEmpty++; continue; }
      const dateStr = String(row.date).slice(0, 10);
      const key = `${row.userId}|${dateStr}`;
      if (existingKeys.has(key)) { skippedExisting++; continue; }

      const [[times]] = await db.query(`
        SELECT MIN(checkIn) AS minIn, MAX(checkOut) AS maxOut
        FROM attendance
        WHERE userId = ? AND DATE(COALESCE(checkIn, checkOut)) = ?
      `, [row.userId, dateStr]);
      const startTime = times?.minIn ? String(times.minIn).slice(11, 19) : null;
      const endTime = times?.maxOut ? String(times.maxOut).slice(11, 19) : null;
      const site = String(row.location || '').trim();
      const workType = ['onsite', 'remote', 'satellite'].includes(row.work_type) ? row.work_type : null;

      await repo.create({ userId: row.userId, date: dateStr, startTime, endTime, workType, site, work, status: 'approved' });
      existingKeys.add(key);
      created++;
    }

    _logAudit(req, 'work_report_backfill_from_daily', null, { created, skippedExisting, skippedEmpty });
    res.status(200).json({ created, skippedExisting, skippedEmpty });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── 作業報告一覧・承認/差戻し (新レイアウト、mockup 対応) ──────────────

router.get('/list', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const dept = req.query?.dept ? String(req.query.dept) : '';
    const status = ['pending', 'approved', 'rejected', 'submitted', 'missing'].includes(String(req.query?.status || '')) ? String(req.query.status) : '';
    const q = req.query?.q ? String(req.query.q) : '';
    const page = parseInt(req.query?.page, 10) || 1;
    const pageSize = parseInt(req.query?.pageSize, 10) || 50;
    const userId = req.query?.userId ? parseInt(String(req.query.userId), 10) : null;
    if (userId && !(await canManagerAccessUser(req, userId))) return res.status(403).json({ message: 'Forbidden' });
    const closed = await repo.isMonthClosed(month, req.tenantId).catch(() => false);
    const result = await repo.listForAdmin({ tenantId: req.tenantId, month, dept, userId, status, q, page, pageSize });
    res.status(200).json({ month, closed, ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', authorize('admin', 'manager'), async (req, res) => {
  try {
    const body = req.body || {};
    const userId = parseInt(String(body.userId || ''), 10);
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    if (!(await canManagerAccessUser(req, userId))) return res.status(403).json({ message: 'Forbidden' });
    const date = isISODate(body.date) ? String(body.date) : null;
    if (!date) return res.status(400).json({ message: 'Invalid date' });
    const work = String(body.work || '').trim();
    if (!work) return res.status(400).json({ message: 'Missing work' });
    const site = String(body.site || '').trim();
    const isHM = (v) => /^\d{2}:\d{2}(:\d{2})?$/.test(String(v || ''));
    const startTime = isHM(body.startTime) ? String(body.startTime) : null;
    const endTime = isHM(body.endTime) ? String(body.endTime) : null;
    const wt = String(body.workType || '').trim();
    const workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
    const insertId = await repo.create({ userId, date, startTime, endTime, workType, site, work, status: 'approved' });
    const saved = await repo.getById(insertId);
    _logAudit(req, 'work_report_create', null, saved);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id', authorize('admin', 'manager'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Invalid id' });
    const before = await repo.getById(id);
    if (!before) return res.status(404).json({ message: 'Not found' });
    if (!(await canManagerAccessUser(req, before.userId))) return res.status(403).json({ message: 'Forbidden' });
    const body = req.body || {};
    const isHM = (v) => /^\d{2}:\d{2}(:\d{2})?$/.test(String(v || ''));
    const patch = {};
    if (body.site !== undefined) patch.site = String(body.site || '').trim();
    if (body.work !== undefined) patch.work = String(body.work || '').trim();
    if (body.startTime !== undefined) patch.startTime = isHM(body.startTime) ? String(body.startTime) : null;
    if (body.endTime !== undefined) patch.endTime = isHM(body.endTime) ? String(body.endTime) : null;
    if (body.workType !== undefined) {
      const wt = String(body.workType || '').trim();
      patch.workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
    }
    await repo.update(id, patch);
    // 管理者が 未提出(空) / 差戻し の報告に作業内容を入れた場合も 提出済み（approved）にする
    const afterUpdate = await repo.getById(id);
    if (afterUpdate && afterUpdate.status !== 'approved' && String(afterUpdate.work || '').trim()) {
      await repo.setStatus(id, 'approved', { approvedBy: req.user?.id || null, rejectedReason: null });
    }
    const saved = await repo.getById(id);
    _logAudit(req, 'work_report_update', before, saved);
    res.status(200).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', authorize('admin', 'manager'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Invalid id' });
    const before = await repo.getById(id);
    if (!before) return res.status(404).json({ message: 'Not found' });
    if (!(await canManagerAccessUser(req, before.userId))) return res.status(403).json({ message: 'Forbidden' });
    await repo.remove(id);
    _logAudit(req, 'work_report_delete', before, null);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/approve', authorize('admin', 'manager'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Invalid id' });
    const before = await repo.getById(id);
    if (!before) return res.status(404).json({ message: 'Not found' });
    if (!(await canManagerAccessUser(req, before.userId))) return res.status(403).json({ message: 'Forbidden' });
    await repo.setStatus(id, 'approved', { approvedBy: req.user?.id || null });
    const saved = await repo.getById(id);
    _logAudit(req, 'work_report_approve', before, saved);
    res.status(200).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/reject', authorize('admin', 'manager'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Invalid id' });
    const before = await repo.getById(id);
    if (!before) return res.status(404).json({ message: 'Not found' });
    if (!(await canManagerAccessUser(req, before.userId))) return res.status(403).json({ message: 'Forbidden' });
    const reason = String(req.body?.reason || '').trim() || null;
    await repo.setStatus(id, 'rejected', { approvedBy: req.user?.id || null, rejectedReason: reason });
    const saved = await repo.getById(id);
    _logAudit(req, 'work_report_reject', before, saved);
    res.status(200).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/export.csv', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const dept = req.query?.dept ? String(req.query.dept) : '';
    const status = ['pending', 'approved', 'rejected', 'submitted', 'missing'].includes(String(req.query?.status || '')) ? String(req.query.status) : '';
    const q = req.query?.q ? String(req.query.q) : '';
    const { items } = await repo.listForAdmin({ tenantId: req.tenantId, month, dept, status, q, page: 1, pageSize: 5000 });
    const csvEsc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // 承認フロー廃止後の表示: 差戻し / 未提出(作業内容が空) / 提出済み
    const statusLabel = (r) => r.status === 'rejected' ? '差戻し' : (String(r.work || '').trim() ? '提出済み' : '未提出');
    const fmtHm = (t) => t ? String(t).slice(0, 5) : '';
    const header = '日付,社員番号,氏名,部署,現場・案件,作業内容,開始,終了,ステータス\n';
    let csv = header;
    for (const r of items) {
      csv += [
        csvEsc(String(r.date || '').slice(0, 10)),
        csvEsc(r.employeeCode || ''),
        csvEsc(r.username || ''),
        csvEsc(r.departmentName || ''),
        csvEsc(r.site || ''),
        csvEsc(r.work || ''),
        csvEsc(fmtHm(r.startTime)),
        csvEsc(fmtHm(r.endTime)),
        csvEsc(statusLabel(r))
      ].join(',') + '\n';
    }
    const filename = `work_reports_${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send('﻿' + csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/export-report.xlsx', authorize('admin', 'manager'), async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const month = isYM(req.query?.month) ? String(req.query.month) : monthJST();
    const dept = req.query?.dept ? String(req.query.dept) : '';
    const status = ['pending', 'approved', 'rejected', 'submitted', 'missing'].includes(String(req.query?.status || '')) ? String(req.query.status) : '';
    const q = req.query?.q ? String(req.query.q) : '';
    const { items } = await repo.listForAdmin({ tenantId: req.tenantId, month, dept, status, q, page: 1, pageSize: 5000 });

    // 承認フロー廃止後の表示: 差戻し / 未提出(作業内容が空) / 提出済み
    const statusLabel = (r) => r.status === 'rejected' ? '差戻し' : (String(r.work || '').trim() ? '提出済み' : '未提出');
    const fmtHm = (t) => t ? String(t).slice(0, 5) : '';
    const durationHm = (st, et) => {
      if (!st || !et) return '';
      const [sh, sm] = String(st).slice(0, 5).split(':').map(Number);
      const [eh, em] = String(et).slice(0, 5).split(':').map(Number);
      if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return '';
      const diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff < 0) return '';
      // 小数（例: 9.0, 5.5）で表示する — 時:分 形式ではなく指定された形式に合わせる
      return Math.round((diff / 60) * 100) / 100;
    };

    const columns = [
      { header: '日付', width: 13 },
      { header: '曜日', width: 7 },
      { header: '社員', width: 15 },
      { header: '部署', width: 13 },
      { header: '現場・案件', width: 22 },
      { header: '作業内容', width: 30 },
      { header: '開始', width: 9 },
      { header: '終了', width: 9 },
      { header: '時間', width: 9 },
      { header: 'ステータス', width: 12 }
    ];
    const xlsxRows = items.map(r => [
      String(r.date || '').slice(0, 10),
      weekdayJa(r.date),
      r.username || '',
      r.departmentName || '',
      r.site || '',
      r.work || '',
      fmtHm(r.startTime),
      fmtHm(r.endTime),
      durationHm(r.startTime, r.endTime),
      statusLabel(r)
    ]);

    // 勤怠記録のExcel出力と同じ配色 (えんじヘッダー + 薄いピンク行) で統一する
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
    const ws = workbook.addWorksheet(`作業報告_${month}`.slice(0, 31));
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
        cell.alignment = { vertical: 'middle', horizontal: (ci === 4 || ci === 5) ? 'left' : 'center' };
        if (ci === 8 && typeof v === 'number') cell.numFmt = '0.0';
      });
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `work_reports_${month}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:userId', authorize('admin', 'manager'), async (req, res) => {
  try {
    const userId = parseInt(String(req.params.userId || ''), 10);
    if (!userId) return res.status(400).json({ message: 'Invalid userId' });
    if (!(await canManagerAccessUser(req, userId))) return res.status(403).json({ message: 'Forbidden' });
    const date = isISODate(req.query?.date) ? String(req.query.date) : todayJST();
    const [[row]] = await db.query(`
      SELECT
        wr.*,
        u.employee_code AS employeeCode,
        u.username AS username,
        u.departmentId AS departmentId,
        d.name AS departmentName
      FROM work_reports wr
      LEFT JOIN users u ON u.id = wr.userId
      LEFT JOIN departments d ON d.id = u.departmentId
      WHERE wr.userId = ? AND wr.date = ?
      LIMIT 1
    `, [userId, date]);
    res.status(200).json({ date, report: row || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
