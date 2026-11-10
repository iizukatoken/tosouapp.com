const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../core/middleware/authMiddleware');
const { rateLimit, rateLimitNamed } = require('../../core/middleware/rateLimit');
const payslipRepo = require('../payslip/payslip.repository');
const userRepo = require('../users/user.repository');
const auditRepo = require('../audit/audit.repository');
const docRepo = require('../documents/documents.repository');
const path = require('path');
const fs = require('fs');
const db = require('../../core/database/mysql');
const uploadDocumentMemory = require('../../core/middleware/uploadDocumentMemory');
const s3Service = require('../../core/services/s3.service');
const { resolveTenant } = require('../../core/middleware/tenantMiddleware');
// resolveTenant là bắt buộc: thiếu nó thì req.tenantId = undefined và mọi truy vấn
// bên dưới KHÔNG lọc theo công ty (lộ hồ sơ/phiếu lương của công ty khác).
router.use(authenticate, resolveTenant);

async function ensureManagerSameDepartment(req, targetUserId) {
  // Luôn xác minh targetUserId thực sự tồn tại và thuộc đúng tenant trước —
  // kể cả admin, để tránh upload/xóa hồ sơ gán vào userId không tồn tại
  // hoặc thuộc công ty (tenant) khác. Manager thì giới hạn thêm theo phòng ban.
  const target = await userRepo.getUserById(targetUserId, req.tenantId || null);
  if (!target) return false;
  if (req.user.role !== 'manager') return true;
  const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
  return !!(me?.departmentId && target?.departmentId && String(me.departmentId) === String(target.departmentId));
}

