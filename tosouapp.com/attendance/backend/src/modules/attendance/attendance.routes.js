/**
 * @module attendance.routes
 * Khai báo toàn bộ endpoint /api/attendance/* và chuyển tới các controller con.
 * Không có logic nghiệp vụ ở đây — handler nằm trong các file controller tương ứng.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { rateLimit, rateLimitNamed } = require('../../core/middleware/rateLimit');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');

const controller   = require('./attendance.controller');
const calendarCtrl = require('./attendance.calendar.controller'); // GET /calendar/*
const annualCtrl   = require('./attendance.annual.controller');   // GET /annual-summary, /month/report-matrix
const { exportGoOutPdf }  = require('./goout.export.pdf');
const { exportShiftsPdf } = require('./shifts.export.pdf');

// BẢO MẬT: route debug chỉ bật khi không phải môi trường production.
const allowDebugRoutes = process.env.NODE_ENV !== 'production';

// Multi-tenant: đảm bảo req.tenantId được set cho TẤT CẢ routes trong file này.
// Các route đã có resolveTenant riêng sẽ gọi lại lần 2 (idempotent, không gây lỗi).
// Quan trọng: phải để TRƯỚC các route definitions.
router.use(authenticate, resolveTenant);

// ─── Chấm công vào / ra ───────────────────────────────────────────────────────

router.post('/checkin',
  authenticate, resolveTenant,
  authorize('employee', 'manager', 'admin'),
  rateLimitNamed('attendance_checkin', { windowMs: 60_000, max: 30, keyBy: 'user_or_ip' }),
  controller.checkIn);

router.post('/checkout',
  authenticate, resolveTenant,
  authorize('employee', 'manager', 'admin'),
  rateLimitNamed('attendance_checkout', { windowMs: 60_000, max: 30, keyBy: 'user_or_ip' }),
  controller.checkOut);

router.post('/go-out',
  authenticate, resolveTenant,
  authorize('employee', 'manager', 'admin'),
  rateLimitNamed('attendance_go_out', { windowMs: 60_000, max: 30, keyBy: 'user_or_ip' }),
  controller.recordGoOut);

router.post('/return',
  authenticate, resolveTenant,
  authorize('employee', 'manager', 'admin'),
  rateLimitNamed('attendance_return', { windowMs: 60_000, max: 30, keyBy: 'user_or_ip' }),
  controller.recordReturn);

// ─── Quản lý ra ngoài (admin) ─────────────────────────────────────────────────

router.get('/go-out/admin-list',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.adminListGoOutRecords);

router.get('/go-out/export.pdf',
  rateLimitNamed('goout_export_pdf', { windowMs: 60_000, max: 10 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  exportGoOutPdf);

router.put('/go-out/admin/:id/force-end',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.adminForceEndGoOut);

router.put('/go-out/admin/:id',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.adminUpdateGoOut);

router.delete('/go-out/admin/:id',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.adminDeleteGoOut);

// ─── Loại công việc / Bảng công / GPS ────────────────────────────────────────

router.post('/worktype',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.setWorkType);

router.get('/timesheet',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.timesheet);

router.post('/gps',
  rateLimitNamed('attendance_gps', { windowMs: 60_000, max: 200 }),
  authenticate, authorize('employee', 'manager'),
  controller.gpsLog);

router.post('/sync',
  rateLimitNamed('attendance_sync', { windowMs: 60_000, max: 200 }),
  authenticate, authorize('employee', 'manager'),
  controller.syncOffline);

// ─── Trạng thái / Danh sách điểm danh ────────────────────────────────────────

router.get('/status',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.statusToday);

router.get('/today-summary',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.todaySummary);

router.get('/today-roster',
  authenticate, resolveTenant, authorize('admin', 'manager'),
  controller.todayRoster);

// ─── Ngày / Chi tiết ngày / Phân đoạn ────────────────────────────────────────

router.get('/date/:date',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.getDay);

router.get('/date/:date/daily',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.getDaily);

router.get('/date/:date/go-out',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.getGoOutHistory);

router.put('/date/:date',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.putDay);

router.put('/date/:date/daily',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.putDaily);

router.post('/date/:date/segments',
  authenticate, authorize('employee', 'manager'),
  controller.addSegment);

router.delete('/segment/:id',
  authenticate, authorize('employee', 'manager'),
  controller.deleteSegment);

router.post('/date/:date/submit',
  authenticate, authorize('employee', 'manager'),
  controller.submitDay);

// ─── Tháng ────────────────────────────────────────────────────────────────────

router.get('/month',
  authenticate, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.getMonth);

router.get('/month/detail',
  authenticate, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.getMonthDetail);

router.get('/month/report-matrix',
  authenticate, authorize('manager', 'admin'),
  annualCtrl.getReportMatrix);

router.get('/month/status',
  authenticate, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.getMonthStatus);

router.get('/month/status-bulk',
  authenticate, authorize('manager', 'admin'),
  controller.getMonthStatusBulk);

router.post('/month/submit',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.submitMonth);

router.post('/month/approve',
  rateLimitNamed('attendance_month_approve', { windowMs: 60_000, max: 100 }),
  authenticate, authorize('manager', 'admin'),
  controller.approveMonth);

router.post('/month/unlock',
  rateLimitNamed('attendance_month_unlock', { windowMs: 60_000, max: 50 }),
  authenticate, authorize('admin'),
  controller.unlockMonth);

// Nhân viên tự xem ngày thiếu chấm công của chính mình (không cần quyền manager/admin)
router.get('/month/missing/me',
  authenticate,
  controller.getMonthMissingMe);

router.get('/month/missing',
  authenticate, authorize('manager', 'admin'),
  controller.getMonthMissing);

router.post('/month/approve-ready',
  authenticate, authorize('manager', 'admin'),
  controller.approveReadyMonth);

router.get('/month/closure-summary',
  authenticate, authorize('manager', 'admin'),
  controller.getMonthClosureSummary);

// 月次勤怠入力の自動更新: データが変わったかの指紋（20秒ごとに画面が聞く）
router.get('/month/stamp', authenticate, authorize('employee', 'manager', 'admin', 'payroll'), require('./attendance.monthStamp').getStamp);
router.get('/month/statuses', authenticate, authorize('employee', 'manager', 'admin', 'payroll'), require('./attendance.monthStamp').getStatuses);

router.get('/ledger/month',
  authenticate, authorize('manager', 'admin'),
  require('./attendance.ledger.controller').getMonthLedger);

router.get('/ledger/export.xlsx',
  authenticate, authorize('manager', 'admin'),
  require('./attendance.ledger.controller').exportXlsx);

// 打刻編集（管理者・マネージャー）: 取消は原本を残す。理由必須・編集履歴と監査ログに残す・本人に通知
const punchEdit = require('./attendance.punchEdit');
router.get('/admin/punches', authenticate, authorize('manager', 'admin'), punchEdit.getDay);
router.post('/admin/punches/void', authenticate, authorize('manager', 'admin'), punchEdit.voidPunch);
router.post('/admin/punches/restore', authenticate, authorize('manager', 'admin'), punchEdit.restorePunch);
router.post('/admin/punches/edit', authenticate, authorize('manager', 'admin'), punchEdit.editPunch);
router.post('/admin/punches/add', authenticate, authorize('manager', 'admin'), punchEdit.addPunch);
router.post('/admin/shift-remind', authenticate, authorize('manager', 'admin'), require('./attendance.shiftRemind').remind);
router.get('/day-history', authenticate, authorize('employee', 'manager', 'admin'), punchEdit.dayHistory);
router.get('/admin/punch-audit', authenticate, authorize('manager', 'admin'), punchEdit.listAudit);
router.get('/admin/punch-audit/export.xlsx', authenticate, authorize('manager', 'admin'), punchEdit.exportAuditXlsx);

// 36協定 月次サマリー (monthly_summaries) — 手動実行は重いので admin のみ
const summaryCtrl = require('./attendance.summary.controller');
router.post('/summary/recompute', authenticate, authorize('admin'), summaryCtrl.recompute);
router.get('/summary', authenticate, authorize('manager', 'admin'), summaryCtrl.list);
router.get('/summary/config', authenticate, authorize('manager', 'admin'), summaryCtrl.getConfig);
router.patch('/summary/config', authenticate, authorize('admin'), summaryCtrl.setConfig);
router.get('/summary/admin-list', authenticate, authorize('manager', 'admin'), summaryCtrl.adminList);
router.get('/summary/export.csv', authenticate, authorize('manager', 'admin'), summaryCtrl.exportCsv);
router.get('/summary/export.xlsx', authenticate, authorize('manager', 'admin'), summaryCtrl.exportXlsx);

router.get('/month/summary',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.getMonthSummary);

router.put('/month/summary',
  authenticate, authorize('manager', 'admin'),
  controller.putMonthSummary);

router.put('/month/bulk',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.putMonthBulk);

// 入力用Excel取込: apply なし = 変更内容の確認だけ / apply=1 = 保存
const importUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /\.xlsx$/i.test(String(file.originalname || '')))
});
router.post('/month/import',
  rateLimitNamed('attendance_month_import', { windowMs: 60_000, max: 20 }),
  authenticate, authorize('employee', 'manager', 'admin'),
  (req, res, next) => importUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? '入力用Excelのファイルサイズが10MBを超過しているため取り込めません。' : 'ファイルを読み込めませんでした。' });
    next();
  }),
  require('./attendance.import.monthly').importMonthXlsx);

router.post('/month/sync-salary',
  rateLimitNamed('attendance_sync_salary', { windowMs: 60_000, max: 5 }),
  authenticate, authorize('manager', 'admin'),
  controller.syncSalary);

router.get('/month/export.xlsx',
  authenticate, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.exportMonthXlsx);

// ─── Ca làm — định nghĩa ─────────────────────────────────────────────────────

router.get('/shifts/definitions',
  authenticate, resolveTenant, authorize('manager', 'admin', 'payroll'),
  controller.listShiftDefinitions);

router.post('/shifts/definitions',
  rateLimitNamed('attendance_shift_def_post', { windowMs: 60_000, max: 10 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.postShiftDefinition);

router.delete('/shifts/definitions/:id',
  rateLimitNamed('attendance_shift_def_delete', { windowMs: 60_000, max: 10 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.deleteShiftDefinition);

// ─── Ca làm — phân ca ────────────────────────────────────────────────────────

router.get('/shifts/assignments',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.getShiftAssignments);

router.post('/shifts/assignments',
  rateLimitNamed('attendance_shift_assign', { windowMs: 60_000, max: 200 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.postShiftAssignment);

router.delete('/shifts/assignments/:id',
  rateLimitNamed('attendance_shift_assign_delete', { windowMs: 60_000, max: 200 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.deleteShiftAssignment);

router.post('/shifts/assign',
  authenticate, resolveTenant, authorize('admin', 'manager'),
  controller.postShiftAssignment);

router.post('/shifts/assign-bulk',
  rateLimitNamed('attendance_shift_assign_bulk', { windowMs: 60_000, max: 10 }),
  authenticate, resolveTenant, authorize('admin', 'manager'),
  controller.postShiftAssignmentBulk);

router.post('/shifts/backfill',
  authenticate, resolveTenant, authorize('admin'),
  async (req, res) => {
    try {
      const attendanceRepo = require('./attendance.repository');
      const { userId, fromDate, toDate } = req.body || {};
      if (!userId || !fromDate || !toDate) {
        return res.status(400).json({ message: 'Missing userId/fromDate/toDate' });
      }
      const tid = req.tenantId || null;
      const r = await attendanceRepo.backfillShiftIdForUserRange(userId, fromDate, toDate, { tenantId: tid });
      res.status(200).json(r);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

// ─── Ca làm — lưu hàng loạt / duyệt / bảng ca ────────────────────────────────

router.post('/shifts/bulk',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.postShiftsBulk);

router.get('/shifts/submissions',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.getShiftApprovals);

router.get('/shifts/matrix',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.getShiftMatrix);

router.get('/shifts/export.pdf',
  rateLimitNamed('shifts_export_pdf', { windowMs: 60_000, max: 10 }),
  authenticate, resolveTenant, authorize('manager', 'admin'),
  exportShiftsPdf);

router.get('/shifts/all-employees',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.getAllEmployeeShifts);

router.get('/shifts/all-employees/export',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.exportAllEmployeeShiftsExcel);

router.post('/shifts/submissions/approve',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.approveShiftMonth);

router.get('/shifts/user-month',
  authenticate, resolveTenant, authorize('manager', 'admin'),
  controller.getUserShiftsForMonth);

router.get('/shifts/monthly/:month',
  authenticate, resolveTenant, authorize('employee', 'manager', 'admin'),
  controller.getMyMonthlyShifts);

// ─── Kế hoạch / Chi tiết công việc ───────────────────────────────────────────

router.put('/plan',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.putPlan);

router.get('/work-details',
  authenticate, authorize('employee', 'manager', 'admin', 'payroll'),
  controller.getWorkDetails);

router.post('/work-details',
  rateLimitNamed('attendance_work_details_post', { windowMs: 60_000, max: 30 }),
  authenticate, authorize('manager', 'admin'),
  controller.postWorkDetail);

router.put('/work-details/:id',
  rateLimitNamed('attendance_work_details_put', { windowMs: 60_000, max: 30 }),
  authenticate, authorize('manager', 'admin'),
  controller.putWorkDetail);

router.delete('/work-details/:id',
  rateLimitNamed('attendance_work_details_delete', { windowMs: 60_000, max: 20 }),
  authenticate, authorize('manager', 'admin'),
  controller.deleteWorkDetail);

// ─── Hồ sơ nhân viên / Xuất file ─────────────────────────────────────────────

router.get('/user-profile',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.userProfileForMonthly);

router.get('/export',
  authenticate, authorize('employee', 'manager', 'admin'),
  controller.exportCsv);

// ─── Lịch ─────────────────────────────────────────────────────────────────────

router.get('/calendar',
  authenticate, authorize('employee', 'manager', 'admin'),
  calendarCtrl.getCalendar);

router.get('/calendar/day/:date',
  authenticate, authorize('employee', 'manager', 'admin'),
  calendarCtrl.getCalendarDay);

router.get('/calendar/working-days',
  authenticate, authorize('employee', 'manager', 'admin'),
  calendarCtrl.getCalendarWorkingDays);

// ─── Tổng hợp năm ─────────────────────────────────────────────────────────────

router.get('/annual-summary',
  authenticate, authorize('employee', 'manager', 'admin'),
  annualCtrl.getAnnualSummary);

// ─── Route debug (chỉ ngoài production) ──────────────────────────────────────

if (allowDebugRoutes) {
  const attendanceRepo = require('./attendance.repository');
  const calendarRepo = require('../calendar/calendar.repository');

  router.get('/calendar/debug', authenticate, authorize('employee', 'manager', 'admin'), async (req, res) => {
    try {
      const year = parseInt(String(req.query.year || new Date().getUTCFullYear()), 10);
      const r = await calendarRepo.computeYear(year);
      const summary = {
        year: r.year,
        keys: Object.keys(r),
        counts: {
          fixed: Array.isArray(r.fixed) ? r.fixed.length : 0,
          jp_auto: Array.isArray(r.jp_auto) ? r.jp_auto.length : 0,
          jp_substitute: Array.isArray(r.jp_substitute) ? r.jp_substitute.length : 0,
          jp_bridge: Array.isArray(r.jp_bridge) ? r.jp_bridge.length : 0,
          sundays: Array.isArray(r.sundays) ? r.sundays.length : 0,
          saturday_4th: Array.isArray(r.saturday_4th) ? r.saturday_4th.length : 0,
          off_days: Array.isArray(r.off_days) ? r.off_days.length : 0,
          detail: Array.isArray(r.detail) ? r.detail.length : 0
        }
      };
      res.status(200).json({ summary, sample: { jp_auto_first: r.jp_auto?.[0] || null, jp_substitute_first: r.jp_substitute?.[0] || null, jp_bridge_first: r.jp_bridge?.[0] || null } });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/debug/routes', authenticate, authorize('admin'), async (req, res) => {
    try {
      const list = (router.stack || [])
        .map(l => l.route ? { path: l.route.path, methods: Object.keys(l.route.methods || {}) } : null)
        .filter(Boolean);
      res.status(200).json({ routes: list });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post('/debug/routes', authenticate, authorize('admin'), async (req, res) => {
    try {
      const list = (router.stack || [])
        .map(l => l.route ? { path: l.route.path, methods: Object.keys(l.route.methods || {}) } : null)
        .filter(Boolean);
      res.status(200).json({ routes: list });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/debug/classify', authenticate, authorize('admin'), async (req, res) => {
    try {
      const userId = parseInt(req.query.userId, 10);
      const date = String(req.query.date || '').slice(0, 10);
      if (!userId || !date) return res.status(400).json({ message: 'Missing userId/date' });
      const userRepo = require('../users/user.repository');
      const rules = require('./attendance.rules');
      const user = await userRepo.getUserById(userId);
      const dept = user?.departmentId ? (await userRepo.getDepartmentById(user.departmentId)) : null;
      const rows = await attendanceRepo.listByUserBetween(userId, date, date);
      const rec = rows.find(r => String(r.checkOut || '').startsWith(date) || String(r.checkIn || '').startsWith(date)) || null;
      if (!rec) return res.status(404).json({ message: 'No attendance for date' });
      const computed = await rules.computeRecord(rec);
      res.status(200).json({
        user: { id: user?.id || userId, employment_type: user?.employment_type || null, departmentId: user?.departmentId || null, departmentName: dept?.name || null },
        attendance: { id: rec.id, checkIn: rec.checkIn, checkOut: rec.checkOut, shiftId: rec.shiftId || null },
        computed
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post('/debug/classify', authenticate, authorize('admin'), async (req, res) => {
    try {
      const userId = parseInt((req.body?.userId ?? req.query.userId), 10);
      const date = String((req.body?.date ?? req.query.date) || '').slice(0, 10);
      if (!userId || !date) return res.status(400).json({ message: 'Missing userId/date' });
      const userRepo = require('../users/user.repository');
      const rules = require('./attendance.rules');
      const user = await userRepo.getUserById(userId);
      const dept = user?.departmentId ? (await userRepo.getDepartmentById(user.departmentId)) : null;
      const rows = await attendanceRepo.listByUserBetween(userId, date, date);
      const rec = rows.find(r => String(r.checkOut || '').startsWith(date) || String(r.checkIn || '').startsWith(date)) || null;
      if (!rec) return res.status(404).json({ message: 'No attendance for date' });
      const computed = await rules.computeRecord(rec);
      res.status(200).json({
        user: { id: user?.id || userId, employment_type: user?.employment_type || null, departmentId: user?.departmentId || null, departmentName: dept?.name || null },
        attendance: { id: rec.id, checkIn: rec.checkIn, checkOut: rec.checkOut, shiftId: rec.shiftId || null },
        computed
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/shifts/ping', authenticate, authorize('admin'), (req, res) => {
    res.status(200).json({ ok: true });
  });
}

module.exports = router;
