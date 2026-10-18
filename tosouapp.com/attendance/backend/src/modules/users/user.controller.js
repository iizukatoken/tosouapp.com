const repo = require('./user.repository');
const deptChange = require('../departments/department.change.service');
const bcrypt = require('bcrypt');
const { bcryptRounds } = require('../../config/env');
const { invalidateUserCache } = require('../../core/middleware/authMiddleware');

function normalizeUserListResult(rows, limit, offset) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const parsedLimit = Number.parseInt(String(limit ?? normalizedRows.length ?? 0), 10);
  const parsedOffset = Number.parseInt(String(offset ?? 0), 10);
  return {
    rows: normalizedRows,
    total: normalizedRows.length,
    limit: Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : normalizedRows.length,
    offset: Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0
  };
}
// Controller quản trị người dùng
// API: Lấy danh sách tất cả nhân viên
exports.list = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = req.query.limit;
    const offset = req.query.offset;
    const role = req.query.role != null ? String(req.query.role || '').trim() : null;
    let departmentId = req.query.departmentId != null ? String(req.query.departmentId || '').trim() : null;
    const employmentStatus = req.query.employmentStatus != null ? String(req.query.employmentStatus || '').trim() : null;

    // ── Tenant isolation ──────────────────────────────────────────────────
    // req.tenantId is set by tenantMiddleware when ENABLE_MULTI_TENANT=true
    const tenantId = req.tenantId || null;
    // ─────────────────────────────────────────────────────────────────────

    // RBAC hierarchy: Manager can only see employees (role=3), not admin/manager
    const userRole = String(req.user?.role || '').toLowerCase();
    let roleFilter = role;
    if (userRole === 'manager') {
      roleFilter = 'employee';
    }
    // 社員一覧(/api/admin/employees)は名前の通り「社員」だけを見せる画面。
    // role が明示指定されていない限り、admin/manager/owner/sysadmin アカウントを
    // 混ぜて表示しない（/api/admin/users は他の用途で全ロールを使うため対象外）。
    if (!roleFilter && req.route?.path === '/employees') {
      roleFilter = 'employee';
    }
    const usePaged = q || limit != null || offset != null || roleFilter || departmentId || employmentStatus || tenantId;
    const superEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const meRole = String(req.user?.role || '').toLowerCase();
    const meEmail = String(req.user?.email || '').trim().toLowerCase();
    const isSuper = (superEmail && meEmail === superEmail) || meRole === 'super_admin' || meRole === 'super';
    if (usePaged) {
      const r = await repo.listUsersPaged({ q, role: roleFilter || null, departmentId: departmentId || null, employmentStatus: employmentStatus || null, limit, offset, tenantId });
      if (!isSuper && superEmail) {
        const rows2 = (r.rows || []).filter(u => String(u.email || '').trim().toLowerCase() !== superEmail);
        const delta = (r.rows || []).length - rows2.length;
        return res.status(200).json({ ...r, rows: rows2, total: Math.max(0, Number(r.total || 0) - delta) });
      }
      return res.status(200).json(r);
    }
    // Always filter by tenantId - never return unfiltered list
    const rows = tenantId
      ? await repo.listUsersByTenant(tenantId)
      : [];  // Return empty instead of ALL users from ALL tenants
    if (!isSuper && superEmail) rows = (rows || []).filter(u => String(u.email || '').trim().toLowerCase() !== superEmail);
    if (userRole === 'manager') {
      rows = (rows || []).filter(u => String(u.role || '').toLowerCase() === 'employee');
    }
    return res.status(200).json(normalizeUserListResult(rows, limit, offset));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
