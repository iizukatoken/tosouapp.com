const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { permit } = require('../../core/middleware/rbac');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
const { rateLimitNamed } = require('../../core/middleware/rateLimit');
const controller = require('./leave.controller');
const exportCtrl = require('./leave.export.controller');
const { exportLeavePdf } = require('./leave.export.pdf');

// Apply resolveTenant to ALL leave routes for tenant isolation
router.use(authenticate, resolveTenant);

router.post('/', authenticate, authorize('employee','manager','admin'), controller.create);
router.post('/paid', authenticate, authorize('employee','manager','admin'), controller.createPaid);
router.post('/my/cancel-paid', authenticate, authorize('employee','manager','admin'), controller.cancelMyPaid);
router.post('/notify-kubun', authenticate, authorize('employee','manager','admin'), controller.notifyLeaveKubun);
router.post('/reconcile-attendance', authenticate, permit('leaveAdmin','full'), controller.reconcileAttendance);
router.post('/grant', authenticate, permit('leaveAdmin','full'), controller.grant);
router.get('/eligible-list', authenticate, permit('leaveAdmin','view'), controller.eligibleList);
router.post('/grant-eligible/run', authenticate, permit('leaveAdmin','full'), controller.grantEligibleNow);
router.post('/request', authenticate, authorize('employee','manager','admin'), controller.createRequest);
router.put('/approve', authenticate, permit('leave','approve'), controller.approve);
router.get('/balance', authenticate, authorize('employee','manager','admin'), controller.balance);
router.get('/summary', authenticate, permit('leaveAdmin','view'), controller.summary);
router.post('/auto-grant/run', authenticate, permit('leaveAdmin','full'), controller.autoGrantNow);
router.get('/my', authenticate, authorize('employee','manager','admin'), controller.listMine);
// 簡易登録の「ステータス」用: 自分のその日の休暇申請の状況（承認済み / 申請中 / 差戻し）
router.get('/my/day-status', authenticate, authorize('employee','manager','admin'), async (req, res) => {
  try {
    const date = String(req.query?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Missing date' });
    const repo = require('./leave.repository');
    const map = await repo.listLeaveStatusByDate(req.user.id, date, date, req.tenantId || null);
    res.status(200).json(map[date] || { status: null, type: null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/my-balance', authenticate, authorize('employee','manager','admin'), controller.myBalance);
router.get('/user-balance', authenticate, authorize('manager','admin'), controller.userBalance);
router.get('/admin-balances', authenticate, authorize('manager','admin'), controller.adminBalances);
router.get('/admin-balances/export.xlsx', authenticate, authorize('manager','admin'), controller.exportBalancesXlsx);
router.get('/my-used-days', authenticate, authorize('employee','manager','admin'), controller.myUsedPaidLeaveDays);
router.get('/used-days', authenticate, authorize('manager','admin'), controller.usedPaidLeaveDays);
router.get('/grant-history', authenticate, authorize('manager','admin'), controller.grantHistory);
router.get('/', authenticate, authorize('manager','admin'), controller.listUser);
router.get('/admin-requests', authenticate, authorize('manager','admin'), controller.listAdminRequests);
router.get('/monthly-usage-summary', authenticate, authorize('manager','admin'), controller.monthlyUsageSummary);
router.get('/pending', authenticate, authorize('manager','admin'), controller.listPending);
router.get('/export.xlsx',
  rateLimitNamed('leave_export_xlsx', { windowMs: 60_000, max: 12 }),
  authorize('manager','admin'), exportCtrl.exportLeaveXlsx);
router.get('/export.csv',
  rateLimitNamed('leave_export_csv', { windowMs: 60_000, max: 12 }),
  authorize('manager','admin'), exportCtrl.exportLeaveCsv);
router.get('/export.pdf',
  rateLimitNamed('leave_export_pdf', { windowMs: 60_000, max: 10 }),
  authorize('manager','admin'), exportLeavePdf);
router.patch('/:id/status', authenticate, authorize('manager','admin'), controller.updateStatus);

module.exports = router;
