'use strict';
/**
 * workReports.export.routes.js
 * Excel export handler for work reports (GET /export.xlsx).
 * Split from workReports.admin.routes.js for maintainability.
 */
const express = require('express');
const router = express.Router();
const { authorize } = require('../../core/middleware/authMiddleware');
const { rateLimitNamed } = require('../../core/middleware/rateLimit');
const repo = require('./workReports.repository');
const attendanceRepo = require('../attendance/attendance.repository');
const calendarRepo = require('../calendar/calendar.repository');
const { getDepartmentOffDaySet, isHolidayWorkDay, suppressHolidayWorkLateEarly } = require('../attendance/attendance.utils');
const db = require('../../core/database/mysql');
const s3Service = require('../../core/services/s3.service');

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const roleScopeSql = (req, alias = 'u') => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'manager') return ` AND ${alias}.role = 'employee'`;
  return ` AND ${alias}.role NOT IN ('admin','manager','sysadmin','owner')`;
};

const weekdayJa = (dateStr) => {
  const s = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return labels[idx] || '';
};

router.get('/export.xlsx',
  rateLimitNamed('workreports_export_xlsx', { windowMs: 60_000, max: 10 }),
  authorize('admin', 'manager'),
  async (req, res) => {
  try {
    const period = String(req.query?.period || 'day').toLowerCase();
    const qDate = String(req.query?.date || todayJST()).slice(0, 10);
    const qMonth = String(req.query?.month || qDate.slice(0, 7)).slice(0, 7);
    const qYear = parseInt(String(req.query?.year || qDate.slice(0, 4)), 10);

    const addDays = (dateStr, delta) => {
      const dt = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
      dt.setUTCDate(dt.getUTCDate() + delta);
      return dt.toISOString().slice(0, 10);
    };
    const lastDayOfMonth = (ym) => {
      const [y, m] = String(ym).split('-').map(n => parseInt(n, 10));
      return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    };
    const weekRange = (dateStr) => {
      const dt = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
      const dow = dt.getUTCDay();
      const diffToMon = (dow + 6) % 7;
      const start = addDays(dateStr, -diffToMon);
      const end = addDays(start, 6);
      return { start, end };
    };

    let start = qDate;
    let end = qDate;
    if (period === 'week') {
      const r = weekRange(qDate);
      start = r.start;
      end = r.end;
    } else if (period === 'month') {
      start = `${qMonth}-01`;
      end = lastDayOfMonth(qMonth);
    } else if (period === 'year') {
      const y = qYear || parseInt(qDate.slice(0, 4), 10);
      start = `${String(y).padStart(4, '0')}-01-01`;
      end = `${String(y).padStart(4, '0')}-12-31`;
    }

    const dates = (() => {
      const out = [];
      const d0 = new Date(start + 'T00:00:00Z');
      const d1 = new Date(end + 'T00:00:00Z');
      for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 60 * 60 * 1000) {
        out.push(new Date(t).toISOString().slice(0, 10));
      }
      return out;
    })();
    const yearsInRange = Array.from(new Set(dates.map(d => parseInt(String(d).slice(0, 4), 10)).filter(Boolean)));

    // ── Tenant isolation: không xuất dữ liệu của công ty khác ──
    const _tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
    const tenantUserClause = _tid ? ' AND userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';
    const tenantP = _tid ? [_tid] : [];

    // ── Lọc theo userIds nếu có (chọn nhiều nhân viên để xuất) ──
    const userIdsRaw = String(req.query?.userIds || '').trim();
    let selUserIds = [];
    if (userIdsRaw) {
      selUserIds = userIdsRaw.split(',').map(s => parseInt(String(s).trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
    }
    const selUserIdsClause = selUserIds.length ? ' AND u.id IN (?' + ',?'.repeat(selUserIds.length - 1) + ')' : '';
    const selAttClause = selUserIds.length ? ' AND userId IN (?' + ',?'.repeat(selUserIds.length - 1) + ')' : '';

    const [users] = await db.query(`
      SELECT u.id AS userId, u.employee_code AS employeeCode, u.username AS username,
             d.name AS departmentName, u.birth_date AS birthDate, u.employment_type AS employmentType
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      WHERE u.employment_status = 'active'
        ${roleScopeSql(req, 'u')}
        ${_tid ? 'AND u.tenant_id = ?' : ''}
        ${selUserIdsClause}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC
    `, [...tenantP, ...selUserIds]);

    // Per-department off-day logic — tra department_holidays thật của từng công ty,
    // không hardcode tên bộ phận "工事部" nữa (đã thay bằng cấu hình 休日設定 theo tenant).
    const distinctDeptNames = Array.from(new Set((users || []).map(u => u.departmentName || '')));
    const offSetByYearDept = new Map();
    await Promise.all(
      yearsInRange.flatMap(y => distinctDeptNames.map(async (deptName) => {
        const off = await getDepartmentOffDaySet(y, { departmentName: deptName || null, tenantId: req.tenantId || 0 });
        offSetByYearDept.set(`${y}|${deptName}`, off);
      }))
    );
    const isOffDate = (dateStr, deptName) => {
      const y = parseInt(String(dateStr).slice(0, 4), 10);
      const off = offSetByYearDept.get(`${y}|${deptName || ''}`);
      return off ? off.has(String(dateStr).slice(0, 10)) : false;
    };

    const [attRows] = await db.query(`
      SELECT a.userId, DATE(COALESCE(a.checkIn, a.checkOut)) AS date, a.checkIn, a.checkOut, a.work_type AS work_type
      FROM attendance a
      INNER JOIN (
        SELECT userId, DATE(COALESCE(checkIn, checkOut)) AS date, MAX(COALESCE(checkIn, checkOut)) AS maxTime
        FROM attendance
        WHERE DATE(COALESCE(checkIn, checkOut)) >= ? AND DATE(COALESCE(checkIn, checkOut)) <= ?${tenantUserClause}${selAttClause}
        GROUP BY userId, DATE(COALESCE(checkIn, checkOut))
      ) t
        ON t.userId = a.userId AND t.maxTime = COALESCE(a.checkIn, a.checkOut)
    `, [start, end, ...tenantP, ...selUserIds]);

    const [attFullRows] = await db.query(`
      SELECT userId, DATE(COALESCE(checkIn, checkOut)) AS date, location, memo
      FROM attendance
      WHERE DATE(COALESCE(checkIn, checkOut)) >= ? AND DATE(COALESCE(checkIn, checkOut)) <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);

    const [repRows] = await db.query(`
      SELECT userId, date, site, work, work_type
      FROM work_reports
      WHERE date >= ? AND date <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);

    const [dailyRows] = await db.query(`
      SELECT userId, date, kubun, location, memo, late_minutes, early_minutes, reason
      FROM attendance_daily
      WHERE date >= ? AND date <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);
    // 休日出勤日の遅刻・早退は出さない (月次勤怠入力画面と同じ。DBは変更しない)
    await suppressHolidayWorkLateEarly(dailyRows, req.tenantId || 0);

    const [leaveRows] = await db.query(`
      SELECT userId, startDate, endDate, type
      FROM leave_requests
      WHERE status = 'approved'
        AND endDate >= ? AND startDate <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);

    const [shiftRows] = await db.query(`
      SELECT userId, date, status
      FROM shift_requests
      WHERE date >= ? AND date <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);
    
    const [userAssignRows] = await db.query(`
      SELECT userId, start_date
      FROM user_shift_assignments
      WHERE start_date >= ? AND start_date <= ?${tenantUserClause}${selAttClause}
    `, [start, end, ...tenantP, ...selUserIds]);

    const attMap = new Map();
    for (const a of (attRows || [])) {
      const d = String(a.date || a.checkIn || a.checkOut || '').slice(0, 10);
      attMap.set(`${a.userId}|${d}`, a);
    }
    const attConcatMap = new Map();
    for (const a of (attFullRows || [])) {
      const d = String(a.date || '').slice(0, 10);
      const key = `${a.userId}|${d}`;
      if (!attConcatMap.has(key)) {
        attConcatMap.set(key, { location: [], memo: [] });
      }
      const mapObj = attConcatMap.get(key);
      const loc = String(a.location || '').trim();
      const mem = String(a.memo || '').trim();
      if (loc) mapObj.location.push(loc);
      if (mem) mapObj.memo.push(mem);
    }
    const repMap = new Map();
    for (const r of (repRows || [])) {
      repMap.set(`${r.userId}|${String(r.date).slice(0, 10)}`, r);
    }
    const dailyMap = new Map();
    for (const d of (dailyRows || [])) {
      dailyMap.set(`${d.userId}|${String(d.date).slice(0, 10)}`, d);
    }
    const leaveByUser = new Map();
    for (const lr of (leaveRows || [])) {
      const uid = Number(lr.userId);
      if (!leaveByUser.has(uid)) leaveByUser.set(uid, []);
      leaveByUser.get(uid).push({ start: String(lr.startDate).slice(0, 10), end: String(lr.endDate).slice(0, 10), type: String(lr.type || '') });
    }
    const shiftMap = new Map();
    for (const sr of (shiftRows || [])) {
      shiftMap.set(`${sr.userId}|${String(sr.date).slice(0, 10)}`, sr.status);
    }
    for (const ua of (userAssignRows || [])) {
      // Treat user assignments as 'WORKING' for Baito
      shiftMap.set(`${ua.userId}|${String(ua.start_date).slice(0, 10)}`, 'WORKING');
    }
    const isOnLeave = (uid, dateStr) => {
      const arr = leaveByUser.get(Number(uid));
      if (!arr || !arr.length) return null;
      for (const it of arr) {
        if (dateStr >= it.start && dateStr <= it.end) return it;
      }
      return null;
    };

    const fmtHm = (dt) => {
      if (!dt) return '';
      const s = String(dt);
      return s.length >= 16 ? s.slice(11, 16) : s;
    };
    const dowJa = (dateStr) => {
      try {
        const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(x => parseInt(x, 10));
        const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        return ['日','月','火','水','木','金','土'][dt.getUTCDay()];
      } catch {
        return '';
      }
    };
    const wtLabel = (wt) => wt === 'onsite' ? '出社' : wt === 'remote' ? '在宅' : wt === 'satellite' ? '現場' : '';
    const leaveLabel = (t) => {
      const s = String(t || '').toLowerCase();
      if (s === 'paid') return '有給';
      if (s === 'sick') return '病欠';
      if (s === 'overtime') return '残業';
      return '休暇';
    };

    const buildRow = (u, d) => {
      const uid = Number(u.userId);
      const code = u.employeeCode || `EMP${String(uid).padStart(3, '0')}`;
      const name = u.username || '';
      const dept = u.departmentName || '';
      const leave = isOnLeave(uid, d);
      const att = attMap.get(`${uid}|${d}`) || null;
      const attConcat = attConcatMap.get(`${uid}|${d}`) || null;
      const rep = repMap.get(`${uid}|${d}`) || null;
      const daily = dailyMap.get(`${uid}|${d}`) || null;
      const wt = String(rep?.work_type || att?.work_type || '').trim();
      let status = '';
      let cin = '';
      let cout = '';
      
      let isOff = isOffDate(d, dept);
      
      const isPartTime = u.employmentType === 'part_time' || u.employment_type === 'part_time';
      if (isPartTime) {
        const shiftStatus = shiftMap.get(`${uid}|${d}`);
        if (shiftStatus === 'WORKING' || shiftStatus === 'approved') {
          isOff = false;
        } else if (shiftStatus === 'OFF') {
          isOff = true;
        } else {
          isOff = false; // default to working so they get 未 if no punch and no explicitly 休日 applied
        }
      }

      if (daily?.kubun === '休日' || daily?.kubun === '所定休日' || daily?.kubun === '休み') {
        isOff = true;
      } else if (isPartTime && !daily?.kubun && isOffDate(d, dept)) {
        isOff = false; // Part-time doesn't inherit company off-days unless explicitly set
      }

      const today = todayJST();
      if (leave) {
        status = leaveLabel(leave.type);
      } else if (daily?.kubun === '欠勤') {
        status = '欠勤';
        isOff = true; // Mark as "off" in row structure so it gets red text color
      } else if (daily?.kubun === '半休' || daily?.kubun === '半休(有給)') {
        status = daily.kubun;
        cin = fmtHm(att?.checkIn);
        cout = fmtHm(att?.checkOut);
      } else if (daily?.kubun === '有給休暇') {
        status = '有給';
      } else if (daily?.kubun === '無給休暇') {
        status = '無給休暇';
      } else if (daily?.kubun === '代替休日') {
        status = '代替休日';
        isOff = true;
      } else if (daily?.kubun === '振替出勤' || daily?.kubun === '代替出勤') {
        status = daily.kubun;
        cin = fmtHm(att?.checkIn);
        cout = fmtHm(att?.checkOut);
      } else if (!att?.checkIn && isOff && (!isPartTime || (daily?.kubun === '休日' || daily?.kubun === '所定休日' || daily?.kubun === '休み'))) {
        status = '休日';
      } else if (!att?.checkIn && isPartTime && d > today && !daily?.kubun) {
        status = ''; // Don't show anything for pure future days in export
      } else if (!att?.checkIn && isPartTime) {
        status = '未';
      } else if (!att?.checkIn && !isOff && d <= today) {
        status = '未';
      } else if (!att?.checkIn && !isOff && d > today) {
        status = '';
      } else if (att?.checkIn) {
        status = att?.checkOut ? (isOff ? '休日出勤' : '出勤') : (isOff ? '休日出勤' : '出勤');
        cin = fmtHm(att.checkIn);
        cout = fmtHm(att.checkOut);
      } else if (!isOff) {
        status = '出勤';
      }
      return {
        uid,
        code,
        name,
        dept,
        wt,
        wtText: wtLabel(wt),
        status,
        cin,
        cout,
        site: isOff && !att?.checkIn && !daily?.location && !rep?.site && (!attConcat || !attConcat.location.length) ? '' : (attConcat && attConcat.location.length > 0 ? attConcat.location.join(' / ') : String(daily?.location || att?.location || rep?.site || '')),
        work: isOff && !att?.checkIn && !daily?.memo && !rep?.work && (!attConcat || !attConcat.memo.length) ? '' : (attConcat && attConcat.memo.length > 0 ? attConcat.memo.join(' / ') : String(daily?.memo || att?.memo || rep?.work || '')),
        lateMinutes: daily?.late_minutes || 0,
        earlyMinutes: daily?.early_minutes || 0,
        reason: daily?.reason || '',
        isOff: isOff,
        // 正社員の休日出勤日 (定時が無いので遅刻を付けない)
        isHolidayWork: isHolidayWorkDay({ kubun: daily?.kubun, isOffDay: isOffDate(d, dept), employmentType: u.employmentType || u.employment_type })
      };
    };

    const safeFile = (s) => String(s || '').replace(/[\\\/:*?"<>|]/g, '_');
    const fileName = safeFile(`attendance_${period}_${start}_${end}.xlsx`);

    const { buildXlsx, buildXlsxBook } = require('../../utils/xlsx');

    if (period === 'week') {
      const mmdd = (d) => String(d).slice(5, 10).replace('-', '/');
      const weekCol = (d) => `${dowJa(d)}(${mmdd(d)})`;
      const summaryColumns = [
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 14 },
        { header: '部署', width: 22 },
        ...dates.map(d => ({ header: weekCol(d), width: 22 }))
      ];
      const summaryRows = (users || []).map(u => {
        const uid = Number(u.userId);
        const code = u.employeeCode || `EMP${String(uid).padStart(3, '0')}`;
        const name = u.username || '';
        const dept = u.departmentName || '';
        const dayCells = dates.map(d => {
          const r = buildRow(u, d);
      if (r.status === '欠勤') {
        return '欠勤';
      }
      if (r.status === '休日') return '休日';
      const t1 = r.status ? r.status : '';
      const t2 = r.wtText ? r.wtText : '';
      const t3 = r.cin || r.cout ? `${r.cin || ''}${r.cout ? '-' + r.cout : ''}` : '';
      const t4 = r.site ? r.site : '';
      return [t1, t2, t4].filter(Boolean).join('\n');
        });
        return { isOff: false, cells: [code, name, dept, ...dayCells] };
      });

      const dayColumns = [
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 14 },
        { header: '部署', width: 22 },
        { header: '勤務区分', width: 12 },
        { header: '出社', width: 8 },
        { header: '在宅', width: 8 },
        { header: '現場', width: 10 },
        { header: '現場（任意）', width: 18 },
        { header: '作業内容', width: 52 }
      ];
      const sheets = [
        { name: `週次サマリー ${start}`, columns: summaryColumns, rows: summaryRows }
      ];
      for (const d of dates) {
        const dayRows = (users || []).map(u => {
          const r = buildRow(u, d);
          return {
            isOff: r.isOff,
            cells: [
              r.code,
              r.name,
              r.dept,
              r.status || '',
              r.wt === 'onsite' ? '✓' : '',
              r.wt === 'remote' ? '✓' : '',
              r.wt === 'satellite' ? '✓' : '',
              r.site || '',
              r.work || ''
            ]
          };
        });
        sheets.push({ name: `${mmdd(d)} ${dowJa(d)}`, columns: dayColumns, rows: dayRows });
      }

      const buf = await buildXlsxBook({ sheets });
      
      // Auto save to Cloudflare R2
      try {
        if (s3Service.isR2Configured()) {
          const timestamp = Date.now();
          const r2Key = `exports/work_reports/${fileName.replace('.xlsx', '')}_${timestamp}.xlsx`;
          await s3Service.uploadToR2(r2Key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          console.log(`[Admin] Auto-saved weekly work report export to R2: ${r2Key}`);
        }
      } catch (e) {
        console.error('Failed to auto-save weekly work report export to R2:', e);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buf);
      return;
    }

    let buf;

    // Disable redirect to single-sheet export, always use full multi-sheet export for month period
    // if (period === 'month' && (req.query.sort || req.query.dept || req.query.q || req.query.group)) {
    //   return res.redirect(`/api/admin/work-reports/month/export-table?${new URLSearchParams(req.query).toString()}`);
    // }

    if (period === 'month') {
      const dayNumbers = dates.map(d => parseInt(String(d).slice(8, 10), 10));
      const s1Cols_all = [
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 16 },
        { header: '生年月日', width: 14 },
        { header: '部署', width: 18 },
        { header: '雇用形態', width: 12 },
        { header: '所定労働日数', width: 14 },
        { header: '所定労働時間', width: 14 },
        { header: '', width: 2, headerStyle: 'empty' },
        { header: '【色分けの凡例】', width: 12, headerStyle: 'legendHeader' },
        { header: '', width: 24, headerStyle: 'legendHeader' }
      ];

      const s1Cols_type = [
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 16 },
        { header: '生年月日', width: 14 },
        { header: '部署', width: 18 },
        { header: '雇用形態', width: 12 },
        ...dayNumbers.map(n => ({ header: `${n}日`, width: 6 })),
        { header: '出勤日数', width: 10 },
        { header: '遅刻回数', width: 10 },
        { header: '合計時間', width: 12 }
      ];

      const s2Cols = [
        { header: '日付', width: 12 },
        { header: '曜日', width: 6 },
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 16 },
        { header: '勤務区分', width: 12 },
        { header: '出社時間', width: 12 },
        { header: '退社時間', width: 12 },
        { header: '現場', width: 20 },
        { header: '作業内容', width: 60 },
        { header: '遅刻', width: 8 },
        { header: '稼働時間', width: 10 }
      ];

      const s1Rows_all = [];
      const s1Rows_full = [];
      const s1Rows_part = [];

      const s2Rows_full = [];
      const s2Rows_part = [];

      const dailyPresentCount_all = new Array(dates.length).fill(0);
      const dailyPresentCount_full = new Array(dates.length).fill(0);
      const dailyPresentCount_part = new Array(dates.length).fill(0);

      const getColName = (n) => {
        let s = '';
        while (n > 0) {
          const r = (n - 1) % 26;
          s = String.fromCharCode(65 + r) + s;
          n = Math.floor((n - 1) / 26);
        }
        return s;
      };

      const userRows_all = [];

      for (const u of (users || [])) {
        const uid = Number(u.userId);
        const code = u.employeeCode || `EMP${String(uid).padStart(3, '0')}`;
        const name = u.username || '';
        const dob = u.birthDate ? String(u.birthDate).slice(0, 10).replace(/-/g, '/') : '';
        const dept = u.departmentName || '';
        const isPartTime = u.employmentType === 'part_time';
        const empType = isPartTime ? 'アルバイト' : '正社員';

        const s1Cells_all = [code, name, dob, dept, empType];
        const s1Cells_type = [code, name, dob, dept, empType];
        let workedDays = 0;
        let lateCount = 0;
        let totalHours = 0;
        let expectedWorkDays = 0;

        for (let di = 0; di < dates.length; di++) {
          const d = dates[di];
          const r = buildRow(u, d);
          if (!r.isOff) expectedWorkDays++;
          
          let cellValue = '';
          let cellStyle = 'cell';
          let isLate = 0;
          let h = 0;

          if (r.status === '出勤' || r.status === '休日出勤' || r.status === '欠勤' || r.status === '半休' || r.status === '半休(有給)' || r.status === '振替出勤' || r.status === '代替出勤') {
            const cin = r.cin || '';
            const cout = r.cout || '';
            
            if (r.status === '欠勤') {
              cellValue = '欠勤';
              cellStyle = 'absent';
            } else if (r.status === '半休') {
              cellValue = '半休';
              cellStyle = 'halfDay';
              if (cin && cout) {
                const [h1, m1] = cin.split(':').map(Number);
                const [h2, m2] = cout.split(':').map(Number);
                h = (h2 + m2/60) - (h1 + m1/60);
                if (h > 0) totalHours += h;
              }
              workedDays += 0.5;
              dailyPresentCount_all[di]++;
              if (isPartTime) dailyPresentCount_part[di]++;
              else dailyPresentCount_full[di]++;
            } else if (r.status === '半休(有給)') {
              cellValue = '半休(有給)';
              cellStyle = 'halfDayPaid';
              if (cin && cout) {
                const [h1, m1] = cin.split(':').map(Number);
                const [h2, m2] = cout.split(':').map(Number);
                h = (h2 + m2/60) - (h1 + m1/60);
                if (h > 0) totalHours += h;
              }
              workedDays += 0.5;
              dailyPresentCount_all[di]++;
              if (isPartTime) dailyPresentCount_part[di]++;
              else dailyPresentCount_full[di]++;
            } else if (r.status === '休日出勤') {
              cellValue = '休日出勤';
              cellStyle = 'holidayWork';
              if (cin && cout) {
                const [h1, m1] = cin.split(':').map(Number);
                const [h2, m2] = cout.split(':').map(Number);
                h = (h2 + m2/60) - (h1 + m1/60);
                // 月次勤怠入力と同じ: 休日出勤は 6時間以下なら休憩なし (6時間ちょうどは引かない)
                if (h > 6) h -= 1;
                if (h > 0) totalHours += h;
              }
              workedDays++;
              dailyPresentCount_all[di]++;
              if (isPartTime) dailyPresentCount_part[di]++;
              else dailyPresentCount_full[di]++;
            } else if (!cin && !cout && r.status === '出勤') {
              cellValue = '未';
              cellStyle = 'absentText'; // Blue text
            } else {
              cellValue = r.status === '振替出勤' ? '振替出勤' : (r.status === '代替出勤' ? '代替出勤' : '出勤');
              cellStyle = 'present'; // Green text
              
              if (cin && cout) {
                const [h1, m1] = cin.split(':').map(Number);
                const [h2, m2] = cout.split(':').map(Number);
                h = (h2 + m2/60) - (h1 + m1/60);
                // Auto subtract 1h break. 休日の 振替出勤/代替出勤 は休日出勤と同じく 6時間以下なら休憩なし
                if (r.isHolidayWork ? h > 6 : h >= 6) h -= 1;
                if (h > 0) totalHours += h;
              }

              if (!isPartTime && !r.isHolidayWork) {
                const lateThreshold = dept.includes('工事') ? '08:00' : '09:00';
                if (cin && cin > lateThreshold) {
                  isLate = 1;
                  lateCount++;
                  cellStyle = 'late'; // Green text, yellow bg
                }
              }
              workedDays++;
              dailyPresentCount_all[di]++;
              if (isPartTime) dailyPresentCount_part[di]++;
              else dailyPresentCount_full[di]++;
            }
          } else if (r.status === '有給' || r.status === '休暇' || r.status === '病欠') {
            cellValue = r.status;
            cellStyle = 'paidLeave';
          } else if (r.status === '無給休暇') {
            cellValue = '無給休暇';
            cellStyle = 'unpaidLeave';
          } else if (r.status === '代替休日') {
            cellValue = '代替休日';
            cellStyle = 'substituteHoliday';
          } else if (r.status === '休日') {
            cellValue = '休日';
            cellStyle = 'weekend'; // Red text
          } else {
            if (!r.isOff) {
               cellValue = '未';
               cellStyle = 'absentText'; // Blue text
            } else {
               cellValue = '';
               cellStyle = 'weekend'; // Actually empty, weekend style is fine
            }
          }

          s1Cells_type.push({ v: cellValue, s: cellStyle });

          if (r.status === '出勤' || r.status === '休日出勤' || r.work || r.site || r.cin || r.cout) {
             const rowData = {
               cells: [ d, dowJa(d), code, name, r.status || '', r.cin || '', r.cout || '', r.site || '', r.work || '', { v: isLate, t: 'n' }, { v: Math.round(Math.max(0, h) * 10) / 10, t: 'n' } ]
             };
             if (isPartTime) s2Rows_part.push(rowData);
             else s2Rows_full.push(rowData);
          }
        }

        if (isPartTime) {
          s1Cells_all.push('-', '-'); // No expected hours for part-time
        } else {
          s1Cells_all.push(expectedWorkDays, expectedWorkDays * 8); // 8 hours per day for full-time
        }

        const lastDayColLetter = getColName(5 + dates.length);
        const rowIdx = (isPartTime ? s1Rows_part.length : s1Rows_full.length) + 2;
        s1Cells_type.push({ v: `COUNTIF(F${rowIdx}:${lastDayColLetter}${rowIdx}, "出勤")`, f: true, s: 'cell' });
        
        const sheetName = isPartTime ? `アルバイト詳細_${qMonth}` : `正社員詳細_${qMonth}`;
        s1Cells_type.push({ v: `SUMIF('${sheetName}'!C:C, A${rowIdx}, '${sheetName}'!J:J)`, f: true, s: 'cell' });
        s1Cells_type.push({ v: `SUMIF('${sheetName}'!C:C, A${rowIdx}, '${sheetName}'!K:K)`, f: true, s: 'cell' });
        
        userRows_all.push(s1Cells_all);
        if (isPartTime) s1Rows_part.push({ cells: [...s1Cells_type] });
        else s1Rows_full.push({ cells: [...s1Cells_type] });
      }

      userRows_all.push([ { v: '合計', s: 'headerGrey' }, { v: `社員数: ${users.length}名`, s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' }, { v: '', s: 'headerGrey' } ]);

      const legendData = [
        [{ v: '未', s: 'absentText' }, { v: '未打刻（出勤予定日）', s: 'legend' }],
        [{ v: '休日', s: 'weekend' }, { v: '所定休日', s: 'legend' }],
        [{ v: '出勤', s: 'present' }, { v: '定時出勤', s: 'legend' }],
        [{ v: '有給', s: 'paidLeave' }, { v: '休暇取得', s: 'legend' }],
        [{ v: '出勤', s: 'late' }, { v: '遅刻', s: 'legend' }],
        [{ v: '半休', s: 'halfDay' }, { v: '半日出勤', s: 'legend' }],
        [{ v: '半休(有給)', s: 'halfDayPaid' }, { v: '半日有給', s: 'legend' }],
        [{ v: '休日出勤', s: 'holidayWork' }, { v: '休日に出勤', s: 'legend' }],
        [{ v: '欠勤', s: 'absent' }, { v: '無断欠勤', s: 'legend' }],
        [{ v: '代替休日', s: 'substituteHoliday' }, { v: '振替休日', s: 'legend' }],
        [{ v: '無給休暇', s: 'unpaidLeave' }, { v: '無給の休暇', s: 'legend' }]
      ];

      const maxRows = Math.max(userRows_all.length, legendData.length);
      for (let i = 0; i < maxRows; i++) {
        const rowCells = userRows_all[i] ? [...userRows_all[i]] : ['', '', '', '', '', '', ''];
        while (rowCells.length < 7) rowCells.push('');
        
        rowCells.push(''); // Spacer H
        if (i < legendData.length) {
          rowCells.push(legendData[i][0], legendData[i][1]);
        }
        s1Rows_all.push({ cells: rowCells });
      }

      const buildBottomRow = (countArr, countStr, rowsCount) => {
        const bottomRowCells = [
          { v: '合計', s: 'headerGrey' },
          { v: countStr, s: 'headerGrey' },
          { v: '', s: 'headerGrey' },
          { v: '', s: 'headerGrey' },
          { v: '', s: 'headerGrey' }
        ];
        for (let di = 0; di < dates.length; di++) {
          const colLetter = getColName(6 + di); // F is 6
          const formula = `COUNTIF(${colLetter}2:${colLetter}${rowsCount + 1}, "出勤") & "名"`;
          bottomRowCells.push({ v: formula, f: true, s: 'headerGrey' });
        }
        return { cells: bottomRowCells };
      };

      s1Rows_full.push(buildBottomRow(dailyPresentCount_full, `社員数: ${s1Rows_full.length}名`, s1Rows_full.length));
      s1Rows_part.push(buildBottomRow(dailyPresentCount_part, `社員数: ${s1Rows_part.length}名`, s1Rows_part.length));

      buf = await buildXlsxBook({
        sheets: [
          { name: `全社員サマリー_${qMonth}`, columns: s1Cols_all, rows: s1Rows_all, headerStyleKey: 'header' },
          { name: `正社員サマリー_${qMonth}`, columns: s1Cols_type, rows: s1Rows_full, headerStyleKey: 'header' },
          { name: `アルバイトサマリー_${qMonth}`, columns: s1Cols_type, rows: s1Rows_part, headerStyleKey: 'header' },
          { name: `正社員詳細_${qMonth}`, columns: s2Cols, rows: s2Rows_full, headerStyleKey: 'header' },
          { name: `アルバイト詳細_${qMonth}`, columns: s2Cols, rows: s2Rows_part, headerStyleKey: 'header' }
        ]
      });
    } else {
      const rows = [];
      for (const d of dates) {
        for (const u of (users || [])) {
          const r = buildRow(u, d);
          rows.push({
            isOff: r.isOff,
            cells: [
              d,
              dowJa(d),
              r.code,
              r.name,
              r.dept,
              r.status,
              r.wt === 'onsite' ? '✓' : '',
              r.wt === 'remote' ? '✓' : '',
              r.wt === 'satellite' ? '✓' : '',
              r.site,
              r.work,
              r.lateMinutes > 0 ? r.lateMinutes : '',
              r.earlyMinutes > 0 ? r.earlyMinutes : '',
              r.reason
            ]
          });
        }
      }

      const columns = [
        { header: '日付', width: 12 },
        { header: '曜日', width: 6 },
        { header: '社員番号', width: 12 },
        { header: '氏名', width: 14 },
        { header: '部署', width: 22 },
        { header: '勤務区分', width: 12 },
        { header: '出社', width: 8 },
        { header: '在宅', width: 8 },
        { header: '現場', width: 10 },
        { header: '現場（任意）', width: 18 },
        { header: '作業内容', width: 52 },
        { header: '遅刻', width: 8 },
        { header: '早退', width: 8 },
        { header: '理由', width: 15 }
      ];

      const baseName = period === 'year' ? `年次_${qYear}` : `日次_${start}`;
      buf = await buildXlsx({ sheetName: baseName, columns, rows });
    }
    
    // Auto save to Cloudflare R2
    try {
      if (s3Service.isR2Configured()) {
        const timestamp = Date.now();
        const r2Key = `exports/work_reports/${fileName.replace('.xlsx', '')}_${timestamp}.xlsx`;
        await s3Service.uploadToR2(r2Key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        console.log(`[Admin] Auto-saved work report export to R2: ${r2Key}`);
      }
    } catch (e) {
      console.error('Failed to auto-save work report export to R2:', e);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /export-daily?date=YYYY-MM-DD&format=xlsx|pdf
 * 日次勤怠記録を Excel または PDF でエクスポート
 * ──────────────────────────────────────────────────────────────────────────── */
router.get('/export-daily',
  rateLimitNamed('workreports_export_daily', { windowMs: 60_000, max: 20 }),
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const qDate = isISODate(req.query.date) ? String(req.query.date).slice(0, 10) : todayJST();
      const format = String(req.query.format || 'xlsx').toLowerCase();
      if (!['xlsx', 'pdf'].includes(format)) {
        return res.status(400).json({ message: 'format は xlsx または pdf を指定してください' });
      }
      // 画面（勤怠記録（日別））と同じ一覧を使う（状態・遅刻/早退・追加勤務・理由・備考 が画面と一致）
      const { buildDailyRoster } = require('./workReports.admin.routes');
      const { items } = await buildDailyRoster(req, qDate);
      const dailyExport = require('./workReports.dailyExport');
      const { rows, counts } = dailyExport.toRows(items || [], qDate);
      let companyName = '';
      try {
        if (req.tenantId) {
          const [[t]] = await db.query('SELECT name FROM tenants WHERE id = ? LIMIT 1', [req.tenantId]);
          companyName = String(t?.name || '');
        }
      } catch (e) { /* 会社名は無くても出力する */ }
      if (format === 'xlsx') return await dailyExport.writeXlsx(res, { date: qDate, rows, counts, companyName });
      return dailyExport.writePdf(res, { date: qDate, rows, counts, companyName });
    } catch (err) {
      console.error('[export-daily] error:', err);
      if (!res.headersSent) res.status(500).json({ message: err.message || 'export failed' });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /export.pdf?period=month&month=YYYY-MM&sort=...&dept=...&q=...
 * 月次作業報告を PDF でエクスポート (A4 横向き)
 * ──────────────────────────────────────────────────────────────────────────── */
router.get('/export.pdf',
  rateLimitNamed('workreports_export_pdf', { windowMs: 60_000, max: 10 }),
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const qMonth   = String(req.query.month || '').slice(0, 7) || todayJST().slice(0, 7);
      const qSort    = String(req.query.sort  || 'dateDesc');
      const qDept    = String(req.query.dept  || '');
      const qQ       = String(req.query.q     || '').toLowerCase();
      const qGroup   = req.query.group === '1';
      const qUserIdsRaw = String(req.query.userIds || '').trim();
      const qUserIds = qUserIdsRaw
        ? qUserIdsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
        : [];

      const _tid     = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
      const roleScope = roleScopeSql(req, 'u');
      const tenantP  = _tid ? [_tid] : [];
      const tenantUserClause = _tid ? ' AND userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';
      const userIdsClause = qUserIds.length ? ` AND u.id IN (${qUserIds.map(() => '?').join(',')})` : '';
      const userIdsClauseAtt = qUserIds.length ? ` AND userId IN (${qUserIds.map(() => '?').join(',')})` : '';
      const userIdsP = qUserIds;

      const start = `${qMonth}-01`;
      const end   = (() => {
        const [y, m] = qMonth.split('-').map(Number);
        return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      })();

      // ── データ取得 ────────────────────────────────────────────────
      const [users] = await db.query(`
        SELECT u.id AS userId, u.employee_code AS employeeCode, u.username,
               d.name AS departmentName, b.name AS branchName
        FROM   users u
        LEFT JOIN departments d ON d.id = u.departmentId
        LEFT JOIN branches    b ON b.id = u.branch_id
        WHERE  u.employment_status = 'active' ${roleScope}
               ${_tid ? 'AND u.tenant_id = ?' : ''}
               ${userIdsClause}
        ORDER  BY COALESCE(u.employee_code,'') ASC, u.id ASC
      `, [...tenantP, ...userIdsP]);

      const [attRows] = await db.query(`
        SELECT userId, DATE(COALESCE(checkIn,checkOut)) AS date, checkIn, checkOut, work_type
        FROM attendance
        WHERE DATE(COALESCE(checkIn,checkOut)) >= ? AND DATE(COALESCE(checkIn,checkOut)) <= ?${tenantUserClause}${userIdsClauseAtt}
      `, [start, end, ...tenantP, ...userIdsP]);

      const [repRows] = await db.query(`
        SELECT userId, date, site, work, work_type
        FROM work_reports WHERE date >= ? AND date <= ?${tenantUserClause}${userIdsClauseAtt}
      `, [start, end, ...tenantP, ...userIdsP]);

      const [dailyRows] = await db.query(`
        SELECT userId, date, kubun, late_minutes, early_minutes, reason, memo, location
        FROM attendance_daily WHERE date >= ? AND date <= ?${tenantUserClause}${userIdsClauseAtt}
      `, [start, end, ...tenantP, ...userIdsP]);
      // 休日出勤日の遅刻・早退は出さない (月次勤怠入力画面と同じ。DBは変更しない)
      await suppressHolidayWorkLateEarly(dailyRows, req.tenantId || 0);

      const attMap   = new Map(attRows.map(a   => [`${a.userId}|${String(a.date).slice(0,10)}`, a]));
      const repMap   = new Map(repRows.map(r   => [`${r.userId}|${String(r.date).slice(0,10)}`, r]));
      const dailyMap = new Map(dailyRows.map(d => [`${d.userId}|${String(d.date).slice(0,10)}`, d]));

      const fmtHm = dt => dt ? String(dt).length >= 16 ? String(dt).slice(11,16) : String(dt) : '';
      const wtLbl = wt => wt === 'onsite' ? '出社' : wt === 'remote' ? '在宅' : wt === 'satellite' ? '現場' : '';
      const dowJa = ds => { const [y,m,d]=String(ds).slice(0,10).split('-').map(Number); return ['日','月','火','水','木','金','土'][new Date(Date.UTC(y,m-1,d)).getUTCDay()]||''; };

      // ── 行データ構築 ──────────────────────────────────────────────
      let items = [];
      for (const u of users) {
        const uid  = Number(u.userId);
        const dept = u.departmentName || '';
        const branch = u.branchName || '';
        const code = u.employeeCode || `EMP${String(uid).padStart(3,'0')}`;
        const name = u.username || '';
        for (let dt = new Date(start+'T00:00:00Z'); dt <= new Date(end+'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate()+1)) {
          const ds   = dt.toISOString().slice(0,10);
          const key  = `${uid}|${ds}`;
          const att  = attMap.get(key);
          const rep  = repMap.get(key);
          const daily = dailyMap.get(key);
          if (!att && !rep && !daily) continue; // skip empty days
          const wt = String(rep?.work_type || att?.work_type || daily?.work_type || '').trim();
          const site = [daily?.location, rep?.site].find(v => v && String(v).trim()) || '';
          const work = [daily?.memo, rep?.work].find(v => v && String(v).trim()) || '';
          const notes = String(daily?.notes || daily?.reason || rep?.notes || '').trim();
          // 状態を判定
          const hasContent = !!(site || work);
          const hasOut = !!att?.checkOut;
          const todayDs = new Date(Date.now()+9*3600*1e3).toISOString().slice(0,10);
          const kubunVal = daily?.kubun || '';
          let statusLbl = '';
          if (kubunVal === '休日' || kubunVal === '有給休暇' || kubunVal === '特別休暇') {
            statusLbl = kubunVal;
          } else if (!att && !hasContent) {
            statusLbl = ds <= todayDs ? '未提出' : '';
          } else if (att && hasOut && hasContent) {
            statusLbl = '提出済';
          } else if (att && hasOut && !hasContent) {
            statusLbl = '未提出';
          } else if (att && !hasOut && hasContent) {
            statusLbl = '退勤漏れ(入力済)';
          } else if (att && !hasOut && !hasContent) {
            statusLbl = ds < todayDs ? '退勤漏れ' : '勤務中';
          } else if (!att && hasContent) {
            statusLbl = '未打刻';
          }
          items.push({
            date: ds, weekday: dowJa(ds),
            code, name, dept, branch,
            kubun: kubunVal,
            cin:   fmtHm(att?.checkIn),
            cout:  fmtHm(att?.checkOut),
            wt:    wtLbl(wt),
            site,
            work,
            late:  daily?.late_minutes > 0 ? `遅刻${daily.late_minutes}分` : daily?.early_minutes > 0 ? `早退${daily.early_minutes}分` : '',
            notes,
            status: statusLbl,
          });
        }
      }

      // フィルター・ソート
      if (qDept)  items = items.filter(r => r.dept === qDept);
      if (qQ)     items = items.filter(r => r.code.toLowerCase().includes(qQ) || r.name.toLowerCase().includes(qQ));
      if (qSort === 'employee' || qSort === 'name') items.sort((a,b)=>a.code.localeCompare(b.code));
      else if (qSort === 'department') items.sort((a,b)=>a.dept.localeCompare(b.dept)||a.date.localeCompare(b.date));
      else items.sort((a,b)=>b.date.localeCompare(a.date)||a.code.localeCompare(b.code)); // dateDesc

      // ── PDF 生成 (Playwright HTML→PDF) ───────────────────────────
      const { chromium } = require('playwright');
      const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

      const escH = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      const statusStyle = s => {
        if (s === '提出済') return 'color:#0b2c66;font-weight:600;';
        if (s === '未提出' || s === '未打刻') return 'color:#dc2626;font-weight:600;';
        if (s === '退勤漏れ' || s === '退勤漏れ(入力済)') return 'color:#d97706;font-weight:600;';
        if (s === '勤務中') return 'color:#16a34a;font-weight:600;';
        if (s === '休日' || s === '有給休暇' || s === '特別休暇') return 'color:#64748b;';
        return '';
      };

      // 1人選択時: 社員番号・氏名・部署列を非表示にしてヘッダーに表示
      const isSingleUser = qUserIds.length === 1 && users.length === 1;
      const singleUser = isSingleUser ? users[0] : null;
      const singleUserInfo = singleUser
        ? `${escH(singleUser.employeeCode || `EMP${String(singleUser.userId).padStart(3,'0')}`)}　${escH(singleUser.username || '')}　${escH(singleUser.departmentName || '')}`
        : '';

      const rowsHtml = items.map((r, i) => {
        const isOff = r.kubun === '休日' || r.kubun === '有給休暇' || r.kubun === '特別休暇';
        const rowBg = isOff ? '#fff5f5' : (i % 2 === 0 ? '#f8fafc' : '#ffffff');
        const userCols = isSingleUser ? '' : `
          <td class="center">${escH(r.code)}</td>
          <td>${escH(r.name)}</td>
          <td>${escH(r.dept)}</td>`;
        const dayNum = String(parseInt(r.date.slice(8, 10), 10));
        return `<tr style="background:${rowBg};">
          <td class="center muted">${dayNum}</td>
          <td class="center muted">${escH(r.weekday)}</td>
          ${userCols}
          <td class="center">${escH(r.kubun)}</td>
          <td class="center">${escH(r.cin)}</td>
          <td class="center">${escH(r.cout)}</td>
          <td class="center">${escH(r.wt)}</td>
          <td class="center">${escH(r.site)}</td>
          <td class="work-cell">${escH(r.work)}</td>
          <td class="center">${escH(r.late)}</td>
          <td class="note-cell">${escH(r.notes||'')}</td>
          <td class="center" style="${statusStyle(r.status)}">${escH(r.status||'')}</td>
        </tr>`;
      }).join('');

      const colCount = isSingleUser ? 11 : 14;
      const colGroupHtml = isSingleUser
        ? `<col class="c-date"><col class="c-dow"><col class="c-kubun"><col class="c-cin"><col class="c-cout"><col class="c-wt"><col class="c-site"><col class="c-work"><col class="c-late"><col class="c-note"><col class="c-status">`
        : `<col class="c-date"><col class="c-dow"><col class="c-code"><col class="c-name"><col class="c-dept"><col class="c-kubun"><col class="c-cin"><col class="c-cout"><col class="c-wt"><col class="c-site"><col class="c-work"><col class="c-late"><col class="c-note"><col class="c-status">`;
      const theadHtml = isSingleUser
        ? `<th>日付</th><th>曜</th><th>勤務区分</th><th>出勤</th><th>退勤</th><th>形態</th><th>現場</th><th>作業内容</th><th>遅刻等</th><th>備考</th><th>状態</th>`
        : `<th>日付</th><th>曜</th><th>社員番号</th><th>氏名</th><th>部署</th><th>勤務区分</th><th>出勤</th><th>退勤</th><th>形態</th><th>現場</th><th>作業内容</th><th>遅刻等</th><th>備考</th><th>状態</th>`;
      const headerRightHtml = isSingleUser
        ? `<div class="report-meta">${singleUserInfo}<br>${items.length}件　出力日時: ${escH(nowStr)}</div>`
        : `<div class="report-meta">${items.length}件　出力日時: ${escH(nowStr)}</div>`;

      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  @font-face { font-family:'JP'; src:local('Meiryo'),local('Yu Gothic'),url('file:///C:/Windows/Fonts/NotoSansJP-VF.ttf') format('truetype'); }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'JP','Meiryo','Yu Gothic','MS Gothic',sans-serif;font-size:7.5pt;color:#1e293b;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page-wrap{padding:8mm 8mm 6mm 8mm;}
  .report-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px;padding-bottom:3px;border-bottom:2px solid #1e4d8c;}
  .report-title{font-size:11pt;font-weight:700;color:#1e293b;}
  .report-meta{font-size:7pt;color:#64748b;text-align:right;line-height:1.4;}
  table{width:100%;border-collapse:collapse;font-size:6.5pt;table-layout:fixed;}
  col.c-date{width:20px;} col.c-dow{width:13px;}
  col.c-code{width:50px;} col.c-name{width:56px;} col.c-dept{width:52px;}
  col.c-kubun{width:52px;} col.c-cin{width:40px;} col.c-cout{width:40px;}
  col.c-wt{width:26px;} col.c-site{width:95px;} col.c-work{width:auto;}
  col.c-late{width:36px;} col.c-note{width:65px;} col.c-status{width:50px;}
  thead th{background:#1e4d8c;color:#fff;font-weight:600;font-size:6pt;padding:3px 2px;text-align:center;border:1px solid #2563ab;white-space:nowrap;overflow:hidden;}
  /* All cells: 1 line, no wrap — except work-cell */
  tbody td{padding:2px 3px;border-bottom:1px solid #e2e8f0;border-left:1px solid #f1f5f9;vertical-align:top;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  /* 作業内容: wrap fully, show all content */
  tbody td.work-cell{white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;overflow:visible;}
  tbody tr:last-child td{border-bottom:1px solid #cbd5e1;}
  tbody tr{page-break-inside:avoid;}
  .center{text-align:center;vertical-align:middle;} .muted{color:#64748b;} .note-cell{color:#475569;}
  .empty-msg{text-align:center;padding:20px;color:#94a3b8;font-size:10pt;}
  @page{size:A4 landscape;margin:0;}
  @media print{thead{display:table-header-group;}}
</style>
</head>
<body>
<div class="page-wrap">
  <div class="report-header">
    <div class="report-title">作業報告 ${escH(qMonth)}</div>
    ${headerRightHtml}
  </div>
  <table>
    <colgroup>${colGroupHtml}</colgroup>
    <thead><tr>${theadHtml}</tr></thead>
    <tbody>
      ${items.length ? rowsHtml : `<tr><td colspan="${colCount}" class="empty-msg">データなし</td></tr>`}
    </tbody>
  </table>
</div>
</body>
</html>`;

      const browser = await chromium.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-web-security'],
      });
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1122, height: 5000 });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(300);
      const pdfBuf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        scale: 1,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      await browser.close();

      // ファイル名: 月_社員コード_氏名.pdf (1名) または 月_作業報告.pdf (複数)
      const safeStr = s => String(s||'').replace(/[\\\/:*?"<>|]/g,'_').trim();
      let pdfFilename;
      if (qUserIds.length === 1 && users.length === 1) {
        const u = users[0];
        const code = safeStr(u.employeeCode || `EMP${String(u.userId).padStart(3,'0')}`);
        const name = safeStr(u.username || '');
        pdfFilename = `work_reports_${qMonth}_${code}${name ? '_'+name : ''}.pdf`;
      } else {
        pdfFilename = `work_reports_${qMonth}_作業報告.pdf`;
      }
      const encoded = encodeURIComponent(pdfFilename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
      res.send(pdfBuf);
    } catch (err) {
      console.error('[export.pdf] error:', err);
      if (!res.headersSent) res.status(500).json({ message: err.message || 'export failed' });
    }
  }
);

module.exports = router;
