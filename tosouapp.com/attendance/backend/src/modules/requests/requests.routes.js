const express = require('express');
const router = express.Router();
const ctrl = require('./requests.controller');
const { authenticate } = require('../../core/middleware/authMiddleware');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');

router.get('/', authenticate, resolveTenant, ctrl.listMine);
router.get('/recent/applied-types', authenticate, resolveTenant, ctrl.listRecentAppliedTypes);
router.post('/', authenticate, resolveTenant, ctrl.validateCreate, ctrl.create);

module.exports = router;