const authRepo = require('../auth/auth.repository');
const refreshRepo = require('../auth/refresh.repository');
const { validatePassword } = require('../../core/middleware/passwordPolicy');
// API: Tạo mới một tài khoản nhân viên
exports.create = async (req, res) => {
  try {
    const { employeeCode, username, email, password, role, departmentId, branchId, employmentType, hireDate, level, managerId, phone, birthDate, gender, avatarUrl, probationDate, officialDate, contractEnd, baseSalary, shiftId } = req.body || {};
    if (!username || !email || !password || !(role || departmentId !== undefined)) {
      return res.status(400).json({ message: 'Missing username/email/password' });
    }
    // Enforce password policy
    const { valid, message } = validatePassword(password);
    if (!valid) return res.status(400).json({ message });
    const existing = await authRepo.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'Email đã tồn tại!' });
    }
    // Enforce per-tenant user limit
    if (req.tenantId) {
      try {
        const tenantRepo = require('../tenants/tenant.repository');
        const tenant = await tenantRepo.getTenantById(req.tenantId);
        if (tenant && tenant.max_users && tenant.max_users > 0) {
          const db = require('../../core/database/mysql');
          const [[{ cnt } = { cnt: 0 }]] = await db.query(
            `SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND (employment_status IS NULL OR employment_status != 'terminated')`,
            [req.tenantId]
          );
          if (Number(cnt) >= tenant.max_users) {
            return res.status(403).json({ message: `ユーザー上限 (${tenant.max_users}名) に達しました。プランをアップグレードしてください。` });
          }
        }
      } catch (e) { /* limit check failure should not block user creation */ }
    }
    const hashed = bcrypt.hashSync(password, bcryptRounds);
    const id = await repo.createUser({ employeeCode, username, email, password: hashed, role, departmentId, branchId, employmentType, hireDate, level, managerId, phone, birthDate, gender, avatarUrl, probationDate, officialDate, contractEnd, baseSalary, shiftId, tenantId: req.tenantId || null });

    // Auto-add to tenant_users mapping so the user appears in tenant's user list
    if (req.tenantId) {
      try {
        const tenantRepo = require('../tenants/tenant.repository');
        await tenantRepo.addUserToTenant(id, req.tenantId, role || 'employee');
      } catch (e) { /* silently ignored — tenant_users insert may already exist */ }
    }

    res.status(201).json({ id });
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      const msg = String(err.message || '');
      if (msg.includes('uniq_employee_code')) {
        return res.status(409).json({ message: '社員番号が既に存在します。別の番号を入力してください。', field: 'employeeCode' });
      }
    }
    res.status(500).json({ message: err.message });
  }
};
// API: Cập nhật thông tin nhân viên (dành cho Admin)
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const body = req.body || {};
    if (body.email) {
      const email = String(body.email).trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      if (!ok) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      const existing = await require('../auth/auth.repository').findUserByEmail(email);
      if (existing && String(existing.id) !== String(id)) {
        return res.status(409).json({ message: 'Email already in use' });
      }
    }
    // 部署を変えたときは異動履歴も自動で記録する（過去の月は元の部署のまま集計されるように）
    const before = await repo.getUserById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'User not found' });
    await deptChange.saveWithDepartmentChange({
      before,
      toDepartmentId: body.departmentId,
      effectiveDate: body.departmentEffectiveDate,
      actorId: req.user?.id || null,
      tenantId: req.tenantId || null,
      save: () => repo.updateUser(id, {
      employeeCode: body.employeeCode,
      username: body.username,
      email: body.email,
      role: body.role,
      branchId: body.branchId,
      departmentId: body.departmentId,
      level: body.level,
      managerId: body.managerId,
      employmentType: body.employmentType,
      hireDate: body.hireDate,
      birthDate: body.birthDate,
      gender: body.gender,
      phone: body.phone,
      avatarUrl: body.avatarUrl,
      probationDate: body.probationDate,
      officialDate: body.officialDate,
      lang: body.lang,
      region: body.region,
      timezone: body.timezone,
      address: body.address,
      contractType: body.contractType,
      visaNumber: body.visaNumber,
      visaExpiry: body.visaExpiry,
      insuranceNumber: body.insuranceNumber,
      employmentStatus: body.employmentStatus,
      contractEnd: body.contractEnd,
      baseSalary: body.baseSalary,
      shiftId: body.shiftId,
      joinDate: body.joinDate,
      allowanceTransport: body.allowanceTransport,
      dependentsCount: body.dependentsCount,
      taxCategory: body.taxCategory,
      qualificationAllowance: body.qualificationAllowance,
      commuteMethod: body.commuteMethod,
      commuteDistanceKm: body.commuteDistanceKm,
      tenantId: req.tenantId || null
    })
    });
    // 役割を変えたら、ログイン時に実際に使われる tenant_users.role_in_tenant も同じ値にそろえる。
    // （以前は users.role だけ更新され、tenant_users 側が古い役割のまま残るため、
    //   画面上「従業員」に戻した社員がマネージャーとして管理画面に入れてしまっていた）
    // 役割が実際に変わった場合は既存のセッションを無効化し、新しい役割を即時に反映させる。
    const newRole = String(body.role || '').trim().toLowerCase();
    if (newRole && req.tenantId) {
      try {
        const db = require('../../core/database/mysql');
        const [[tu]] = await db.query('SELECT role_in_tenant FROM tenant_users WHERE user_id = ? AND tenant_id = ? LIMIT 1', [id, req.tenantId]);
        const oldTenantRole = tu ? String(tu.role_in_tenant || '').trim().toLowerCase() : null;
        if (oldTenantRole !== null && oldTenantRole !== newRole) {
          await db.query('UPDATE tenant_users SET role_in_tenant = ? WHERE user_id = ? AND tenant_id = ?', [newRole, id, req.tenantId]);
          try { await repo.incrementTokenVersion(id, req.tenantId); } catch (e) { /* silently ignored */ }
          try { await refreshRepo.deleteUserTokens(id); } catch (e) { /* silently ignored */ }
          try { invalidateUserCache && await invalidateUserCache(id, req.tenantId); } catch (e) { /* silently ignored */ }
          try {
            const auditRepo = require('../audit/audit.repository');
            await auditRepo.writeLog({ userId: req.user?.id, action: 'admin_employee_tenant_role_sync', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify({ userId: id, tenantId: req.tenantId, role_in_tenant: oldTenantRole }), afterData: JSON.stringify({ role_in_tenant: newRole }) });
          } catch (e) { /* silently ignored */ }
        }
      } catch (e) { /* tenant_users が無い環境では users.role のみ */ }
    }
    res.status(200).json({ id });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};