router.post('/documents',
  rateLimitNamed('employee_documents_upload', { windowMs: 60_000, max: 10 }),
  authorize('admin','manager'),
  uploadDocumentMemory.single('file'),
  async (req, res) => {
  try {
    const { userId, type, title, description } = req.body;
    if (!userId || !type || !req.file) {
      return res.status(400).json({ message: 'Missing userId/type/file' });
    }
    if (!(await ensureManagerSameDepartment(req, userId))) {
      return res.status(403).json({ message: 'Forbidden: cross-department upload' });
    }
    const safeOriginalName = String(req.file.originalname || 'file').replace(/[\\/]+/g, '_').replace(/\s+/g, '_');
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeOriginalName}`;

    const uploadTenantId = req.tenantId || 0;
    const r2Key = `documents/${uploadTenantId}/${filename}`;
    let storedOnR2 = false;
    if (s3Service.isR2Configured()) {
      storedOnR2 = await s3Service.uploadToR2(r2Key, req.file.buffer, req.file.mimetype);
    }
    if (!storedOnR2) {
      // Fallback nếu R2 chưa cấu hình — không phải nơi lưu bền, chỉ để không
      // chặn tính năng khi thiếu R2 credentials ở môi trường dev/test.
      const dstDir = path.join(__dirname, '../../', 'uploads', 'documents');
      fs.mkdirSync(dstDir, { recursive: true });
      fs.writeFileSync(path.join(dstDir, filename), req.file.buffer);
    }

    const createdId = await docRepo.create({
      userId: parseInt(userId, 10),
      type,
      title: title || req.file.originalname,
      description: description || null,
      filename,
      mime: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user.id
    });

    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'employee_document_upload', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ id: createdId, userId: parseInt(userId, 10), type, filename }) });
    } catch (e) { /* silently ignored */ }

    res.status(201).json({ id: createdId, userId: parseInt(userId, 10), type, secureUrl: `/api/employee/documents/${createdId}/download` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/documents', authorize('employee','manager','admin'), async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || 1), 10);
    const pageSize = parseInt(String(req.query.pageSize || 20), 10);
    const types = req.query.type ? String(req.query.type).split(',').map(s => s.trim()).filter(Boolean) : [];
    const from = req.query.from || null;
    const to = req.query.to || null;
    const owner = req.query.owner || null;
    let userId = req.query.userId || null;
    if (req.user.role === 'employee') {
      userId = req.user.id;
    }
    const result = await docRepo.listFiltered({ userId, types, from, to, owner, page, pageSize, tenantId: req.tenantId || null });
    if (req.user.role === 'manager') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const cache = new Map();
      const filtered = [];
      for (const r of result.rows) {
        if (!cache.has(r.userId)) {
          cache.set(r.userId, await userRepo.getUserById(r.userId, req.tenantId || null));
        }
        const target = cache.get(r.userId);
        if (me?.departmentId && String(me.departmentId) === String(target?.departmentId)) {
          filtered.push(r);
        }
      }
      const total = filtered.length;
      const p = Math.max(1, page);
      const ps = Math.max(1, pageSize);
      const start = (p - 1) * ps;
      const data = filtered.slice(start, start + ps);
      return res.status(200).json({ data: data.map(r => ({ ...r, secureUrl: `/api/employee/documents/${r.id}/download` })), page: p, pageSize: ps, total, pages: Math.ceil(total / ps) });
    }
    res.status(200).json({ data: result.rows.map(r => ({ ...r, secureUrl: `/api/employee/documents/${r.id}/download` })), page: result.page, pageSize: result.pageSize, total: result.total, pages: result.pages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/documents/:id', authorize('employee','manager','admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await docRepo.getById(id, req.tenantId || null);
    if (!row) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (req.user.role === 'employee' && String(row.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'manager') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const target = await userRepo.getUserById(row.userId, req.tenantId || null);
      if (!me?.departmentId || String(me.departmentId) !== String(target?.departmentId)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }
    res.status(200).json({ ...row, secureUrl: `/api/employee/documents/${row.id}/download` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/documents/:id/download',
  rateLimitNamed('employee_documents_download', { windowMs: 60_000, max: 20 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await docRepo.getById(id, req.tenantId || null);
    if (!row) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (req.user.role === 'employee' && String(row.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'manager') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const target = await userRepo.getUserById(row.userId, req.tenantId || null);
      if (!me?.departmentId || String(me.departmentId) !== String(target?.departmentId)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'employee_document_download', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: row.id, userId: row.userId }), afterData: null });
    } catch (e) { /* silently ignored */ }

    let fileBuffer = null;
    if (s3Service.isR2Configured()) {
      const downloadTenantId = req.tenantId || 0;
      fileBuffer = await s3Service.downloadFromR2(`documents/${downloadTenantId}/${row.filename}`).catch(() => null);
      // File upload trước khi router này có resolveTenant nằm ở documents/0/
      if (!fileBuffer) fileBuffer = await s3Service.downloadFromR2(`documents/0/${row.filename}`).catch(() => null);
      if (!fileBuffer) fileBuffer = await s3Service.downloadFromR2(`documents/${row.filename}`).catch(() => null);
    }
    if (!fileBuffer) {
      const baseDir = path.join(__dirname, '../../', 'uploads', 'documents');
      const filePath = path.join(baseDir, row.filename);
      if (fs.existsSync(filePath)) {
        fileBuffer = fs.readFileSync(filePath);
      }
    }
    if (!fileBuffer) {
      return res.status(404).json({ message: 'File missing' });
    }
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.title || row.filename)}"`);
    return res.status(200).send(fileBuffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.delete('/documents/:id', authorize('admin','manager'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await docRepo.getById(id, req.tenantId || null);
    if (!row) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (!(await ensureManagerSameDepartment(req, row.userId))) {
      return res.status(403).json({ message: 'Forbidden: cross-department access' });
    }
    const deleteTenantId = req.tenantId || 0;
    if (s3Service.isR2Configured()) {
      // S3 DeleteObject thành công kể cả khi key không tồn tại, nên xóa ở mọi vị trí
      // file có thể nằm (documents/0/ = file upload trước khi có resolveTenant).
      for (const key of [`documents/${deleteTenantId}/${row.filename}`, `documents/0/${row.filename}`, `documents/${row.filename}`]) {
        await s3Service.deleteFromR2(key).catch(() => null);
      }
    }
    try {
      const filePath = path.join(__dirname, '../../', 'uploads', 'documents', row.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { /* silently ignored */ }
    await docRepo.remove(id);
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'employee_document_delete', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: row.id, userId: row.userId, filename: row.filename }), afterData: null });
    } catch (e) { /* silently ignored */ }
    res.status(200).json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/payslips/:id', authorize('employee','manager','admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await payslipRepo.getById(id, req.tenantId || null);
    if (!row) return res.status(404).json({ message: 'Not found' });
    if (req.user.role === 'manager') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const targetUser = await userRepo.getUserById(row.userId, req.tenantId || null);
      if (!me?.departmentId || String(me.departmentId) !== String(targetUser?.departmentId)) {
        return res.status(403).json({ message: 'Forbidden: cross-department access' });
      }
    } else if (req.user.role !== 'admin' && String(row.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden: not your payslip' });
    }
    res.status(200).json({
      id: row.id,
      userId: row.userId,
      month: row.month,
      originalName: row.original_name,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.created_at,
      secureUrl: `/api/payslips/me/file/${row.id}`
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/payslips/:id/download',
  rateLimitNamed('employee_payslips_download', { windowMs: 60_000, max: 20 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await payslipRepo.getById(id, req.tenantId || null);
    if (!row) return res.status(404).json({ message: 'Not found' });
    if (req.user.role === 'manager') {
      const me = await userRepo.getUserById(req.user.id, req.tenantId || null);
      const targetUser = await userRepo.getUserById(row.userId, req.tenantId || null);
      if (!me?.departmentId || String(me.departmentId) !== String(targetUser?.departmentId)) {
        return res.status(403).json({ message: 'Forbidden: cross-department access' });
      }
    } else if (req.user.role !== 'admin' && String(row.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden: not your payslip' });
    }
    try {
      await auditRepo.writeLog({ userId: req.user.id, action: 'employee_payslip_download', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ id: row.id, userId: row.userId }), afterData: null });
    } catch (e) { /* silently ignored */ }
    res.status(200).json({ secureUrl: `/api/payslips/me/file/${row.id}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Nhân viên gửi yêu cầu cập nhật hồ sơ -> vào hàng đợi phê duyệt
router.post('/profile-change',
  rateLimitNamed('employee_profile_change', { windowMs: 60_000, max: 5 }),
  authorize('employee','manager','admin'),
  async (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body || {};
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_change_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        fields_json TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME NULL,
        approved_by BIGINT UNSIGNED NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const filtered = require('./profileChange.fields').pickProfileChangeFields(b);
    if (!Object.keys(filtered).length) return res.status(400).json({ message: 'No changes provided' });
    const [result] = await db.query(`INSERT INTO user_change_requests (user_id, fields_json, status) VALUES (?, ?, 'pending')`, [userId, JSON.stringify(filtered)]);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
module.exports = router;
