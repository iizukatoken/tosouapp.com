const express = require('express');
const router = express.Router();
const ctrl = require('./faq.controller');
const { authenticate } = require('../../core/middleware/authMiddleware');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');

// Public routes (no auth required)
router.get('/', ctrl.listFaqItems);
router.get('/categories', ctrl.getFaqCategories);

// Employee routes
router.post('/questions', authenticate, resolveTenant, ctrl.validateCreateQuestion, ctrl.createQuestion);
router.get('/questions/my', authenticate, resolveTenant, ctrl.getMyQuestions);

// Admin routes
router.get('/admin/questions', authenticate, resolveTenant, ctrl.getAllQuestions);
router.post('/admin/questions/:questionId/answer', authenticate, resolveTenant, ctrl.validateAdminAnswer, ctrl.answerQuestion);

module.exports = router;