// API: Vô hiệu hóa (xóa mềm) tài khoản nhân viên
exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    // Trước đây là DELETE FROM users → ON DELETE CASCADE xoá luôn chấm công, báo cáo, lương của nhân viên.
    // Giờ chỉ vô hiệu hoá (giống DELETE /api/admin/employees/:id), dữ liệu được giữ nguyên.
    const before = await repo.getUserById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'User not found' });
    await repo.updateUser(id, { employmentStatus: 'inactive', tenantId: req.tenantId || null });
    try { await refreshRepo.deleteUserTokens(id); } catch (e) { /* silently ignored */ }
    try { invalidateUserCache && await invalidateUserCache(id, req.tenantId); } catch (e) { /* silently ignored */ }
    res.status(200).json({ id, status: 'inactive' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// API: Thay đổi phân quyền của nhân viên (Ví dụ: Từ nhân viên lên Quản lý)
exports.setRole = async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body || {};
    if (!id || !role) return res.status(400).json({ message: 'Missing id/role' });
    await repo.setRole(id, role, req.tenantId || null);
    await refreshRepo.deleteUserTokens(id);
    res.status(200).json({ id, role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// API: Thay đổi phòng ban của nhân viên
exports.setDepartment = async (req, res) => {
  try {
    const id = req.params.id;
    const { departmentId } = req.body || {};
    if (!id || !departmentId) return res.status(400).json({ message: 'Missing id/departmentId' });
    const before = await repo.getUserById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'User not found' });
    await deptChange.saveWithDepartmentChange({
      before, toDepartmentId: departmentId, effectiveDate: (req.body || {}).departmentEffectiveDate,
      actorId: req.user?.id || null, tenantId: req.tenantId || null,
      save: () => repo.setDepartment(id, departmentId, req.tenantId || null)
    });
    res.status(200).json({ id, departmentId });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};
// API: Cài đặt lại mật khẩu cho nhân viên (dành cho Admin)
exports.setPassword = async (req, res) => {
  try {
    const id = req.params.id;
    const { password } = req.body || {};
    if (!id || !password) return res.status(400).json({ message: 'Missing id/password' });
    const isHash = typeof password === 'string' && /^\$2[aby]\$\d+\$/.test(password);
    // Validate password policy (skip if already hashed)
    if (!isHash) {
      const { valid, message } = validatePassword(password);
      if (!valid) return res.status(400).json({ message });
    }
    const hashed = isHash ? password : bcrypt.hashSync(password, bcryptRounds);
    await repo.setPassword(id, hashed, req.tenantId || null);
    await refreshRepo.deleteUserTokens(id);
    await invalidateUserCache(id);
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Lấy thông tin tài khoản của chính mình (My Profile)
exports.meSelf = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });
    const row = await repo.getUserById(id, req.tenantId || null);
    if (!row) return res.status(404).json({ message: 'Not found' });
    res.status(200).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Nhân viên tự cập nhật thông tin cá nhân của mình
exports.updateMe = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });
    const body = req.body || {};
    if (body.email) {
      const email = String(body.email).trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      if (!ok) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      const existing = await require('../auth/auth.repository').findUserByEmail(email);
      if (existing && String(existing.id) !== String(id)) {
        return res.status(409).json({ message: 'Email already in use' });
      }
    }
    await repo.updateUser(id, {
      username: body.username,
      email: body.email,
      employmentType: body.employmentType,
      lang: body.lang,
      region: body.region,
      timezone: body.timezone
    });
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
