const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { rateLimitNamed } = require('../../core/middleware/rateLimit');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
const repo = require('./expenses.repository');
const auditRepo = require('../audit/audit.repository');
const noticesRepo = require('../notices/notices.repository');
const expenseTypesRepo = require('./expenseTypes.repository');
const expenseSettingsRepo = require('./expenseSettings.repository');
const salaryRepo = require('../salary/salary.repository');
const s3Service = require('../../core/services/s3.service');
const fileStore = require('../../core/services/fileStore.service');
const { uploadMemory, safeFilename } = require('../../core/middleware/uploadR2');
// 社員が自分で修正・削除できる状態
const EMPLOYEE_EDITABLE_STATUSES = new Set(['draft', 'pending', 'rejected']);
const metrics = require('../../core/metrics');
const db = require('../../core/database/mysql');
const { companyName } = require('../../config/env');

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

// 交通費 承認ワークフロー: 申請中(applied) -> 総務確認(soumu_checked) -> 社長承認(approved) -> 支給(paid)
// 差戻し(rejected) はどの承認段階からでも可能。役割: manager=総務, admin=社長/経理。
// 戻り値: null=OK / string=エラーメッセージ
function validateStatusTransition(currentStatus, nextStatus, role) {
  const from = String(currentStatus || '').toLowerCase();
  const to = String(nextStatus || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  const isManager = r === 'manager' || r === 'admin';
  const isAdmin = r === 'admin';

  // 差戻し: 承認過程(applied/soumu_checked/approved)からのみ、manager/admin
  if (to === 'rejected') {
    if (!['applied', 'soumu_checked', 'approved'].includes(from)) {
      return 'この状態からは差戻しできません';
    }
    return isManager ? null : '権限がありません';
  }

  // 総務確認: 申請中 -> 総務確認済み (manager or admin)
  if (to === 'soumu_checked') {
    if (from !== 'applied') return '申請中の項目のみ総務確認できます';
    return isManager ? null : '権限がありません';
  }

  // 社長承認: 総務確認済み -> 承認済み (admin only)
  if (to === 'approved') {
    if (from !== 'soumu_checked') return '総務確認済みの項目のみ承認できます';
    return isAdmin ? null : '社長承認は管理者のみ可能です';
  }

  // 支給: 承認済み -> 支給済み (admin only)
  if (to === 'paid') {
    if (from !== 'approved') return '承認済みの項目のみ支給できます';
    return isAdmin ? null : '支給処理は管理者のみ可能です';
  }

  // その他の遷移(applied再申請など)は従来どおり許可しない対象外 -> エラー
  return '不正なステータス遷移です';
}

router.use(authenticate);
router.use(resolveTenant);
router.get('/types',
  rateLimitNamed('expenses_types', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const rows = await expenseTypesRepo.list();
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/',
  rateLimitNamed('expenses_create', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const b = req.body || {};
      const date = String(b.date || '').slice(0, 10);
      const type = String(b.type || '').trim().toLowerCase() || null;
      const origin = String(b.origin || '').trim();
      const via = String(b.via || '').trim() || null;
      const destination = String(b.destination || '').trim();
      const baseAmount = parseFloat(String(b.amount || '0'));
      const memo = String(b.memo || '').trim();
      const purpose = String(b.purpose || '').trim();
      const teiki = !!b.teiki;
      const km = b.km == null ? null : parseFloat(String(b.km));
      const unitPricePerKm = b.unitPricePerKm == null ? null : parseFloat(String(b.unitPricePerKm));
      const tripType = String(b.tripType || '').trim().toLowerCase() || null;
      const tripCount = b.tripCount == null ? 1 : parseInt(String(b.tripCount), 10);
      const commuterPass = !!b.commuterPass;
      const siteName = String(b.siteName || '').trim() || null;
      const paymentMethod = String(b.paymentMethod || '').trim().toLowerCase() || null;
      const itemName = String(b.itemName || '').trim() || null;
      const vendor = String(b.vendor || '').trim() || null;
      const receiptUrl = String(b.receiptUrl || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Invalid date' });
      let amt = baseAmount;
      if (type === 'car') {
        const dist = km == null ? 0 : km;
        const unit = unitPricePerKm == null ? 0 : unitPricePerKm;
        if (dist > 0 && unit > 0) amt = dist * unit;
      }
      // KHÔNG tự nhân đôi khi 往復 (round_trip) hay nhân theo số lần khi 複数 (multi).
      // Nhân viên nhập số tiền bao nhiêu thì lưu đúng bấy nhiêu; trip_type chỉ là
      // thông tin ghi chú, không dùng để tính lại số tiền.
      if (!(amt >= 0)) return res.status(400).json({ message: 'Invalid amount' });
      const id = await repo.create({ userId: req.user.id, date, origin, via, destination, amount: amt, memo, type, purpose, teiki, receiptUrl, km, category: type, tripType, tripCount, unitPricePerKm, commuterPass, siteName, paymentMethod, itemName, vendor, clientToken: b.clientToken, tenantId: req.tenantId || null });
      try { await auditRepo.writeLog({ userId: req.user.id, action: 'expense_create', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ id, date, amount: amt, origin, destination }) }); } catch (e) { /* silently ignored */ }
      res.status(201).json({ id });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/my',
  rateLimitNamed('expenses_list', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const status = req.query.status ? String(req.query.status) : null;
      const type = req.query.type ? String(req.query.type).toLowerCase() : null;
      const rows = await repo.listMineAdvanced({ userId: req.user.id, month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null, status, type, tenantId: req.tenantId || null });
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/export.csv',
  rateLimitNamed('expenses_export_csv', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const status = req.query.status ? String(req.query.status) : null;
      const type = req.query.type ? String(req.query.type).toLowerCase() : null;
      const rows = await repo.listMineAdvanced({ userId: req.user.id, month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null, status, type, tenantId: req.tenantId || null });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="expenses_${month || 'all'}.csv"`);
      const header = ['date','route','type','amount','status','memo'];
      const csv = [header.join(',')].concat((rows || []).map(r => {
        const route = [r.origin || '', r.destination || ''].filter(Boolean).join(' → ');
        const t = String(r.category || '');
        const a = Number(r.amount || 0);
        const st = String(r.status || '');
        const memo = (r.memo || '').replace(/"/g,'""');
        // Prevent CSV Injection (starts with =, +, -, @)
        const safeRoute = /^[=\+\-\@]/.test(route) ? "'" + route : route;
        const safeMemo = /^[=\+\-\@]/.test(memo) ? "'" + memo : memo;
        return [r.date ? String(r.date).slice(0,10) : '', `"${safeRoute}"`, t, a, st, `"${safeMemo}"`].join(',');
      })).join('\n');
      
      if (s3Service.isR2Configured()) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const r2Key = `exports/csv/expenses/${ts}_expenses_${month || 'all'}.csv`;
        s3Service.uploadToR2(r2Key, Buffer.from('\uFEFF' + csv, 'utf8'), 'text/csv').catch(e => {
          console.error('Failed to auto-save export to R2:', e);
        });
      }

      res.status(200).send('\uFEFF' + csv);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/list',
  rateLimitNamed('expenses_admin_list', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    const startedAt = Date.now();
    let rowsCount = 0;
    let total = 0;
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const result = await repo.listAllPaged({
        month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null,
        page: req.query.page,
        limit: req.query.limit,
        departmentId: req.query.departmentId,
        userId: req.query.userId,
        employmentType: req.query.employmentType,
        name: req.query.name,
        status: req.query.status ? String(req.query.status) : null,
        minAmount: req.query.minAmount,
        maxAmount: req.query.maxAmount,
        approverId: req.query.approverId,
        sortBy: req.query.sortBy,
        sortDir: req.query.sortDir,
        tenantId: req.tenantId || null
      });
      rowsCount = Array.isArray(result?.rows) ? result.rows.length : 0;
      total = Number(result?.total || 0);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    } finally {
      recordEndpointPerf('expenses_admin_list', startedAt, {
        userId: req.user?.id || null,
        month: String(req.query.month || '').slice(0, 7) || null,
        page: Number.parseInt(String(req.query.page || '1'), 10) || 1,
        limit: Number.parseInt(String(req.query.limit || '20'), 10) || 20,
        rows: rowsCount,
        total
      });
    }
  }
);
router.get('/admin/dashboard',
  rateLimitNamed('expenses_admin_dashboard', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    const startedAt = Date.now();
    let trendPoints = 0;
    let departmentCount = 0;
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const months = req.query.months;
      const result = await repo.getAdminDashboard({ month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null, months, tenantId: req.tenantId || null });
      trendPoints = Array.isArray(result?.trend) ? result.trend.length : 0;
      departmentCount = Array.isArray(result?.departmentShares) ? result.departmentShares.length : 0;
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    } finally {
      recordEndpointPerf('expenses_admin_dashboard', startedAt, {
        userId: req.user?.id || null,
        month: String(req.query.month || '').slice(0, 7) || null,
        months: Number.parseInt(String(req.query.months || '6'), 10) || 6,
        trend_points: trendPoints,
        department_count: departmentCount
      });
    }
  }
);
router.get('/admin/detail/:id',
  rateLimitNamed('expenses_admin_detail', { windowMs: 60_000, max: 60 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const row = await repo.getAdminDetailById(id, req.tenantId || null);
      if (!row) return res.status(404).json({ message: 'Not found' });
      res.status(200).json(row);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/export.csv',
  rateLimitNamed('expenses_admin_export_csv', { windowMs: 60_000, max: 12 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const result = await repo.listAllPaged({
        month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null,
        page: 1,
        limit: 1000,
        departmentId: req.query.departmentId,
        userId: req.query.userId,
        employmentType: req.query.employmentType,
        name: req.query.name,
        status: req.query.status,
        minAmount: req.query.minAmount,
        maxAmount: req.query.maxAmount,
        approverId: req.query.approverId,
        sortBy: req.query.sortBy,
        sortDir: req.query.sortDir,
        tenantId: req.tenantId || null
      });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      
      const statusMap = {
        'applied': '承認待ち',
        'approved': '承認済',
        'rejected': '差戻し',
        'draft': '下書き',
        'pending': '未申請'
      };
      
      const empMap = {
        'full_time': '正社員',
        'part_time': 'アルバイト',
        'contract': '契約社員',
        'outsourced': '業務委託'
      };

      const csvHead = ['日付','申請者','社員番号','部署','雇用形態','区間/経路','金額(円)','ステータス','承認者'].join(',');
      const csvBody = rows.map((r) => {
        const route = [r.origin || '', r.destination || ''].filter(Boolean).join(' → ');
        // Prevent CSV Injection
        const safeRoute = /^[=\+\-\@]/.test(route) ? "'" + route : route;
        const st = statusMap[String(r.status || '').toLowerCase()] || r.status || '';
        const emp = empMap[String(r.employment_type || '').toLowerCase()] || r.employment_type || '';
        const dept = r.department_name || r.departmentId || '未設定';
        
        return [
          esc(String(r.date || '').slice(0,10)),
          esc(r.user_name || r.user_email || ''),
          esc(r.employee_code || ''),
          esc(dept),
          esc(emp),
          esc(safeRoute),
          esc(Number(r.amount || 0)),
          esc(st),
          esc(r.approver_name || '')
        ].join(',');
      }).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="expenses_admin_${month || 'all'}.csv"`);
      
      const csvOutput = '\uFEFF' + csvHead + '\n' + csvBody;
      if (s3Service.isR2Configured()) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const r2Key = `exports/csv/expenses/${ts}_expenses_admin_${month || 'all'}.csv`;
        s3Service.uploadToR2(r2Key, Buffer.from(csvOutput, 'utf8'), 'text/csv').catch(e => {
          console.error('Failed to auto-save export to R2:', e);
        });
      }

      res.status(200).send(csvOutput);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/export.xlsx',
  rateLimitNamed('expenses_admin_export_xlsx', { windowMs: 60_000, max: 10 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const month = String(req.query.month || '').slice(0, 7);
      const result = await repo.listAllPaged({
        month: (month && /^\d{4}-\d{2}$/.test(month)) ? month : null,
        page: 1, limit: 1000,
        departmentId: req.query.departmentId,
        userId: req.query.userId,
        status: req.query.status,
        tenantId: req.tenantId || null
      });
      const rows = Array.isArray(result?.rows) ? result.rows : [];

      const statusMap = { applied:'承認待ち', approved:'承認済', rejected:'差戻し', draft:'下書き', pending:'未申請', soumu_checked:'総務確認済', paid:'支給済' };
      const catMap = { transport:'交通費', meal:'食費', accommodation:'宿泊費', other:'その他' };

      const wb = new ExcelJS.Workbook();
      wb.creator = 'スマートE勤怠';
      wb.created = new Date();
      const label = month || 'all';
      const ws = wb.addWorksheet(`経費申請_${label}`);

      ws.columns = [
        { header: 'No',       key: 'no',        width: 6  },
        { header: '日付',     key: 'date',       width: 13 },
        { header: '氏名',     key: 'username',   width: 16 },
        { header: '社員番号', key: 'emp_code',   width: 14 },
        { header: '部署',     key: 'dept',       width: 14 },
        { header: 'カテゴリ', key: 'category',   width: 12 },
        { header: '区間 / 品名', key: 'route',   width: 30 },
        { header: '現場名',   key: 'site_name',  width: 18 },
        { header: '金額(円)', key: 'amount',     width: 12 },
        { header: '状態',     key: 'status',     width: 12 },
        { header: '申請日',   key: 'created_at', width: 18 },
        { header: '備考',     key: 'memo',       width: 24 },
      ];

      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e4d8c' } };
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      ws.getRow(1).eachCell(cell => {
        cell.fill = headerFill; cell.font = headerFont;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
      });
      ws.getRow(1).height = 22;

      const statusColors = { approved:'FFd1fae5', paid:'FFd1fae5', rejected:'FFffe4e6', draft:'FFf1f5f9', applied:'FFfff7ed', soumu_checked:'FFe0f2fe' };

      let totalAmount = 0;
      rows.forEach((r, idx) => {
        const route = r.item_name || [r.origin||'', r.destination||''].filter(Boolean).join(' → ') || '—';
        const st = String(r.status || '').toLowerCase();
        const amount = Number(r.amount || 0);
        totalAmount += amount;
        const row = ws.addRow({
          no:         idx + 1,
          date:       String(r.date || '').slice(0, 10),
          username:   r.user_name || r.user_email || '—',
          emp_code:   r.employee_code || '—',
          dept:       r.department_name || '—',
          category:   catMap[String(r.category || r.type || '').toLowerCase()] || r.category || r.type || '—',
          route,
          site_name:  r.site_name || '—',
          amount,
          status:     statusMap[st] || r.status || '—',
          created_at: String(r.created_at || '').slice(0, 16).replace('T', ' '),
          memo:       r.memo || '',
        });
        const bgColor = statusColors[st] || 'FFFFFFFF';
        row.eachCell(cell => {
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: bgColor } };
          cell.alignment = { vertical:'middle', wrapText: true };
          cell.border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'thin'}, right:{style:'thin'} };
        });
        row.getCell('amount').numFmt = '#,##0';
        row.getCell('amount').alignment = { horizontal:'right', vertical:'middle' };
        row.getCell('status').alignment = { horizontal:'center', vertical:'middle' };
        row.height = 18;
      });

      if (rows.length === 0) {
        const r = ws.addRow({ no:'', username:'データなし' });
        r.getCell('username').font = { italic:true, color:{ argb:'FF64748b' } };
      } else {
        // 合計行
        const totalRow = ws.addRow({ no:'', date:'', username:'合計', emp_code:'', dept:'', category:'', route:'', site_name:'', amount: totalAmount, status:'', created_at:'', memo:'' });
        totalRow.getCell('username').font = { bold:true };
        totalRow.getCell('amount').numFmt = '#,##0';
        totalRow.getCell('amount').font = { bold:true };
        totalRow.getCell('amount').alignment = { horizontal:'right', vertical:'middle' };
        totalRow.eachCell(cell => {
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFe2e8f0' } };
          cell.border = { top:{style:'medium'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        });
      }

      ws.views = [{ state:'frozen', xSplit:0, ySplit:1 }];
      ws.autoFilter = { from:'A1', to:'L1' };

      const filename = `expenses_admin_${label}.xlsx`;
      const encoded  = encodeURIComponent(filename);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`);

      const buf = await wb.xlsx.writeBuffer();
      if (s3Service.isR2Configured()) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        s3Service.uploadToR2(`exports/xlsx/expenses/${ts}_${filename}`, Buffer.from(buf), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .catch(e => console.error('R2 upload failed:', e));
      }
      res.status(200).end(buf);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/monthly-summary',
  rateLimitNamed('expenses_admin_monthly_summary', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const userIdRaw = String(req.query.userId || '').trim();
      const userId = userIdRaw || null;
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const [totals, closures] = await Promise.all([
        repo.getMonthlyApprovedTotals(month, userId, req.tenantId || null),
        repo.getMonthlyClosures(month, userId, req.tenantId || null)
      ]);
      res.status(200).json({ month, totals: totals || [], closures: closures || [] });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/admin/monthly-close',
  rateLimitNamed('expenses_admin_monthly_close', { windowMs: 60_000, max: 10 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.body?.month || '').slice(0, 7);
      const forceRecalc = !!req.body?.forceRecalc;
      const userIdRaw = String(req.body?.userId || '').trim();
      const userId = userIdRaw || null;
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const result = await repo.closeMonthlyApprovedTotals({
        month,
        closedBy: req.user.id,
        forceRecalc,
        userId,
        tenantId: req.tenantId || null
      });
      const closures = await repo.getMonthlyClosures(month, undefined, req.tenantId || null);
      res.status(200).json({ ok: true, result, closures: closures || [] });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/admin/months/approve',
  rateLimitNamed('expenses_admin_months_approve', { windowMs: 60_000, max: 20 }),
  // 社長承認(approved)は管理者のみ可能 — PATCH /:id/status の validateStatusTransition と同じ規則。
  // ここに manager を含めると、総務確認を経ずに一括で社長承認まで進めてしまう。
  authorize('admin'),
  async (req, res) => {
    try {
      const { userId, month } = req.body || {};
      if (!userId || !month) return res.status(400).json({ message: 'Missing userId or month' });
      const result = await repo.approveMonthByAdmin({ userId, month, approverId: req.user.id, tenantId: req.tenantId || null });
      try {
        await noticesRepo.createNotice({
          targetUserId: userId,
          targetMonth: month,
          message: `${month}の交通費申請が月次承認されました。`,
          createdBy: req.user.id
        });
      } catch (e) { /* silently ignored */ }
      res.status(200).json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get('/admin/monthly-history',
  rateLimitNamed('expenses_admin_monthly_history', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || '12'), 10);
      const userIdRaw = String(req.query.userId || '').trim();
      const userId = userIdRaw || null;
      const rows = await repo.listMonthlyClosureHistory({
        userId,
        limit: Number.isFinite(limit) ? limit : 12,
        tenantId: req.tenantId || null
      });
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/employee-overview',
  rateLimitNamed('expenses_admin_employee_overview', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const rows = await repo.getEmployeeMonthlyOverview(month, req.tenantId || null);
      res.status(200).json({ month, rows });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
// 社員が明細入力中に非課税/課税の目安をその場で確認できるよう、設定値だけを読み取り専用で公開する。
// 書き込みは admin/settings (admin限定) のみ — ここは GET のみで社員にも許可する。
router.get('/settings',
  rateLimitNamed('expenses_settings', { windowMs: 60_000, max: 60 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const year = new Date().getFullYear();
      const [salaryConfig, settings] = await Promise.all([
        salaryRepo.getConfigByYear(year, req.tenantId || null),
        expenseSettingsRepo.getSettings(req.tenantId || null)
      ]);
      const commuteAllowanceTaxFreeLimit = salaryConfig && salaryConfig.commute_allowance_tax_free_limit != null
        ? Number(salaryConfig.commute_allowance_tax_free_limit)
        : 150000;
      res.status(200).json({
        commuteAllowanceTaxFreeLimit,
        mileageTiers: settings.mileageTiers
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/settings',
  rateLimitNamed('expenses_admin_settings', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const year = new Date().getFullYear();
      const [salaryConfig, settings] = await Promise.all([
        salaryRepo.getConfigByYear(year, req.tenantId || null),
        expenseSettingsRepo.getSettings(req.tenantId || null)
      ]);
      const commuteAllowanceTaxFreeLimit = salaryConfig && salaryConfig.commute_allowance_tax_free_limit != null
        ? Number(salaryConfig.commute_allowance_tax_free_limit)
        : 150000;
      res.status(200).json({
        commuteAllowanceTaxFreeLimit,
        deadlineAlertDays: settings.deadlineAlertDays,
        mileageTiers: settings.mileageTiers
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/admin/settings',
  rateLimitNamed('expenses_admin_settings_update', { windowMs: 60_000, max: 20 }),
  authorize('admin'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const year = new Date().getFullYear();
      const tasks = [];
      if (body.commuteAllowanceTaxFreeLimit != null) {
        // salaryRepo.upsertConfig は camelCase の完全なデータを期待し、渡さなかった項目は
        // デフォルト値で上書きされてしまう(=既存の保険料率などが消える)ため、DB の生の行
        // (snake_case) を camelCase にマッピングしてから通勤費上限だけ差し替える。
        const row = await salaryRepo.getConfigByYear(year, req.tenantId || null);
        const current = row ? {
          healthInsuranceRate: row.health_insurance_rate,
          careInsuranceRate: row.care_insurance_rate,
          pensionRate: row.pension_rate,
          employmentInsuranceRate: row.employment_insurance_rate,
          taxRate: row.tax_rate,
          overtimeRate: row.overtime_rate,
          holidayRate: row.holiday_rate,
          lateNightRate: row.late_night_rate,
          workingMinutesPerMonth: row.working_minutes_per_month,
          standardDaysPerMonth: row.standard_days_per_month,
          baseHourlyRate: row.base_hourly_rate,
          roundingMinutes: row.rounding_minutes,
          roundingMode: row.rounding_mode,
          companyName: row.company_name,
          prefecture: row.prefecture
        } : {};
        tasks.push(salaryRepo.upsertConfig(req.tenantId || null, year, {
          ...current,
          commuteAllowanceTaxFreeLimit: body.commuteAllowanceTaxFreeLimit,
          updatedBy: req.user.id
        }));
      }
      if (body.deadlineAlertDays != null) {
        tasks.push(expenseSettingsRepo.upsertDeadlineAlertDays(req.tenantId || null, body.deadlineAlertDays, req.user.id));
      }
      if (Array.isArray(body.mileageTiers)) {
        tasks.push(expenseSettingsRepo.replaceMileageTiers(req.tenantId || null, body.mileageTiers));
      }
      await Promise.all(tasks);
      try {
        await auditRepo.writeLog({ userId: req.user.id, action: 'expenses_settings_upsert', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ year }) });
      } catch (e) { /* silently ignored */ }
      const [salaryConfig, settings] = await Promise.all([
        salaryRepo.getConfigByYear(year, req.tenantId || null),
        expenseSettingsRepo.getSettings(req.tenantId || null)
      ]);
      res.status(200).json({
        commuteAllowanceTaxFreeLimit: salaryConfig ? Number(salaryConfig.commute_allowance_tax_free_limit) : 150000,
        deadlineAlertDays: settings.deadlineAlertDays,
        mileageTiers: settings.mileageTiers
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/months/active',
  rateLimitNamed('expenses_active_month', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const r = await repo.getActiveMonth(req.user.id, req.tenantId || null);
      res.status(200).json(r || null);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/months/start',
  rateLimitNamed('expenses_start_month', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.body?.month || '').slice(0,7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const r = await repo.startMonth(req.user.id, month, req.tenantId || null);
      res.status(201).json(r || null);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post('/months/delete',
  rateLimitNamed('expenses_delete_month', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.body?.month || '').slice(0,7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      // Call the repository function
      const ok = await repo.deleteMonth(req.user.id, month, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Month not found or cannot be deleted' });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get('/months/my',
  rateLimitNamed('expenses_my_months', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const rows = await repo.listMonths(req.user.id, req.tenantId || null);
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get('/months/profile',
  rateLimitNamed('expenses_month_profile_get', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const row = await repo.getMonthProfile(req.user.id, month, req.tenantId || null);
      if (!row) return res.status(404).json({ message: 'Not found' });
      res.status(200).json(row);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post('/months/profile',
  rateLimitNamed('expenses_month_profile_post', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const b = req.body || {};
      const row = await repo.upsertMonthProfile({
        userId: req.user.id,
        month: b.month,
        employeeName: b.employeeName,
        employeeCode: b.employeeCode,
        birthDate: b.birthDate,
        startDate: b.startDate,
        tenantId: req.tenantId || null
      });
      res.status(200).json(row);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post('/months/apply',
  rateLimitNamed('expenses_apply_month', { windowMs: 60_000, max: 10 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.body?.month || '').slice(0,7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Invalid month' });
      const ok = await repo.applyMonth(req.user.id, month, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Month not found or cannot be applied' });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/months/applied',
  rateLimitNamed('expenses_latest_applied_month', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const r = await repo.getLatestAppliedMonthStats(req.user.id, req.tenantId || null);
      res.status(200).json(r || null);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/my/messages',
  rateLimitNamed('expenses_user_messages', { windowMs: 60_000, max: 60 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const rows = await repo.listRecentMessagesForUser(req.user.id, (month && /^\d{4}-\d{2}$/.test(month)) ? month : null, req.tenantId || null);
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/admin/messages',
  rateLimitNamed('expenses_admin_messages', { windowMs: 60_000, max: 60 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const month = String(req.query.month || '').slice(0, 7);
      const rows = await repo.listRecentMessagesForAdmin((month && /^\d{4}-\d{2}$/.test(month)) ? month : null, req.tenantId || null);
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.delete('/:id',
  rateLimitNamed('expenses_delete_mine', { windowMs: 60_000, max: 20 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const r = await repo.getById(id, req.tenantId || null);
      if (!r) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(r.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      // Không cho xóa bản ghi đã 支給済み (paid) — dữ liệu tài chính đã chi trả,
      // phải giữ lại để đối soát. Chặn ở backend kể cả khi gọi API trực tiếp.
      if (String(r.status || '').toLowerCase() === 'paid') {
        return res.status(409).json({ message: '支給済みの申請は削除できません。' });
      }
      // 社員本人は 下書き・差戻し のみ削除できる (申請中・総務確認済み・承認済みは管理側で処理中のため)
      if (!(role === 'manager' || role === 'admin') && !EMPLOYEE_EDITABLE_STATUSES.has(String(r.status || '').toLowerCase())) {
        return res.status(409).json({ message: '申請中・承認済みの申請は削除できません。' });
      }
      const ok = await repo.deleteMine(id, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Not Found' });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/:id',
  rateLimitNamed('expenses_get_one', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const row = await repo.getById(id, req.tenantId || null);
      if (!row) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(row.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      res.status(200).json(row);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/:id/files',
  rateLimitNamed('expenses_receipts_multi', { windowMs: 60_000, max: 12 }),
  authorize('employee','manager','admin'),
  uploadMemory.array('files', 8),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id) return res.status(400).json({ message: 'Invalid id' });
      const claim = await repo.getById(id, req.tenantId || null);
      if (!claim) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(claim.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const files = [];
      for (const f of (req.files || [])) {
        const filename = safeFilename(f);
        await fileStore.storeUploadedFile({ buffer: f.buffer, mimetype: f.mimetype, tenantId: req.tenantId || null, category: 'expenses', filename });
        files.push({ path: `/uploads/${filename}`, originalName: f.originalname, mimeType: f.mimetype, size: f.size });
      }
      const rows = await repo.addFiles(id, files, req.tenantId || null);
      res.status(201).json({ files: rows });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/:id/files',
  rateLimitNamed('expenses_receipts_list', { windowMs: 60_000, max: 60 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id) return res.status(400).json({ message: 'Invalid id' });
      const claim = await repo.getById(id, req.tenantId || null);
      if (!claim) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(claim.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const rows = await repo.listFiles(id, req.tenantId || null);
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/files/:fileId/download',
  rateLimitNamed('expenses_receipt_download', { windowMs: 60_000, max: 60 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const fileId = parseInt(String(req.params.fileId || '0'), 10);
      if (!fileId) return res.status(400).json({ message: 'Invalid id' });
      const file = await repo.getFileForDownload(fileId, req.tenantId || null);
      if (!file) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(file.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const buffer = await fileStore.readUploadedFile({ tenantId: req.tenantId || null, category: 'expenses', filename: file.path });
      if (!buffer) return res.status(404).json({ message: 'File not found' });
      res.setHeader('Cache-Control', 'no-store');
      if (file.mime) res.setHeader('Content-Type', file.mime);
      res.status(200).send(buffer);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.delete('/files/:fileId',
  rateLimitNamed('expenses_receipt_delete', { windowMs: 60_000, max: 12 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const fileId = parseInt(String(req.params.fileId || '0'), 10);
      if (!fileId) return res.status(400).json({ message: 'Invalid id' });
      const r = await repo.deleteFile(fileId, req.user.id, req.tenantId || null);
      if (!r.ok) return res.status(404).json({ message: 'Not Found' });
      if (r.path) await fileStore.deleteUploadedFile({ tenantId: req.tenantId || null, category: 'expenses', filename: r.path });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/admin/bulk-status',
  rateLimitNamed('expenses_admin_bulk_status', { windowMs: 60_000, max: 20 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const st = String(req.body?.status || '').toLowerCase();
      const note = String(req.body?.note || '').trim() || null;
      if (ids.length === 0 || !st) return res.status(400).json({ message: 'Invalid payload' });
      
      const userMonthMap = new Map(); // key: userId_month, value: { userId, month, totalAmount, count }

      let skipped = 0;
      for (const rawId of ids) {
        const id = parseInt(String(rawId), 10);
        if (id > 0) {
          const row = await repo.getById(id, req.tenantId || null);
          if (!row) { skipped++; continue; }
          const transErr = validateStatusTransition(row.status, st, req.user.role);
          if (transErr) { skipped++; continue; }
          const ok = await repo.updateStatus(id, st, note, req.user.id, req.tenantId || null);
          if (ok && row && row.userId && st !== 'pending') {
            const ym = row.date ? String(row.date).slice(0, 7) : null;
            if (ym) {
              const k = `${row.userId}_${ym}`;
              if (!userMonthMap.has(k)) {
                userMonthMap.set(k, { userId: row.userId, month: ym, totalAmount: 0, count: 0 });
              }
              const m = userMonthMap.get(k);
              m.totalAmount += Number(row.amount || 0);
              m.count += 1;
            }
          }
        }
      }

      // Send ONE notification per user per month
      for (const m of userMonthMap.values()) {
        const statusLabel = st === 'soumu_checked' ? '総務確認' : (st === 'approved' ? '社長承認' : (st === 'rejected' ? '差戻し' : (st === 'paid' ? '支給' : st)));
        await noticesRepo.createNotice({
          targetUserId: m.userId,
          targetMonth: m.month,
          message: `${m.month}月度の交通費申請（計${m.count}件, ¥${m.totalAmount.toLocaleString()}）が${statusLabel}されました。`,
          createdBy: req.user?.id || null
        });
      }

      res.status(200).json({ ok: true, processed: ids.length - skipped, skipped });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch('/:id/status',
  rateLimitNamed('expenses_admin_status', { windowMs: 60_000, max: 30 }),
  authorize('manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const st = String(req.body?.status || '').toLowerCase();
      const note = String(req.body?.note || '').trim() || null;
      const cur = await repo.getById(id, req.tenantId || null);
      if (!cur) return res.status(404).json({ message: 'Not Found' });
      const transErr = validateStatusTransition(cur.status, st, req.user.role);
      if (transErr) return res.status(403).json({ message: transErr });
      const ok = await repo.updateStatus(id, st, note, req.user.id, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Not Found' });
      try {
        const row = await repo.getById(id, req.tenantId || null);
        if (row && row.userId && st !== 'pending') {
          const statusLabel = st === 'soumu_checked' ? '総務確認' : (st === 'approved' ? '社長承認' : (st === 'rejected' ? '差戻し' : (st === 'paid' ? '支給' : st)));
          await noticesRepo.createNotice({
            targetUserId: row.userId,
            targetDate: row.date ? String(row.date).slice(0, 10) : null,
            targetMonth: row.date ? String(row.date).slice(0, 7) : null,
            message: `交通費申請（¥${Number(row.amount || 0).toLocaleString()}）が${statusLabel}されました。`,
            createdBy: req.user?.id || null
          });
        }
      } catch (e) { /* silently ignored */ }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/:id/apply',
  rateLimitNamed('expenses_apply', { windowMs: 60_000, max: 20 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const ok = await repo.updateStatus(id, 'applied', null, null, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Not Found' });
      try {
        const row = await repo.getById(id, req.tenantId || null);
        const userName = String(req.user?.username || req.user?.email || `user#${req.user?.id || ''}`);
        await noticesRepo.createAdminNotification({
          kind: 'expense_apply',
          title: '交通費申請',
          message: `${userName} さんが交通費を申請しました`,
          linkUrl: '/admin/expenses',
          payload: {
            source: 'expense',
            expenseId: id,
            userId: req.user?.id || null,
            date: row?.date ? String(row.date).slice(0, 10) : null,
            amount: Number(row?.amount || 0)
          },
          createdBy: req.user?.id || null,
          audience: 'admin_manager'
        });
      } catch (e) { /* silently ignored */ }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/:id/reply',
  rateLimitNamed('expenses_reply', { windowMs: 60_000, max: 20 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const note = String(req.body?.note || '').trim();
      if (!note) return res.status(400).json({ message: '理由を入力してください' });
      const ok = await repo.setEmployeeReplyAndApply(id, req.user.id, note, req.tenantId || null);
      if (!ok) return res.status(404).json({ message: 'Not Found' });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.patch('/:id',
  rateLimitNamed('expenses_update', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const cur = await repo.getById(id, req.tenantId || null);
      if (!cur) return res.status(404).json({ message: 'Not Found' });
      // 支給済み(paid)のデータは会計上確定済みのため、修正には新しい承認サイクルが必要。
      // DELETE /:id と同じ理由でここでも編集をブロックする。
      if (String(cur.status || '').toLowerCase() === 'paid') {
        return res.status(409).json({ message: '支給済みの申請は編集できません。' });
      }
      const role = String(req.user.role || '').toLowerCase();
      // 社員本人は 下書き・差戻し のみ修正できる (以前は申請中・承認済みでも金額などを変えられた)
      if (!(role === 'manager' || role === 'admin') && !EMPLOYEE_EDITABLE_STATUSES.has(String(cur.status || '').toLowerCase())) {
        return res.status(409).json({ message: '申請中・承認済みの申請は修正できません。' });
      }
      const ok = role === 'manager' || role === 'admin'
        ? await repo.updateByAdmin(id, req.body || {}, req.tenantId || null)
        : await repo.updateMine(id, req.user.id, req.body || {}, req.tenantId || null);
      if (!ok) return res.status(403).json({ message: 'Forbidden' });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.get('/:id/messages',
  rateLimitNamed('expenses_messages_list', { windowMs: 60_000, max: 60 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      try { await repo.ensureTable(); } catch (e) { /* silently ignored */ }
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const r = await repo.getById(id, req.tenantId || null);
      if (!r) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(r.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const rows = await repo.listMessages(id, req.tenantId || null);
      res.status(200).json(rows || []);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post('/:id/messages',
  rateLimitNamed('expenses_messages_add', { windowMs: 60_000, max: 30 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
    try {
      try { await repo.ensureTable(); } catch (e) { /* silently ignored */ }
      const id = parseInt(String(req.params.id || '0'), 10);
      if (!id || !(id > 0)) return res.status(400).json({ message: 'Invalid id' });
      const r = await repo.getById(id, req.tenantId || null);
      if (!r) return res.status(404).json({ message: 'Not Found' });
      const role = String(req.user.role || '').toLowerCase();
      if (String(r.userId) !== String(req.user.id) && !(role === 'manager' || role === 'admin')) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const text = String(req.body?.message || '').trim();
      if (!text) return res.status(400).json({ message: 'メッセージを入力してください' });
      const newId = await repo.addMessage({ expenseId: id, userId: req.user.id, message: text, tenantId: req.tenantId || null });
      res.status(201).json({ id: newId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
// 交通費精算書 印刷用ページ (サーバーサイドレンダリング)
router.get('/admin/monthly-detail/print',
  authorize('manager', 'admin'),
  async (req, res) => {
    try {
      const userId = String(req.query.userId || '').trim();
      const month = String(req.query.month || '').slice(0, 7);
      if (!userId || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).send('userId と month (YYYY-MM) は必須です');
      }
      const tenantId = req.tenantId || null;
      const tenantClause = tenantId != null ? ' AND ec.tenant_id = ?' : '';
      const params = [userId, month];
      if (tenantId != null) params.push(tenantId);
      const [expenses] = await db.query(`
        SELECT ec.*, (SELECT COUNT(*) FROM expense_files f WHERE f.expense_id = ec.id) AS file_count
        FROM expense_claims ec
        WHERE ec.userId = ? AND DATE_FORMAT(ec.date, '%Y-%m') = ?${tenantClause}
        ORDER BY ec.date ASC, ec.created_at ASC
        LIMIT 1000
      `, params);
      const [[userRow]] = await db.query(
        'SELECT u.id, u.username, u.email, u.employee_code, u.birth_date, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.departmentId WHERE u.id = ? LIMIT 1',
        [userId]
      );
      res.render('expenses-monthly-print', {
        user: userRow || {},
        month,
        expenses: expenses || [],
        companyName: companyName || ''
      });
    } catch (err) {
      res.status(500).send(`エラー: ${err.message}`);
    }
  }
);
// 交通費精算書 印刷用ページ (社員本人分のみ) — userId はクエリから受け取らず、必ず req.user.id を使う。
// 他人の userId を指定して覗き見できないようにするための唯一の安全策。
router.get('/my/monthly-detail/print',
  authorize('employee', 'manager', 'admin'),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const month = String(req.query.month || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).send('month (YYYY-MM) は必須です');
      }
      const tenantId = req.tenantId || null;
      const tenantClause = tenantId != null ? ' AND ec.tenant_id = ?' : '';
      const params = [userId, month];
      if (tenantId != null) params.push(tenantId);
      const [expenses] = await db.query(`
        SELECT ec.*, (SELECT COUNT(*) FROM expense_files f WHERE f.expense_id = ec.id) AS file_count
        FROM expense_claims ec
        WHERE ec.userId = ? AND DATE_FORMAT(ec.date, '%Y-%m') = ?${tenantClause}
        ORDER BY ec.date ASC, ec.created_at ASC
        LIMIT 1000
      `, params);
      const [[userRow]] = await db.query(
        'SELECT u.id, u.username, u.email, u.employee_code, u.birth_date, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.departmentId WHERE u.id = ? LIMIT 1',
        [userId]
      );
      res.render('expenses-monthly-print', {
        user: userRow || {},
        month,
        expenses: expenses || [],
        companyName: companyName || ''
      });
    } catch (err) {
      res.status(500).send(`エラー: ${err.message}`);
    }
  }
);

module.exports = router;
