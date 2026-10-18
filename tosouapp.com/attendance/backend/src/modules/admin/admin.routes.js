const express = require('express');
const router = express.Router();
// NOTE: This file is 2356 lines. Planned split (future refactor):
//   - admin.users.routes.js (lines 70-170) — CRUD users, employee photos
//   - admin.salary.routes.js (lines 1170-1800) — salary calc, payslip, PDF
//   - admin.calendar.routes.js (lines 1800-2100) — calendar export CSV/iCal/XML
//   - admin.debug.routes.js (lines 2100+) — debug/backfill endpoints
// Current approach: keep as-is for stability (700 users in production).
const { authenticate, authorize, invalidateUserCache } = require('../../core/middleware/authMiddleware');
const { permit } = require('../../core/middleware/rbac');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
const userCtrl = require('../users/user.controller');
const deptRoutes = require('../departments/department.routes');
const corpRoutes = require('../corporations/corporation.routes');
const settingsRoutes = require('../settings/settings.routes');
const auditRepo = require('../audit/audit.repository');
const attendanceService = require('../attendance/attendance.service');
const attendanceRepo = require('../attendance/attendance.repository');
const userRepo = require('../users/user.repository');
const authRepo = require('../auth/auth.repository');
const calendarRepo = require('../calendar/calendar.repository');
const { getDepartmentOffDaySet } = require('../attendance/attendance.utils');
const { companyName, payslipEncKey, payslipKeyVersion } = require('../../config/env');
const { rateLimit, rateLimitNamed } = require('../../core/middleware/rateLimit');
const salaryService = require('../salary/salary.service');
const salaryInputRepo = require('../salary/salaryInput.repository');
const payslipRepo = require('../payslip/payslip.repository');
const noticesRepo = require('../notices/notices.repository');
const db = require('../../core/database/mysql');
const { uploadMemory, safeFilename } = require('../../core/middleware/uploadR2');
const fileStore = require('../../core/services/fileStore.service');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const s3Service = require('../../core/services/s3.service');
const metrics = require('../../core/metrics');
const { buildPayslipPdf } = require('../salary/payslipPdf');
// SECURITY: debug routes are only available outside production.
// ENABLE_DEBUG_ROUTES is intentionally ignored to prevent accidental exposure.
const allowDebugRoutes = process.env.NODE_ENV !== 'production';

function recordEndpointPerf(endpoint, startedAt, meta = {}) {
  const durationMs = Date.now() - startedAt;
  try {
    metrics.observe(`${endpoint}_duration_ms`, durationMs);
    if (durationMs >= 100) metrics.inc(`${endpoint}_slow_count`, 1);
  } catch (e) { /* silently ignored */ }
  if (durationMs >= 100) {
    try {
      console.warn(JSON.stringify({ level: 'warn', type: 'slow_endpoint', endpoint, duration_ms: durationMs, ...meta }));
    } catch (e) { /* silently ignored */ }
  }
}

/**
 * Returns SQL fragment + params to filter by tenant_id when multi-tenant is enabled.
 * Usage: const { clause, params } = tenantClause(req, 'u');
 *        WHERE ...other conditions... ${clause}
 *        params: [...otherParams, ...params]
 */
function tenantClause(req, alias = '') {
  const tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
  if (!tid) return { clause: '', params: [] };
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return { clause: `AND ${col} = ?`, params: [tid] };
}

const uploadEmployeePhotos = (req, res, next) => {
  uploadMemory.array('files', 12)(req, res, (err) => {
    if (!err) return next();
    const msg = String(err?.message || 'Upload failed');
    const code = /file too large/i.test(msg) ? 413 : 400;
    return res.status(code).json({ message: msg });
  });
};

async function ensureEmployeeProfilePhotosSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS employee_profile_photos (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        url VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NULL,
        mime_type VARCHAR(100) NULL,
        size_bytes BIGINT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_created (userId, created_at),
        CONSTRAINT fk_employee_profile_photos_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) { /* silently ignored */ }
}
// Admin tổng hợp
router.use(authenticate, resolveTenant);

// Đối tượng userId lấy từ body/query/params phải thuộc đúng công ty (tenant) của
// người gọi — nếu không, admin công ty A thao tác được lên nhân viên công ty B.
async function userInTenant(req, userId) {
  if (!userId) return false;
  return !!(await userRepo.getUserById(userId, req.tenantId || null));
}
// Users
router.get('/users', authorize('admin','manager'), userCtrl.list);
router.get('/users/:id', authorize('admin','manager'), async (req, res) => {
  try {
    const id = req.params.id;
    // Verify user belongs to current tenant
    const row = await userRepo.getUserById(id, req.tenantId || null);
    if (!row) return res.status(404).json({ message: 'User not found' });
    // RBAC: Manager chỉ xem được thông tin employee
    const requesterRole = String(req.user?.role || '').toLowerCase();
    if (requesterRole === 'manager' && String(row.role || '').toLowerCase() !== 'employee') {
      return res.status(403).json({ message: 'Forbidden: managers can only view employees' });
    }
    res.status(200).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/users', async (req, res, next) => {
  try {
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, rateLimitNamed('admin_users_create', { windowMs: 60_000, max: 10 }), authorize('admin'), userCtrl.create);
router.patch('/users/:id', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_update', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, rateLimitNamed('admin_users_update', { windowMs: 60_000, max: 30 }), authorize('admin'), userCtrl.update);
router.delete('/users/:id', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    const superEmail = process.env.SUPER_ADMIN_EMAIL;
    if (before?.email === superEmail) {
      return res.status(403).json({ message: 'Cannot delete SUPER_ADMIN user' });
    }
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_delete', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: null });
  } catch (e) { /* silently ignored */ }
  next();
}, rateLimitNamed('admin_users_delete', { windowMs: 60_000, max: 10 }), authorize('admin'), userCtrl.remove);
// Employees alias
router.get('/employees', authorize('admin'), userCtrl.list);
router.get('/employees/:id', permit('employees','view'), async (req, res) => {
  try {
    const id = req.params.id;
    // Verify employee belongs to current tenant
    const row = await userRepo.getUserById(id, req.tenantId || null);
    if (!row) return res.status(404).json({ message: 'Employee not found' });
    // ログイン時に実際に使われる役割は tenant_users.role_in_tenant（users.role より優先）。
    // 編集画面がこれを表示しないと、画面上は「従業員」なのに実際はマネージャーとしてログインできる、
    // という食い違いが見えなくなるため、tenant_role として一緒に返す。
    if (req.tenantId) {
      try {
        const [[tu]] = await db.query('SELECT role_in_tenant FROM tenant_users WHERE user_id = ? AND tenant_id = ? LIMIT 1', [id, req.tenantId]);
        if (tu && tu.role_in_tenant) row.tenant_role = String(tu.role_in_tenant).trim().toLowerCase();
      } catch (e) { /* tenant_users が無い環境では users.role のみ */ }
    }
    res.status(200).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/employees/:id/export.xlsx', permit('employees','view'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const tenantId = req.tenantId || 1; // fallback cho legacy single-tenant
    // Verify employee belongs to current tenant
    const target = await userRepo.getUserById(id, tenantId);
    if (!target) return res.status(404).json({ message: 'Employee not found' });

    if (String(req.user?.role).toLowerCase() === 'manager'
        && String(process.env.MANAGER_STRICT_DEPT || '').toLowerCase() === 'true') {
      const me = await userRepo.getUserById(req.user.id, tenantId);
      const myDept = me?.departmentId;
      if (!myDept || String(target.departmentId) !== String(myDept)) {
        return res.status(403).json({ message: 'Managers can only view employees in their own department' });
      }
    }

    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    const year = parseInt(String(req.query.year || nowJst.getUTCFullYear()), 10) || nowJst.getUTCFullYear();
    const start = `${String(year).padStart(4, '0')}-01-01`;
    const end = `${String(year).padStart(4, '0')}-12-31`;

    const [[info]] = await db.query(`
      SELECT
        u.*,
        d.name AS departmentName,
        m.username AS managerName,
        m.employee_code AS managerEmployeeCode
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId AND d.tenant_id = u.tenant_id
      LEFT JOIN users m ON m.id = u.manager_id AND m.tenant_id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ?
      LIMIT 1
    `, [id, tenantId]);

    const [attRows] = await db.query(`
      SELECT id, checkIn, checkOut, work_type, labels, shiftId
      FROM attendance
      WHERE userId = ? AND tenant_id = ?
        AND DATE(checkIn) >= ? AND DATE(checkIn) <= ?
      ORDER BY checkIn ASC
    `, [id, tenantId, start, end]);

    const [repRows] = await db.query(`
      SELECT date, work_type, site, work, updated_at
      FROM work_reports
      WHERE userId = ? AND tenant_id = ?
        AND date >= ? AND date <= ?
      ORDER BY date ASC
    `, [id, tenantId, start, end]);

    const [leaveRows] = await db.query(`
      SELECT type, status, startDate, endDate, reason, created_at
      FROM leave_requests
      WHERE userId = ? AND tenant_id = ?
        AND endDate >= ? AND startDate <= ?
      ORDER BY startDate ASC, created_at ASC
    `, [id, tenantId, start, end]);
// cái hàm này dùng để lấy dữ liệu ngày nghỉ của người dùng trong năm đó (khi không có năm thì lấy năm hiện tại)
    const [dailyRows] = await db.query(`
      SELECT date, kubun, location, memo
      FROM attendance_daily
      WHERE userId = ? AND tenant_id = ?
        AND date >= ? AND date <= ?
    `, [id, tenantId, start, end]);

    // Per-department off-day logic — tra department_holidays thật của từng công ty,
    // không hardcode tên bộ phận "工事部" nữa (đã thay bằng cấu hình 休日設定 theo tenant).
    const offSet = await getDepartmentOffDaySet(year, { departmentName: target.departmentName || null, tenantId: tenantId || 0 });
    const isOff = (dateStr) => offSet.has(String(dateStr).slice(0, 10));

    const fmt = (v) => (v == null ? '' : String(v));
    const fmtDate = (v) => String(v || '').slice(0, 10);
    const fmtHm = (v) => {
      if (!v) return '';
      const s = String(v);
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
    const roleLabel = (r) => {
      const s = String(r || '').toLowerCase();
      if (s === 'admin') return '管理者';
      if (s === 'manager') return 'マネージャー';
      if (s === 'employee') return '従業員';
      return r || '';
    };
    const wtLabel = (wt) => wt === 'onsite' ? '出社' : wt === 'remote' ? '在宅' : wt === 'satellite' ? '現場' : '';
    const empTypeLabel = (t) => {
      const s = String(t || '').toLowerCase();
      if (s === 'full_time') return '正社員';
      if (s === 'part_time') return 'パート・アルバイト';
      if (s === 'contract') return '契約社員';
      return t || '';
    };
    const empStatusLabel = (t) => {
      const s = String(t || '').toLowerCase();
      if (s === 'active') return '在籍';
      if (s === 'inactive') return '無効/休職';
      if (s === 'retired') return '退職';
      return t || '';
    };

    const profileRows = [];
    const addKV = (k, v) => { if (String(v ?? '').trim() !== '') profileRows.push({ isOff: false, cells: [k, fmt(v)] }); };
    addKV('ID', info?.id ?? id);
    addKV('社員番号', info?.employee_code);
    addKV('氏名', info?.username);
    addKV('メール', info?.email);
    addKV('部署', info?.departmentName);
    addKV('役割', roleLabel(info?.role));
    addKV('雇用形態', empTypeLabel(info?.employment_type));
    addKV('雇用状態', empStatusLabel(info?.employment_status));
    addKV('レベル', info?.level);
    addKV('直属マネージャー', info?.managerName || info?.managerEmployeeCode ? `${info?.managerEmployeeCode || ''} ${info?.managerName || ''}`.trim() : '');
    addKV('入社日', fmtDate(info?.hire_date));
    addKV('参加日', fmtDate(info?.join_date));
    addKV('試用期間', fmtDate(info?.probation_date));
    addKV('正式日', fmtDate(info?.official_date));
    addKV('契約終了', fmtDate(info?.contract_end));
    addKV('基本給', info?.base_salary);
    addKV('シフトID', info?.shift_id);
    addKV('電話', info?.phone);
    addKV('生年月日', fmtDate(info?.birth_date));
    addKV('性別', info?.gender);
    addKV('住所', info?.address);
    addKV('言語', info?.lang);
    addKV('地域', info?.region);
    addKV('タイムゾーン', info?.timezone);
    addKV('在留番号', info?.visa_number);
    addKV('在留期限', fmtDate(info?.visa_expiry));
    addKV('保険番号', info?.insurance_number);

    const dailyMap = new Map();
    for (const r of dailyRows || []) {
      dailyMap.set(fmtDate(r.date), { kubun: r.kubun, location: r.location, memo: r.memo });
    }

    const attMap = new Map();
    for (const a of attRows || []) {
      const d = fmtDate(a.checkIn);
      if (!d) continue;
      if (!attMap.has(d)) attMap.set(d, []);
      attMap.get(d).push(a);
    }

    const wrMap = new Map();
    for (const r of repRows || []) {
      const d = fmtDate(r.date);
      if (!d) continue;
      if (!wrMap.has(d)) wrMap.set(d, []);
      wrMap.get(d).push(r);
    }

    const allDates = [];
    const dt0 = new Date(start + 'T00:00:00Z');
    const dt1 = new Date(end + 'T00:00:00Z');
    while (dt0.getTime() <= dt1.getTime()) {
      allDates.push(dt0.toISOString().slice(0, 10));
      dt0.setUTCDate(dt0.getUTCDate() + 1);
    }

    const segRows = [];
    for (const d of allDates) {
      const is_off = isOff(d);
      const dayJa = dowJa(d);
      const daily = dailyMap.get(d) || {};
      const kubun = daily.kubun || '';
      const atts = attMap.get(d) || [];
      if (atts.length === 0) {
        segRows.push({
          isOff: is_off,
          cells: [ d, dayJa, '', '', '', kubun, '', '' ]
        });
      } else {
        for (const a of atts) {
          const dispKubun = kubun || wtLabel(a.work_type);
          segRows.push({
            isOff: is_off,
            cells: [
              d,
              dayJa,
              fmt(a.id),
              fmtHm(a.checkIn),
              fmtHm(a.checkOut),
              dispKubun,
              fmt(a.shiftId),
              fmt(a.labels)
            ]
          });
        }
      }
    }

    const wrRows = [];
    for (const d of allDates) {
      const is_off = isOff(d);
      const dayJa = dowJa(d);
      const daily = dailyMap.get(d) || {};
      const kubun = daily.kubun || '';
      const reps = wrMap.get(d) || [];
      if (reps.length === 0) {
        // Look up site/work from daily attendance if missing in work reports
        const fallbackSite = daily.location || '';
        const fallbackWork = daily.memo || '';
        const hasFallback = fallbackSite || fallbackWork;
        const managerInputStr = hasFallback ? '管理者入力' : '';
        
        wrRows.push({
          isOff: is_off,
          cells: [ d, dayJa, kubun, fallbackSite, fallbackWork, '', managerInputStr ]
        });
      } else {
        for (const r of reps) {
          const dispKubun = kubun || wtLabel(r.work_type);
          wrRows.push({
            isOff: is_off,
            cells: [
              d,
              dayJa,
              dispKubun,
              fmt(r.site),
              fmt(r.work),
              fmtDate(r.updated_at) + (r.updated_at ? ' ' + fmtHm(r.updated_at) : ''),
              ''
            ]
          });
        }
      }
    }

    const lvRows = (leaveRows || []).map(lr => {
      const d0 = fmtDate(lr.startDate);
      return {
        isOff: isOff(d0),
        cells: [
          fmt(lr.status),
          fmt(lr.type),
          fmtDate(lr.startDate),
          fmtDate(lr.endDate),
          fmt(lr.reason),
          fmtDate(lr.created_at)
        ]
      };
    });

    const { buildXlsxBook } = require('../../utils/xlsx');
    const buf = await buildXlsxBook({
      sheets: [
        {
          name: `Profile ${year}`,
          columns: [{ header: '項目', width: 18 }, { header: '値', width: 52 }],
          rows: profileRows
        },
        {
          name: `Segments ${year}`,
          columns: [
            { header: '日付', width: 12 },
            { header: '曜日', width: 6 },
            { header: 'ID', width: 10 },
            { header: '出勤', width: 8 },
            { header: '退勤', width: 8 },
            { header: '勤務区分', width: 12 },
            { header: 'シフト', width: 8 },
            { header: 'Labels', width: 30 }
          ],
          rows: segRows
        },
        {
          name: `WorkReports ${year}`,
          columns: [
            { header: '日付', width: 12 },
            { header: '曜日', width: 6 },
            { header: '勤務区分', width: 12 },
            { header: '現場', width: 18 },
            { header: '作業内容', width: 48 },
            { header: '更新日', width: 18 },
            { header: '管理者入力', width: 14 }
          ],
          rows: wrRows
        },
        {
          name: `Leave ${year}`,
          columns: [
            { header: '状態', width: 10 },
            { header: '種類', width: 10 },
            { header: '開始', width: 12 },
            { header: '終了', width: 12 },
            { header: '理由', width: 36 },
            { header: '申請日', width: 12 }
          ],
          rows: lvRows
        }
      ]
    });

    const targetName = String(info?.username || info?.email || id).replace(/[^\w\s-]/gi, '_');
    const empCode = info?.employee_code ? `${info.employee_code}_` : '';
    const fileName = encodeURIComponent(`${empCode}${targetName}_${year}.xlsx`);
    
    // Auto-save export to R2
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/excel/profile/${ts}_${fileName}`;
      s3Service.uploadToR2(r2Key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/employees', async (req, res, next) => {
  try {
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_employee_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, permit('employees','manage'), async (req, res, next) => {
  try {
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}, userCtrl.create);
router.put('/employees/:id', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_employee_update', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, permit('employees','manage'), async (req, res, next) => {
  try {
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}, userCtrl.update);
router.patch('/employees/:id', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_employee_update', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, permit('employees','manage'), async (req, res, next) => {
  try {
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}, userCtrl.update);
router.delete('/employees/:id', permit('employees','manage'), async (req, res) => {
  try {
    const id = req.params.id;
    const before = await userRepo.getUserById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'User not found' });
    const superEmail = process.env.SUPER_ADMIN_EMAIL;
    if (before?.email === superEmail) {
      return res.status(403).json({ message: 'Cannot deactivate SUPER_ADMIN user' });
    }
    await userRepo.updateUser(id, { employmentStatus: 'inactive' });
    try { await require('../auth/refresh.repository').deleteUserTokens(id); } catch (e) { /* silently ignored */ }
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_employee_deactivate', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify({ employment_status: 'inactive' }) }); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, status: 'inactive' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/employees/:id/avatar', permit('employees','manage'), async (req, res, next) => {
  try {
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}, uploadMemory.single('file'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!req.file || !id) {
      return res.status(400).json({ message: 'Missing file or id' });
    }
    // Target must belong to the caller's tenant — otherwise an admin in tenant A
    // could overwrite the avatar of a user in tenant B just by guessing their id.
    const target = await userRepo.getUserById(id, req.tenantId || null);
    if (!target) return res.status(404).json({ message: 'Employee not found' });
    const filename = safeFilename(req.file);
    await fileStore.storeUploadedFile({ buffer: req.file.buffer, mimetype: req.file.mimetype, tenantId: req.tenantId || null, category: 'avatars', filename });
    const url = `/uploads/${filename}`;
    await userRepo.updateUser(id, { avatarUrl: url, tenantId: req.tenantId || null });
    const downloadUrl = `/api/admin/employees/${id}/avatar/download`;
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_employee_avatar_upload', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ id, avatarUrl: url, originalName: req.file.originalname }) }); } catch (e) { /* silently ignored */ }
    res.status(201).json({ id, url: downloadUrl, originalName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// 生の /uploads パスを直接返さない — 認証済みダウンロードエンドポイント経由でのみアクセスさせる
// (アバター画像は静的配信 /uploads では誰でも認証なしで取得できてしまうため)。
// R2 が設定されていればそこから読み、無ければローカル uploads/ にフォールバック
// (core/services/fileStore.service.js 参照) — Render は永続ディスクを持たないため。
router.get('/employees/:id/avatar/download',
  rateLimitNamed('admin_employee_avatar_download', { windowMs: 60_000, max: 60 }),
  permit('employees','view'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ message: 'Missing id' });
      const target = await userRepo.getUserById(id, req.tenantId || null);
      if (!target || !target.avatar_url) return res.status(404).json({ message: 'Not found' });
      const buffer = await fileStore.readUploadedFile({ tenantId: req.tenantId || null, category: 'avatars', filename: target.avatar_url });
      if (!buffer) return res.status(404).json({ message: 'File not found' });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(buffer);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/employees/:id/photos', permit('employees','view'), async (req, res) => {
  try {
    await ensureEmployeeProfilePhotosSchema();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const target = await userRepo.getUserById(id, req.tenantId || null);
    if (!target) return res.status(404).json({ message: 'Employee not found' });
    const [rows] = await db.query(
      `SELECT id, userId, url, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt
       FROM employee_profile_photos
       WHERE userId = ?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );
    const items = (rows || []).map(r => ({ ...r, url: `/api/admin/employees/photos/${r.id}/download` }));
    res.status(200).json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/employees/:id/photos', permit('employees','manage'), uploadEmployeePhotos, async (req, res) => {
  try {
    await ensureEmployeeProfilePhotosSchema();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const target = await userRepo.getUserById(id, req.tenantId || null);
    if (!target) return res.status(404).json({ message: 'Employee not found' });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: 'No files uploaded' });
    const items = [];
    for (const f of files) {
      const filename = safeFilename(f);
      await fileStore.storeUploadedFile({ buffer: f.buffer, mimetype: f.mimetype, tenantId: req.tenantId || null, category: 'employee-photos', filename });
      const url = `/uploads/${filename}`;
      const [ins] = await db.query(
        `INSERT INTO employee_profile_photos (userId, url, original_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?)`,
        [id, url, String(f.originalname || ''), String(f.mimetype || ''), Number(f.size || 0)]
      );
      items.push({ id: ins.insertId, url: `/api/admin/employees/photos/${ins.insertId}/download`, originalName: f.originalname, mimeType: f.mimetype, sizeBytes: f.size });
    }
    try {
      await auditRepo.writeLog({
        userId: req.user.id,
        action: 'admin_employee_photos_upload',
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        beforeData: null,
        afterData: JSON.stringify({ id, count: items.length, items })
      });
    } catch (e) { /* silently ignored */ }
    res.status(201).json({ id, count: items.length, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/employees/photos/:photoId/download',
  rateLimitNamed('admin_employee_photo_download', { windowMs: 60_000, max: 60 }),
  permit('employees','view'),
  async (req, res) => {
    try {
      const photoId = parseInt(req.params.photoId, 10);
      if (!photoId) return res.status(400).json({ message: 'Missing photoId' });
      await ensureEmployeeProfilePhotosSchema();
      const tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
      const [[row]] = await db.query(
        `SELECT ep.id, ep.url, ep.mime_type AS mimeType
         FROM employee_profile_photos ep
         JOIN users u ON u.id = ep.userId
         WHERE ep.id = ?${tid != null ? ' AND u.tenant_id = ?' : ''}
         LIMIT 1`,
        tid != null ? [photoId, tid] : [photoId]
      );
      if (!row) return res.status(404).json({ message: 'Not found' });
      const buffer = await fileStore.readUploadedFile({ tenantId: tid, category: 'employee-photos', filename: row.url });
      if (!buffer) return res.status(404).json({ message: 'File not found' });
      res.setHeader('Cache-Control', 'no-store');
      if (row.mimeType) res.setHeader('Content-Type', row.mimeType);
      res.status(200).send(buffer);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.delete('/employees/:id/photos/:photoId', permit('employees','manage'), async (req, res) => {
  try {
    await ensureEmployeeProfilePhotosSchema();
    const id = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    if (!id || !photoId) return res.status(400).json({ message: 'Missing id/photoId' });
    const target = await userRepo.getUserById(id, req.tenantId || null);
    if (!target) return res.status(404).json({ message: 'Employee not found' });
    const [[row]] = await db.query(
      `SELECT id, userId, url FROM employee_profile_photos WHERE id = ? AND userId = ? LIMIT 1`,
      [photoId, id]
    );
    if (!row) return res.status(404).json({ message: 'Photo not found' });
    await db.query(`DELETE FROM employee_profile_photos WHERE id = ? AND userId = ?`, [photoId, id]);
    await fileStore.deleteUploadedFile({ tenantId: req.tenantId || null, category: 'employee-photos', filename: row.url });
    res.status(200).json({ ok: true, id, photoId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_set_role', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, authorize('admin'), userCtrl.setRole);
router.patch('/users/:id/department', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_set_department', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(before || {}), afterData: JSON.stringify(req.body || {}) });
  } catch (e) { /* silently ignored */ }
  next();
}, authorize('admin'), userCtrl.setDepartment);
router.patch('/users/:id/password', async (req, res, next) => {
  try {
    const before = await userRepo.getUserById(req.params.id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'Not found' });
    const superEmail = process.env.SUPER_ADMIN_EMAIL;
    if (before?.email === superEmail && String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({ message: 'Only SUPER_ADMIN can change own password' });
    }
    await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_set_password', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: before?.id, email: before?.email }), afterData: JSON.stringify({ changed: true }) });
  } catch (e) { /* silently ignored */ }
  next();
}, authorize('admin'), userCtrl.setPassword);
// Lock/Unlock tài khoản đăng nhập
router.patch('/users/:id/lock', authorize('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const minutes = parseInt((req.body?.minutes ?? 60), 10);
    const user = await userRepo.getUserById(id, req.tenantId || null);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await authRepo.lockUser(user.email, minutes);
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_lock', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: user.id, email: user.email }), afterData: JSON.stringify({ minutes }) }); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, locked: true, minutes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.patch('/users/:id/unlock', authorize('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const user = await userRepo.getUserById(id, req.tenantId || null);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await authRepo.resetLock(user.email);
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_user_unlock', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: user.id, email: user.email }), afterData: JSON.stringify({ unlocked: true }) }); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, unlocked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Revoke all sessions for a user (force logout everywhere)
router.post('/users/:id/revoke-sessions', authorize('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await userInTenant(req, id))) return res.status(404).json({ message: 'User not found' });
    const refreshRepo = require('../auth/refresh.repository');
    await refreshRepo.deleteUserTokens(id, req.tenantId || null);
    // Increment token_version to invalidate existing JWTs
    await userRepo.incrementTokenVersion(id, req.tenantId || null);
    // Immediately purge cached user data so the next request is blocked at once
    await invalidateUserCache(id);
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_revoke_sessions', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ targetUserId: id }) }); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, sessionsRevoked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Departments
router.use('/departments', deptRoutes);
// Corporations (法人)
router.use('/corporations', corpRoutes);
// Settings
router.use('/settings', authorize('admin'), settingsRoutes);
// Audit: liệt kê có filter
router.get('/audit', authorize('admin'), async (req, res) => {
  try {
    const result = await auditRepo.listLogs({
      userId: req.query.userId,
      action: req.query.action,
      actionPrefix: req.query.actionPrefix,
      actionPrefixes: req.query.actionPrefixes ? String(req.query.actionPrefixes).split(',') : undefined,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      pageSize: req.query.pageSize,
      tenantId: req.tenantId || null
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export: attendance report as Excel/PDF
router.get('/export/attendance', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { generateAttendanceExcel, generateAttendancePDF } = require('../../core/services/export.service');
    const { month = '', format = 'excel' } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month (YYYY-MM)' });

    const db = require('../../core/database/mysql');
    const tid = req.tenantId != null ? parseInt(String(req.tenantId), 10) : null;
    const tidWhere = tid != null ? 'AND u.tenant_id = ?' : '';
    const tidParams = tid != null ? [tid] : [];
    const [users] = await db.query(
      `SELECT u.id, u.employee_code, u.username, d.name as departmentName FROM users u LEFT JOIN departments d ON u.departmentId = d.id WHERE u.employment_status = 'active' ${tidWhere} ORDER BY u.employee_code`,
      tidParams
    );
    const userIds = users.map(u => u.id);
    let records = [];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      [records] = await db.query(
        `SELECT userId, date, check_in, check_out, status FROM attendance WHERE userId IN (${placeholders}) AND date LIKE ? ORDER BY date`,
        [...userIds, month + '%']
      );
    } else {
      records = [];
    }

    const companyName = req.tenant?.name || process.env.COMPANY_NAME || '飯塚塗研株式会社';

    if (format === 'pdf') {
      const buffer = await generateAttendancePDF({ month, users, records, companyName });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="attendance_${month}.pdf"`);
      return res.send(buffer);
    }

    const buffer = await generateAttendanceExcel({ month, users, records, companyName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_${month}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DB check: thống kê nhanh và kiểm tra collation
router.get('/db/check', authorize('admin'), async (req, res) => {
  try {
    const [verRows] = await db.query('SELECT DATABASE() AS db, VERSION() AS version');
    const meta = verRows && verRows[0] ? verRows[0] : {};
    const tid = req.tenantId != null ? parseInt(String(req.tenantId), 10) : null;
    const tidWhere = tid != null ? 'WHERE tenant_id = ?' : '';
    const tidParams = tid != null ? [tid] : [];
    const [usersCountRows] = await db.query(
      `SELECT COUNT(*) AS total, SUM(employment_status="active") AS active, SUM(employment_status="inactive") AS inactive, SUM(employment_status="retired") AS retired, SUM(hire_date IS NULL) AS hire_null, SUM(hire_date IS NOT NULL) AS hire_set FROM users ${tidWhere}`,
      tidParams
    );
    const usersCount = usersCountRows && usersCountRows[0] ? usersCountRows[0] : {};
    let departmentsCount = { total: 0 };
    try {
      const deptTidWhere = tid != null ? 'WHERE tenant_id = ?' : '';
      const [deptRows] = await db.query(`SELECT COUNT(*) AS total FROM departments ${deptTidWhere}`, tidParams.slice());
      departmentsCount = deptRows && deptRows[0] ? deptRows[0] : { total: 0 };
    } catch (e) { /* silently ignored */ }
    const sampleTidWhere = tid != null ? 'WHERE tenant_id = ?' : '';
    const [sampleUsers] = await db.query(
      `SELECT id, employee_code, username, email, departmentId, employment_status, hire_date FROM users ${sampleTidWhere} ORDER BY id DESC LIMIT 5`,
      tidParams.slice()
    );
    const [collRows] = await db.query(`
      SELECT TABLE_NAME AS table, TABLE_COLLATION AS collation
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME ASC
    `);
    res.status(200).json({
      db: meta.db,
      version: meta.version,
      users: usersCount,
      departments: departmentsCount,
      sampleUsers,
      collations: collRows
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Export CSV timesheet
router.get('/export/timesheet.csv', authorize('admin'), async (req, res) => {
  try {
    const { userIds, from, to } = req.query;
    if (!userIds || !from || !to) {
      return res.status(400).send('Missing userIds/from/to');
    }
    const ids = String(userIds).split(',').map(s => s.trim()).filter(Boolean);
    const lang = (req.query.lang || req.headers['accept-language'] || '').toLowerCase();
    const isJa = lang.startsWith('ja') || true; // Force Japanese for now
    const header = isJa
      ? '社員番号,氏名,日付,通常勤務分,残業分,深夜分\n'
      : 'employeeCode,userName,date,regularMinutes,overtimeMinutes,nightMinutes\n';
    let csv = header;
    let singleUserName = '';
    let singleEmpCode = '';

    for (const id of ids) {
      const u = await userRepo.getUserById(id, req.tenantId || null).catch(() => null);
      if (!u) continue; // 他社(別テナント)のIDは無視 — 存在確認できないものは出力しない
      const empCode = u?.employee_code || '';
      const uName = String(u?.full_name || u?.fullName || u?.username || u?.email || `ID:${id}`);
      if (ids.length === 1) {
        singleUserName = uName;
        singleEmpCode = empCode;
      }
      const r = await attendanceService.timesheet(id, from, to, req.tenantId || null);
      for (const d of r.days) {
        csv += `"${empCode}","${uName}",${d.date},${d.regularMinutes},${d.overtimeMinutes},${d.nightMinutes}\n`;
      }
    }
    
    // Add BOM for Excel UTF-8 support
    const buf = Buffer.from('\uFEFF' + csv, 'utf8');
    
    let filename = 'timesheet.csv';
    const compactFrom = String(from).replace(/-/g, ''); // 20260501
    const compactTo = String(to).replace(/-/g, ''); // 20260531
    const dateRange = compactFrom === compactTo ? compactFrom : `${compactFrom}-${compactTo}`;

    if (ids.length === 1) {
      const safeName = singleUserName.replace(/[^\w\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_');
      filename = `timesheet_${singleEmpCode}_${safeName}_${dateRange}.csv`;
    } else {
      filename = `timesheet_multiple_${dateRange}.csv`;
    }
    const encodedFilename = encodeURIComponent(filename);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);

    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/csv/timesheet/${ts}_${filename}`;
      s3Service.uploadToR2(r2Key, buf, 'text/csv').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/export/attendance-month.csv', authorize('admin','manager'), async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).send('Missing month (YYYY-MM)');
    }
    const deptId = req.query.deptId ? String(req.query.deptId) : null;
    const y = parseInt(month.slice(0, 4), 10);
    const m = parseInt(month.slice(5, 7), 10);
    const pad2 = (n) => String(n).padStart(2, '0');
    const start = `${y}-${pad2(m)}-01`;
    const next = new Date(Date.UTC(y, m, 1));
    const nextStart = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
    const whereDept = deptId ? 'AND u.departmentId = ?' : '';
    const whereTenant = req.tenantId ? 'AND u.tenant_id = ?' : '';
    const [rows1] = await db.query(`
      SELECT
        u.id AS userId,
        u.employee_code AS employeeCode,
        u.username AS username,
        d.name AS departmentName,
        DATE(COALESCE(a.checkIn, a.checkOut)) AS date,
        MIN(a.checkIn) AS checkIn,
        MAX(a.checkOut) AS checkOut,
        GROUP_CONCAT(DISTINCT wr.site SEPARATOR ' / ') AS site,
        GROUP_CONCAT(DISTINCT wr.work SEPARATOR ' / ') AS work
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      INNER JOIN attendance a
        ON a.userId = u.id
       AND ((a.checkIn >= ? AND a.checkIn < ?) OR (a.checkIn IS NULL AND a.checkOut >= ? AND a.checkOut < ?))
      LEFT JOIN work_reports wr
        ON wr.userId = u.id AND wr.date = DATE(COALESCE(a.checkIn, a.checkOut))
      WHERE u.employment_status = 'active'
        AND u.role IN ('employee','manager')
        ${whereDept}
        ${whereTenant}
      GROUP BY u.id, DATE(COALESCE(a.checkIn, a.checkOut))
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC, date ASC
    `, [
      start + ' 00:00:00', nextStart + ' 00:00:00', start + ' 00:00:00', nextStart + ' 00:00:00',
      ...(deptId ? [deptId] : []),
      ...(req.tenantId ? [req.tenantId] : [])
    ]);

    const params2 = [start, nextStart];
    if (deptId) params2.push(deptId);
    if (req.tenantId) params2.push(req.tenantId);
    const [rows2] = await db.query(`
      SELECT
        u.id AS userId,
        u.employee_code AS employeeCode,
        u.username AS username,
        d.name AS departmentName,
        wr.date AS date,
        NULL AS checkIn,
        NULL AS checkOut,
        wr.site AS site,
        wr.work AS work
      FROM work_reports wr
      INNER JOIN users u ON u.id = wr.userId
      LEFT JOIN departments d ON d.id = u.departmentId
      LEFT JOIN attendance a
        ON a.userId = wr.userId AND DATE(COALESCE(a.checkIn, a.checkOut)) = wr.date
      WHERE wr.date >= ? AND wr.date < ?
        AND a.id IS NULL
        AND u.employment_status = 'active'
        AND u.role IN ('employee','manager')
        ${whereDept}
        ${whereTenant}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC, date ASC
    `, params2);

    const csvEsc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmtHm = (dt) => {
      if (!dt) return '';
      const s = String(dt);
      return s.length >= 16 ? s.slice(11, 16) : s;
    };
    const header = '社員番号,氏名,部署,日付,出勤,退勤,現場,作業内容\n';
    let csv = header;
    for (const r of [...(rows1 || []), ...(rows2 || [])]) {
      csv += [
        csvEsc(r.employeeCode || `EMP${String(r.userId).padStart(3,'0')}`),
        csvEsc(r.username || ''),
        csvEsc(r.departmentName || ''),
        csvEsc(String(r.date || '').slice(0, 10)),
        csvEsc(fmtHm(r.checkIn)),
        csvEsc(fmtHm(r.checkOut)),
        csvEsc(r.site || ''),
        csvEsc(r.work || '')
      ].join(',') + '\n';
    }
    const filename = `attendance_${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);
    
    const csvOutput = '\uFEFF' + csv;
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/csv/attendance/${ts}_${filename}`;
      s3Service.uploadToR2(r2Key, Buffer.from(csvOutput, 'utf8'), 'text/csv').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.status(200).send(csvOutput);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Admin Home stats
router.get('/home/stats', authorize('admin'), async (req, res) => {
  try {
    const db = require('../../core/database/mysql');
    const { clause: tc, params: tp } = tenantClause(req, '');
    const { clause: tcu, params: tpu } = tenantClause(req, 'u');
    const [[{ c_checkin } = { c_checkin: 0 }]] = await db.query(`
      SELECT COUNT(DISTINCT userId) AS c_checkin
      FROM attendance
      WHERE DATE(COALESCE(checkIn, checkOut)) = CURDATE() ${tc}
    `, tp);
    const [[{ c_pending } = { c_pending: 0 }]] = await db.query(`
      SELECT COUNT(*) AS c_pending
      FROM leave_requests lr
      INNER JOIN users u ON u.id = lr.userId
      WHERE lr.status = 'pending' ${tcu}
    `, tpu);
    const [[{ c_leave } = { c_leave: 0 }]] = await db.query(`
      SELECT COUNT(*) AS c_leave
      FROM leave_requests lr
      INNER JOIN users u ON u.id = lr.userId
      WHERE lr.status = 'approved'
        AND CURDATE() BETWEEN lr.startDate AND lr.endDate ${tcu}
    `, tpu);
    const [[{ c_late } = { c_late: 0 }]] = await db.query(`
      SELECT COUNT(*) AS c_late
      FROM attendance a
      INNER JOIN users u ON u.id = a.userId
      LEFT JOIN user_shift_assignments s
        ON s.userId = a.userId
       AND s.start_date <= DATE(COALESCE(a.checkIn, a.checkOut))
       AND (s.end_date IS NULL OR s.end_date >= DATE(COALESCE(a.checkIn, a.checkOut)))
      LEFT JOIN shift_definitions d
        ON d.id = s.shiftId
      WHERE DATE(COALESCE(a.checkIn, a.checkOut)) = CURDATE()
        AND TIME(a.checkIn) > COALESCE(d.start_time, '09:00') ${tcu}
    `, tpu);
    res.status(200).json({
      todayCheckin: Number(c_checkin || 0),
      lateCount: Number(c_late || 0),
      leaveCount: Number(c_leave || 0),
      pendingCount: Number(c_pending || 0)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Topbar notification summary for manager/admin
// サイドメニューのバッジ用: 承認待ちの件数だけを返す（notifications/summary と同じテナント・役割の絞り込み）
router.get('/notifications/pending-counts', authorize('admin','manager'), async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const { clause: tcu, params: tpu } = tenantClause(req, 'u');
    const whereAll = `${role === 'manager' ? ` AND u.role = 'employee'` : ``} ${tcu}`;
    // テーブル未作成などで1件失敗しても他の件数は返す
    const count = async (sql) => {
      try { const [[row]] = await db.query(sql, tpu); return Number(row?.c || 0); } catch (e) { return 0; }
    };
    const [leave, adjust, expense, shift] = await Promise.all([
      count(`SELECT COUNT(*) AS c FROM leave_requests lr INNER JOIN users u ON u.id = lr.userId WHERE lr.status = 'pending' ${whereAll}`),
      count(`SELECT COUNT(*) AS c FROM time_adjust_requests ar INNER JOIN users u ON u.id = ar.userId WHERE ar.status = 'pending' ${whereAll}`),
      count(`SELECT COUNT(*) AS c FROM expense_claims ec INNER JOIN users u ON u.id = ec.userId WHERE ec.status = 'applied' ${whereAll}`),
      // シフト承認画面と同じく、在職中の従業員の「提出済み(PENDING)」の月を数える
      count(`SELECT COUNT(*) AS c FROM shift_month_status s INNER JOIN users u ON u.id = s.userId WHERE s.status = 'PENDING' AND u.role NOT IN ('admin','manager') AND u.employment_status = 'active' ${whereAll}`)
    ]);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ leave, adjust, expense, shift });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/notifications/summary', authorize('admin','manager'), async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const managerOnlyEmployee = role === 'manager';
    try { await auditRepo.ensureTable(); } catch (e) { /* silently ignored */ }

    const { clause: tcu, params: tpu } = tenantClause(req, 'u');
    const whereRole = managerOnlyEmployee ? ` AND u.role = 'employee'` : ``;
    const whereAll = `${whereRole} ${tcu}`;

    const [[leaveRow]] = await db.query(`
      SELECT COUNT(*) AS c
      FROM leave_requests lr
      INNER JOIN users u ON u.id = lr.userId
      WHERE lr.status = 'pending' ${whereAll}
    `, tpu);

    const [[adjustRow]] = await db.query(`
      SELECT COUNT(*) AS c
      FROM time_adjust_requests ar
      INNER JOIN users u ON u.id = ar.userId
      WHERE ar.status = 'pending' ${whereAll}
    `, tpu);

    const [[expenseRow]] = await db.query(`
      SELECT COUNT(*) AS c
      FROM expense_claims ec
      INNER JOIN users u ON u.id = ec.userId
      WHERE ec.status = 'applied' ${whereAll}
    `, tpu);
    const [[activityRow]] = await db.query(`
      SELECT COUNT(*) AS c
      FROM audit_logs al
      INNER JOIN users u ON u.id = al.userId
      WHERE u.role = 'employee'
        AND al.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) ${tcu}
    `, tpu);

    const [leaveItems] = await db.query(`
      SELECT 'leave' AS type, lr.id AS id, lr.created_at AS createdAt,
             COALESCE(u.username, u.email, CONCAT('user#', lr.userId)) AS username,
             lr.startDate AS startDate, lr.endDate AS endDate
      FROM leave_requests lr
      INNER JOIN users u ON u.id = lr.userId
      WHERE lr.status = 'pending' ${whereAll}
      ORDER BY lr.created_at DESC
      LIMIT 5
    `, tpu);

    const [adjustItems] = await db.query(`
      SELECT 'adjust' AS type, ar.id AS id, ar.created_at AS createdAt,
             COALESCE(u.username, u.email, CONCAT('user#', ar.userId)) AS username,
             ar.requestedCheckIn AS requestedCheckIn, ar.requestedCheckOut AS requestedCheckOut
      FROM time_adjust_requests ar
      INNER JOIN users u ON u.id = ar.userId
      WHERE ar.status = 'pending' ${whereAll}
      ORDER BY ar.created_at DESC
      LIMIT 5
    `, tpu);

    const [expenseItems] = await db.query(`
      SELECT 'expense' AS type, ec.id AS id, COALESCE(ec.applied_at, ec.updated_at, ec.created_at) AS createdAt,
             COALESCE(u.username, u.email, CONCAT('user#', ec.userId)) AS username,
             ec.amount AS amount, ec.date AS expenseDate
      FROM expense_claims ec
      INNER JOIN users u ON u.id = ec.userId
      WHERE ec.status = 'applied' ${whereAll}
      ORDER BY COALESCE(ec.applied_at, ec.updated_at, ec.created_at) DESC
      LIMIT 5
    `, tpu);
    const [activityItems] = await db.query(`
      SELECT 'activity' AS type, al.id AS id, al.created_at AS createdAt,
             COALESCE(u.username, u.email, CONCAT('user#', al.userId)) AS username,
             al.action AS action, al.path AS path, al.method AS method
      FROM audit_logs al
      INNER JOIN users u ON u.id = al.userId
      WHERE u.role = 'employee'
        AND al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ${tcu}
      ORDER BY al.created_at DESC
      LIMIT 15
    `, tpu);

    const items = [...(leaveItems || []), ...(adjustItems || []), ...(expenseItems || []), ...(activityItems || [])]
      .sort((a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 20);

    const counts = {
      leavePending: Number(leaveRow?.c || 0),
      adjustPending: Number(adjustRow?.c || 0),
      expenseApplied: Number(expenseRow?.c || 0),
      employeeActions24h: Number(activityRow?.c || 0)
    };
    const total = counts.leavePending + counts.adjustPending + counts.expenseApplied + counts.employeeActions24h;

    res.status(200).json({ total, counts, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Persistent admin notification feed (DB-backed)
router.get('/notifications/feed', authorize('admin','manager','employee'), async (req, res) => {
  try {
    const limit = req.query?.limit;
    const data = await noticesRepo.listAdminFeed({
      userId: req.user?.id || null,
      role: req.user?.role || '',
      limit,
      tenantId: req.tenantId || null
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/notifications/read', authorize('admin','manager'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const r = await noticesRepo.markRead({ noticeIds: ids, userId: req.user?.id || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
});
router.post('/notifications/hide', authorize('admin','manager'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const r = await noticesRepo.hideForUser({ noticeIds: ids, userId: req.user?.id || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
});
// Attendance admin: view timesheet and edit records
router.get('/attendance/timesheet', authorize('admin','manager'), async (req, res) => {
  try {
    const { userId, from, to } = req.query || {};
    if (!userId || !from || !to) {
      return res.status(400).json({ message: 'Missing userId/from/to' });
    }
    const r = await attendanceService.timesheet(userId, from, to);
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/attendance/day', authorize('admin','manager'), async (req, res) => {
  try {
    const { userId, date } = req.query || {};
    if (!userId || !date) {
      return res.status(400).json({ message: 'Missing userId/date' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    const tenantId = req.tenantId || null;
    const rows = await attendanceRepo.listByUserBetween(userId, date, date, { tenantId });
    const daily = await attendanceRepo.getDaily(userId, date, { tenantId }).catch(() => null);
    res.status(200).json({ date, daily: daily ? {
      workType: daily.work_type || null,
      location: daily.location || null,
      reason: daily.reason || null,
      memo: daily.memo || null,
      breakMinutes: daily.break_minutes == null ? null : Number(daily.break_minutes),
      nightBreakMinutes: daily.night_break_minutes == null ? null : Number(daily.night_break_minutes)
    } : null, segments: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.patch('/attendance/:id', authorize('admin','manager'), async (req, res) => {
  try {
    const id = req.params.id;
    const { checkIn, checkOut } = req.body || {};
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const current = await attendanceRepo.getById(id, { tenantId: req.tenantId || null });
    if (!current) return res.status(404).json({ message: 'Not found' });
    // checkIn が省略された場合は既存値を使う（退勤だけクリアするケースに対応）
    const resolvedCheckIn = checkIn !== undefined ? (checkIn || null) : (current.checkIn || null);
    const resolvedCheckOut = Object.prototype.hasOwnProperty.call(req.body || {}, 'checkOut')
      ? (checkOut || null)
      : (current.checkOut || null);
    await attendanceRepo.updateTimes(id, resolvedCheckIn, resolvedCheckOut, { tenantId: req.tenantId || null });
    try { await auditRepo.writeLog({ userId: req.user.id, action: 'admin_attendance_update', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id, checkIn: current.checkIn, checkOut: current.checkOut }), afterData: JSON.stringify({ checkIn: resolvedCheckIn, checkOut: resolvedCheckOut }) }); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// ─── Salary/Payslip routes (extracted to admin.salary.routes.js) ────────────
router.use('/', require('./admin.salary.routes'));

router.get('/calendar/raw',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
    const rows = await calendarRepo.listAllByYear(year, req.tenantId || 0);
    const types = String(req.query.type || '').split(',').map(s => s.trim()).filter(Boolean);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    let filtered = types.length ? rows.filter(r => types.includes(String(r.type))) : rows;
    if (from) filtered = filtered.filter(r => String(r.date) >= from);
    if (to) filtered = filtered.filter(r => String(r.date) <= to);
    res.status(200).json({ year, rows: filtered });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.delete('/calendar/jp',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || req.body?.year || new Date().getUTCFullYear()), 10);
    const [result] = await require('../../core/database/mysql').query(
      `DELETE FROM company_holidays WHERE YEAR(date) = ? AND type NOT IN ('jp_auto','jp_substitute','jp_bridge')`,
      [year]
    );
    res.status(200).json({ ok: true, year, affected: result?.affectedRows ?? null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/calendar/export',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
    let rows = await calendarRepo.listAllByYear(year, req.tenantId || 0);
    const lang = (req.query.lang || req.headers['accept-language'] || '').toLowerCase();
    const isJa = lang.startsWith('ja');
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const includeNonOff = String(req.query.include_nonoff || '').toLowerCase() === 'true';
    if (from) rows = rows.filter(r => String(r.date) >= from);
    if (to) rows = rows.filter(r => String(r.date) <= to);
    const pad = n => String(n).padStart(2, '0');
    const uid = (d, t) => `${year}-${d}-${t}@attendance`;
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//attendance//calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
    for (const r of rows) {
      if (!includeNonOff && !r.is_off) continue;
      const dt = String(r.date);
      const summary = isJa ? (r.name?.split(' / ')[0] || r.name || '') : (r.name?.split(' / ').slice(-1)[0] || r.name || '');
      const y = dt.slice(0,4), m = dt.slice(5,7), d = dt.slice(8,10);
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${uid(dt, r.type)}\r\n`;
      ics += `DTSTAMP:${y}${m}${d}T000000Z\r\n`;
      ics += `DTSTART;VALUE=DATE:${y}${m}${d}\r\n`;
      ics += `SUMMARY:${summary}\r\n`;
      ics += 'END:VEVENT\r\n';
    }
    ics += 'END:VCALENDAR\r\n';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"company_holidays_${year}.ics\"`);
    res.status(200).send(ics);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/calendar/export.csv',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
    let rows = await calendarRepo.listAllByYear(year, req.tenantId || 0);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const types = String(req.query.type || '').split(',').map(s => s.trim()).filter(Boolean);
    const lang = (req.query.lang || req.headers['accept-language'] || '').toLowerCase();
    const isJa = lang.startsWith('ja');
    if (from) rows = rows.filter(r => String(r.date) >= from);
    if (to) rows = rows.filter(r => String(r.date) <= to);
    if (types.length) rows = rows.filter(r => types.includes(String(r.type)));
    const nameJa = s => String(s || '').split(' / ')[0] || null;
    const nameEn = s => {
      const parts = String(s || '').split(' / ');
      return parts.length > 1 ? parts[1] : null;
    };
    const label = (s) => {
      const ja = nameJa(s) || '';
      const en = nameEn(s) || '';
      return isJa ? (ja || en) : (en || ja);
    };
    const csvEsc = (v) => {
      const s = String(v ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    let csv = '\uFEFF' + 'date,month,name,label,name_ja,name_en,type,is_off\r\n';
    for (const r of rows) {
      const month = String(r.date).slice(0, 7);
      csv += [
        csvEsc(String(r.date || '').slice(0, 10)),
        csvEsc(month),
        csvEsc(r.name || ''),
        csvEsc(label(r.name || '')),
        csvEsc(nameJa(r.name) || ''),
        csvEsc(nameEn(r.name) || ''),
        csvEsc(r.type || ''),
        csvEsc(String(r.is_off ?? ''))
      ].join(',') + '\r\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"company_holidays_${year}.csv\"`);
    
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/csv/calendar/${ts}_company_holidays_${year}.csv`;
      s3Service.uploadToR2(r2Key, Buffer.from(csv, 'utf8'), 'text/csv').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/salary/files', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = req.query?.userId ? parseInt(String(req.query.userId), 10) : null;
    const month = req.query?.month ? String(req.query.month).slice(0, 7) : null;
    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query?.limit || '500'), 10) || 500));
    if (role === 'manager' && userId && String(process.env.MANAGER_STRICT_DEPT_PAYROLL || '').toLowerCase() === 'true') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const target = await userRepo.getUserById(userId, req.tenantId || null);
      if (!me?.departmentId || String(me.departmentId) !== String(target?.departmentId)) {
        return res.status(403).json({ message: 'Forbidden: cross-department access' });
      }
    }
    let sql = `
      SELECT f.id, f.userId, f.month, f.original_name, f.created_at, f.uploaded_by,
             u.username AS user_name, u.email AS user_email,
             s.username AS uploader_name, s.email AS uploader_email
      FROM payslip_files f
      JOIN users u ON u.id = f.userId
      LEFT JOIN users s ON s.id = f.uploaded_by
      WHERE 1=1
    `;
    const params = [];
    // 自社の社員の明細だけ (以前は tenant で絞っておらず、他社の配信履歴まで見えてしまう作りだった)
    const tid = req.tenantId != null ? parseInt(String(req.tenantId), 10) : null;
    if (tid != null) { sql += ` AND u.tenant_id = ?`; params.push(tid); }
    if (userId) { sql += ` AND f.userId = ?`; params.push(userId); }
    if (month) { sql += ` AND f.month = ?`; params.push(month); }
    sql += ` ORDER BY f.created_at DESC LIMIT ?`;
    params.push(limit);
    // db2 はこのファイルでは未定義 (admin.salary.routes.js 側の変数) — ReferenceError で送信履歴が常に失敗していた
    const [rows] = await db.query(sql, params);
    const items = (rows || []).map(r => ({
      id: r.id,
      userId: r.userId,
      userName: r.user_name || r.user_email || '',
      month: r.month,
      fileName: r.original_name,
      createdAt: r.created_at,
      uploadedBy: r.uploaded_by,
      uploaderName: r.uploader_name || r.uploader_email || ''
    }));
    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/export.xls',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
    let rows = await calendarRepo.listAllByYear(year, req.tenantId || 0);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const types = String(req.query.type || '').split(',').map(s => s.trim()).filter(Boolean);
    const includeNonOff = String(req.query.include_nonoff || '').toLowerCase() === 'true';
    if (from) rows = rows.filter(r => String(r.date) >= from);
    if (to) rows = rows.filter(r => String(r.date) <= to);
    if (types.length) rows = rows.filter(r => types.includes(String(r.type)));
    if (!includeNonOff) rows = rows.filter(r => !!r.is_off);
    rows.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')) || String(a?.type || '').localeCompare(String(b?.type || '')));

    const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]));
    const nameJa = s => String(s || '').split(' / ')[0] || '';
    const nameEn = s => {
      const parts = String(s || '').split(' / ');
      return parts.length > 1 ? parts.slice(1).join(' / ') : '';
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
    const typeLabel = (t) => {
      const s = String(t || '');
      if (s === 'jp_auto') return '祝日';
      if (s === 'jp_substitute') return '振替';
      if (s === 'jp_bridge') return '国民の休日';
      if (s === 'fixed') return '会社';
      if (s === 'custom') return '任意';
      return s || '';
    };
    const cell = (styleId, val) => `<Cell${styleId ? ` ss:StyleID="${styleId}"` : ''}><Data ss:Type="String">${xml(val)}</Data></Cell>`;
    const borderBlock = `
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
      </Borders>
    `;

    const sheetName = `Holidays ${year}`;
    const header = ['日付', '曜日', '種別', '休日', '名称', 'English'];
    const bodyRows = rows.map(r => {
      const dt = String(r?.date || '').slice(0, 10);
      const off = Number(r?.is_off || 0) ? '休' : '';
      const baseStyle = Number(r?.is_off || 0) ? 'OffCell' : 'Cell';
      return `<Row>
        ${cell(baseStyle, dt)}
        ${cell(baseStyle, dowJa(dt))}
        ${cell(baseStyle, typeLabel(r?.type))}
        ${cell(baseStyle, off)}
        ${cell(baseStyle, nameJa(r?.name || ''))}
        ${cell(baseStyle, nameEn(r?.name || ''))}
      </Row>`;
    }).join('');

    const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
      <Interior ss:Color="#1F3553" ss:Pattern="Solid"/>
      ${borderBlock}
    </Style>
    <Style ss:ID="Cell">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      ${borderBlock}
    </Style>
    <Style ss:ID="OffCell">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
      ${borderBlock}
    </Style>
  </Styles>
  <Worksheet ss:Name="${xml(sheetName)}">
    <Table ss:DefaultRowHeight="18">
      <Column ss:Width="86"/>
      <Column ss:Width="44"/>
      <Column ss:Width="76"/>
      <Column ss:Width="44"/>
      <Column ss:Width="300"/>
      <Column ss:Width="300"/>
      <Row ss:StyleID="Header">
        ${header.map(h => cell(null, h).replace('<Cell', '<Cell ss:StyleID="Header"')).join('')}
      </Row>
      ${bodyRows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane>
      <ActivePane>2</ActivePane>
      <Panes>
        <Pane>
          <Number>2</Number>
          <ActiveRow>1</ActiveRow>
          <ActiveCol>0</ActiveCol>
        </Pane>
      </Panes>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"company_holidays_${year}.xls\"`);

    // Auto-save export to R2
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/excel/calendar/${ts}_company_holidays_${year}.xls`;
      s3Service.uploadToR2(r2Key, Buffer.from(workbook, 'utf8'), 'application/vnd.ms-excel').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.status(200).send(workbook);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/export.xlsx',
  authorize('admin'),
  async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
    let rows = await calendarRepo.listAllByYear(year, req.tenantId || 0);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const types = String(req.query.type || '').split(',').map(s => s.trim()).filter(Boolean);
    const includeNonOff = String(req.query.include_nonoff || '').toLowerCase() === 'true';
    if (from) rows = rows.filter(r => String(r.date) >= from);
    if (to) rows = rows.filter(r => String(r.date) <= to);
    if (types.length) rows = rows.filter(r => types.includes(String(r.type)));
    if (!includeNonOff) rows = rows.filter(r => !!r.is_off);
    rows.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')) || String(a?.type || '').localeCompare(String(b?.type || '')));

    const pad2 = (n) => String(n).padStart(2, '0');
    const dowJa = (dateStr) => {
      try {
        const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(x => parseInt(x, 10));
        const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        return ['日','月','火','水','木','金','土'][dt.getUTCDay()];
      } catch {
        return '';
      }
    };
    const typeLabel = (t) => {
      const s = String(t || '');
      if (s === 'jp_auto') return '祝日';
      if (s === 'jp_substitute') return '振替';
      if (s === 'jp_bridge') return '国民の休日';
      if (s === 'fixed') return '会社';
      if (s === 'custom') return '任意';
      return s || '';
    };
    const nameJa = s => String(s || '').split(' / ')[0] || '';
    const nameEn = s => {
      const parts = String(s || '').split(' / ');
      return parts.length > 1 ? parts.slice(1).join(' / ') : '';
    };

    const columns = [
      { header: '日付', width: 12 },
      { header: '曜日', width: 6 },
      { header: '種別', width: 12 },
      { header: '休日', width: 6 },
      { header: '名称', width: 44 },
      { header: 'English', width: 44 }
    ];
    const sheetName = `Holidays ${year}`;
    const dataRows = rows.map(r => {
      const dt = String(r?.date || '').slice(0, 10);
      const off = Number(r?.is_off || 0) ? '休' : '';
      return {
        isOff: Number(r?.is_off || 0) === 1,
        cells: [
          dt,
          dowJa(dt),
          typeLabel(r?.type),
          off,
          nameJa(r?.name || ''),
          nameEn(r?.name || '')
        ]
      };
    });

    const { buildXlsx } = require('../../utils/xlsx');
    const buf = await buildXlsx({ sheetName, columns, rows: dataRows });
    
    // Auto-save export to R2
    if (s3Service.isR2Configured()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `exports/excel/calendar/${ts}_company_holidays_${year}.xlsx`;
      s3Service.uploadToR2(r2Key, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(e => {
        console.error('Failed to auto-save export to R2:', e);
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=\"company_holidays_${year}.xlsx\"`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const multer = require('multer');
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post('/calendar/import', authorize('admin'), excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    
    if (!sheet) {
      return res.status(400).json({ message: 'Excelファイルにシートがありません。' });
    }

    const data = [];
    sheet.eachRow((row, rowNumber) => {
      // exceljs row.values is 1-indexed array
      // To keep compatibility with the old 0-indexed array:
      const rowValues = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rowValues[colNumber - 1] = cell.value;
      });
      data.push(rowValues);
    });
    
    const headerRow = data[0] || [];
    const colDate = headerRow.indexOf('日付');
    const colType = headerRow.indexOf('種別');
    const colOff = headerRow.indexOf('休日');
    const colNameJa = headerRow.indexOf('名称');
    const colNameEn = headerRow.indexOf('English');

    if (colDate === -1) {
      return res.status(400).json({ message: 'Excelのフォーマットが正しくありません。「日付」列が見つかりません。' });
    }

    const records = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      const dateRaw = row[colDate];
      if (!dateRaw) continue;
      
      let dateStr = '';
      if (typeof dateRaw === 'number') {
        const d = new Date(Math.round((dateRaw - 25569) * 86400 * 1000));
        dateStr = d.toISOString().slice(0, 10);
      } else {
        dateStr = String(dateRaw).trim().slice(0, 10);
        dateStr = dateStr.replace(/\//g, '-');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

      const type = String(row[colType] || '').trim();
      const isOff = String(row[colOff] || '').trim() === '休' ? 1 : 0;
      const nameJa = String(row[colNameJa] || '').trim();
      const nameEn = String(row[colNameEn] || '').trim();
      const name = nameEn ? `${nameJa} / ${nameEn}` : nameJa;

      let typeCode = 'custom';
      if (type === '祝日') typeCode = 'jp_auto';
      else if (type === '振替') typeCode = 'jp_substitute';
      else if (type === '国民の休日') typeCode = 'jp_bridge';
      else if (type === '会社') typeCode = 'fixed';
      else if (type) typeCode = type;

      records.push({ date: dateStr, type: typeCode, name, is_off: isOff });
    }

    if (!records.length) {
      return res.status(400).json({ message: '有効なデータが見つかりませんでした。' });
    }

    // Lưu vào đúng công ty của admin. Trước đây thiếu tenant_id → mặc định 0 = ngày nghỉ CHUNG,
    // nên lịch nghỉ một công ty nhập vào hiện ra (và ghi đè) ở cả các công ty khác.
    const holidayTid = req.tenantId ? Number(req.tenantId) : 0;
    for (const r of records) {
      await db.query(`
        INSERT INTO company_holidays (tenant_id, date, type, name, is_off)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE type=VALUES(type), name=VALUES(name), is_off=VALUES(is_off)
      `, [holidayTid, r.date, r.type, r.name, r.is_off]);
    }

    res.status(200).json({ ok: true, count: records.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Shift definitions & assignments (sub-router)
const shiftsRouter = express.Router();
shiftsRouter.get('/definitions', async (req, res) => {
  try {
    const rows = await attendanceRepo.listShiftDefinitions({ tenantId: req.tenantId || null });
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
shiftsRouter.post('/definitions', async (req, res) => {
  try {
    const { name, start_time, end_time, break_minutes } = req.body || {};
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ message: 'Missing name/start_time/end_time' });
    }
    const row = await attendanceRepo.upsertShiftDefinition({ name, start_time, end_time, break_minutes: break_minutes || 0, tenantId: req.tenantId || null });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
shiftsRouter.post('/assign', async (req, res) => {
  try {
    const { userId, shiftId, startDate, endDate } = req.body || {};
    if (!userId || !shiftId || !startDate) {
      return res.status(400).json({ message: 'Missing userId/shiftId/startDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    await attendanceRepo.assignShiftToUser(userId, shiftId, startDate, endDate, { tenantId: req.tenantId || null });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
shiftsRouter.post('/backfill', async (req, res) => {
  try {
    const { userId, fromDate, toDate } = req.body || {};
    if (!userId || !fromDate || !toDate) {
      return res.status(400).json({ message: 'Missing userId/fromDate/toDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    const r = await attendanceRepo.backfillShiftIdForUserRange(userId, fromDate, toDate, { tenantId: req.tenantId || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.use('/shifts', authorize('admin'), shiftsRouter);
// Direct routes for shifts (for clients relying on top-level route listing)
router.get('/shifts/definitions', authorize('admin'), async (req, res) => {
  try {
    const rows = await attendanceRepo.listShiftDefinitions({ tenantId: req.tenantId || null });
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/definitions', authorize('admin'), async (req, res) => {
  try {
    const { name, start_time, end_time, break_minutes } = req.body || {};
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ message: 'Missing name/start_time/end_time' });
    }
    const row = await attendanceRepo.upsertShiftDefinition({ name, start_time, end_time, break_minutes: break_minutes || 0, tenantId: req.tenantId || null });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/assign', authorize('admin'), async (req, res) => {
  try {
    const { userId, shiftId, startDate, endDate } = req.body || {};
    if (!userId || !shiftId || !startDate) {
      return res.status(400).json({ message: 'Missing userId/shiftId/startDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    await attendanceRepo.assignShiftToUser(userId, shiftId, startDate, endDate, { tenantId: req.tenantId || null });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/backfill', authorize('admin'), async (req, res) => {
  try {
    const { userId, fromDate, toDate } = req.body || {};
    if (!userId || !fromDate || !toDate) {
      return res.status(400).json({ message: 'Missing userId/fromDate/toDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    const r = await attendanceRepo.backfillShiftIdForUserRange(userId, fromDate, toDate, { tenantId: req.tenantId || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
module.exports = router;
const { nowUTCMySQL, nowJSTMySQL } = require('../../utils/dateTime');
if (allowDebugRoutes) {
  router.get('/shifts/ping', authorize('admin'), (req, res) => {
    res.status(200).json({ ok: true, version: 'shifts-router-online' });
  });
  router.get('/debug/routes',
    authorize('admin'),
    async (req, res) => {
    try {
      const list = (router.stack || [])
        .map(l => l.route ? { path: l.route.path, methods: Object.keys(l.route.methods || {}) } : null)
        .filter(Boolean);
      res.status(200).json({ routes: list });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  router.get('/debug/time',
    authorize('admin'),
    async (req, res) => {
    try {
      res.status(200).json({ nowUTC: nowUTCMySQL(), nowJST: nowJSTMySQL() });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
}
// Salary history close & view
const salaryRepo = require('../salary/salary.repository');
router.post('/salary/close-month', authorize('admin'), async (req, res) => {
  try {
    const { userIds, month } = req.body || {};
    if (!userIds || !month) {
      return res.status(400).json({ message: 'Missing userIds/month' });
    }
    const ids = String(userIds).split(',').map(s => s.trim()).filter(Boolean);
    const { employees } = await salaryService.computePayslips(ids, month, req.tenantId || null);
    for (const e of employees) {
      await salaryRepo.saveHistory(e.userId, month, e, req.tenantId || null);
    }
    res.status(201).json({ closed: employees.length, month });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/salary/history', authorize('admin'), async (req, res) => {
  try {
    const { userId, month, page, pageSize } = req.query;
    const r = await salaryRepo.listHistory({ userId, month, page, pageSize, tenantId: req.tenantId || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Shift definitions & assignments
router.get('/shifts/definitions', authorize('admin'), async (req, res) => {
  try {
    const rows = await attendanceRepo.listShiftDefinitions({ tenantId: req.tenantId || null });
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/definitions', authorize('admin'), async (req, res) => {
  try {
    const { name, start_time, end_time, break_minutes } = req.body || {};
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ message: 'Missing name/start_time/end_time' });
    }
    const row = await attendanceRepo.upsertShiftDefinition({ name, start_time, end_time, break_minutes: break_minutes || 0, tenantId: req.tenantId || null });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/assign', authorize('admin'), async (req, res) => {
  try {
    const { userId, shiftId, startDate, endDate } = req.body || {};
    if (!userId || !shiftId || !startDate) {
      return res.status(400).json({ message: 'Missing userId/shiftId/startDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    await attendanceRepo.assignShiftToUser(userId, shiftId, startDate, endDate, { tenantId: req.tenantId || null });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post('/shifts/backfill', authorize('admin'), async (req, res) => {
  try {
    const { userId, fromDate, toDate } = req.body || {};
    if (!userId || !fromDate || !toDate) {
      return res.status(400).json({ message: 'Missing userId/fromDate/toDate' });
    }
    if (!(await userInTenant(req, userId))) return res.status(404).json({ message: 'User not found' });
    const r = await attendanceRepo.backfillShiftIdForUserRange(userId, fromDate, toDate, { tenantId: req.tenantId || null });
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Migration endpoint: Fix confirmed status for existing records
// - Mặc định là dry-run (chỉ đếm + xem mẫu). Chỉ UPDATE khi body.dryRun === false.
// - Chỉ áp dụng cho công ty (tenant) của admin đang đăng nhập.
// - 遅刻 được giữ nguyên (không ghi đè thông tin đi muộn).
// - Trước khi UPDATE, lưu status cũ vào bảng migration_backup_confirmed_status để có thể khôi phục.
router.post('/migration/fix-confirmed-status', authorize('admin'), async (req, res) => {
  const tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
  if (!tid) return res.status(400).json({ ok: false, error: 'tenant を特定できません' });
  const dryRun = req.body?.dryRun !== false;
  const where = `
      ad.tenant_id = ?
        AND ad.status IN ('未承認', '未入力')
        AND ad.memo IS NOT NULL
        AND ad.memo != ''
        AND EXISTS (
          SELECT 1
          FROM attendance a
          WHERE a.userId = ad.userId
            AND DATE(a.checkIn) = ad.date
            AND a.checkOut IS NOT NULL
        )
  `;
  let conn = null;
  try {
    if (dryRun) {
      const [[cnt]] = await db.query(`SELECT COUNT(*) AS n FROM attendance_daily ad WHERE ${where}`, [tid]);
      const [sample] = await db.query(
        `SELECT ad.id, ad.userId, u.username AS userName, DATE_FORMAT(ad.date, '%Y-%m-%d') AS date, ad.status
           FROM attendance_daily ad LEFT JOIN users u ON u.id = ad.userId
          WHERE ${where} ORDER BY ad.date DESC LIMIT 50`,
        [tid]
      );
      return res.json({ ok: true, dryRun: true, count: Number(cnt?.n || 0), sample });
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS migration_backup_confirmed_status (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        run_id VARCHAR(40) NOT NULL,
        tenant_id BIGINT UNSIGNED NOT NULL,
        daily_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        date DATE NOT NULL,
        old_status VARCHAR(32) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mbcs_run (run_id)
      )
    `);
    const runId = `${Date.now()}-${req.user.id}`;
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [ids] = await conn.query(`SELECT ad.id FROM attendance_daily ad WHERE ${where} FOR UPDATE`, [tid]);
    const idList = ids.map(r => r.id);
    let changedRows = 0;
    if (idList.length) {
      await conn.query(
        `INSERT INTO migration_backup_confirmed_status (run_id, tenant_id, daily_id, user_id, date, old_status)
         SELECT ?, ad.tenant_id, ad.id, ad.userId, ad.date, ad.status FROM attendance_daily ad WHERE ad.id IN (?)`,
        [runId, idList]
      );
      const [result] = await conn.query(
        `UPDATE attendance_daily SET status = '確認済み' WHERE id IN (?) AND tenant_id = ?`,
        [idList, tid]
      );
      changedRows = result.changedRows;
    }
    await conn.commit();
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'admin_migration_fix_confirmed_status', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ runId, tenantId: tid, count: idList.length }), afterData: JSON.stringify({ changedRows }) });
    } catch (e) { /* silently ignored */ }
    res.json({ ok: true, dryRun: false, runId, changedRows });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { /* silently ignored */ } }
    console.error('Migration failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Danh sách (CHỈ ĐỌC) các ngày có 2 行 chấm công trùng khung giờ — thường do duyệt 調整申請
// của đơn gửi trước khi 打刻 (đã sửa từ nay). Không sửa/xoá gì; admin tự xem và xoá 行 thừa bằng nút ×.
router.get('/attendance/suspected-duplicates', authorize('admin'), async (req, res) => {
  const tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
  if (!tid) return res.status(400).json({ ok: false, error: 'tenant を特定できません' });
  const months = Math.min(Math.max(parseInt(String(req.query.months || '6'), 10) || 6, 1), 24);
  try {
    const [rows] = await db.query(
      `SELECT a1.userId, u.username AS userName, u.employee_code AS employeeCode,
              DATE_FORMAT(a1.checkIn, '%Y-%m-%d') AS date,
              a1.id AS id1, DATE_FORMAT(a1.checkIn, '%H:%i') AS in1, DATE_FORMAT(a1.checkOut, '%H:%i') AS out1,
              a2.id AS id2, DATE_FORMAT(a2.checkIn, '%H:%i') AS in2, DATE_FORMAT(a2.checkOut, '%H:%i') AS out2
         FROM attendance a1
         JOIN attendance a2
           ON a2.userId = a1.userId AND a2.id > a1.id
          AND DATE(a2.checkIn) = DATE(a1.checkIn)
          AND a1.checkIn < COALESCE(a2.checkOut, a2.checkIn + INTERVAL 1 MINUTE)
          AND a2.checkIn < COALESCE(a1.checkOut, a1.checkIn + INTERVAL 1 MINUTE)
         JOIN users u ON u.id = a1.userId
        WHERE u.tenant_id = ?
          AND a1.checkIn >= (CURDATE() - INTERVAL ? MONTH)
        ORDER BY date DESC, u.employee_code ASC
        LIMIT 500`,
      [tid, months]
    );
    res.json({ ok: true, months, count: rows.length, rows });
  } catch (err) {
    console.error('suspected-duplicates failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
