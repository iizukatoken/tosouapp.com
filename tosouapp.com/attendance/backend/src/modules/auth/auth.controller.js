const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { nowJSTMySQL } = require('../../utils/dateTime');
const { validationResult } = require('express-validator');
const authRepository = require('./auth.repository');
const { jwtSecretCurrent, bcryptRounds, accessTokenExpires, refreshTokenExpiresDays, idleTimeoutSeconds, resetTokenExpiresMinutes, appBaseUrl } = require('../../config/env');
const refreshRepo = require('./refresh.repository');
const crypto = require('crypto');
const userRepo = require('../users/user.repository');
const auditRepo = require('../audit/audit.repository');
const { sendPasswordResetEmail, canSendMail } = require('../../core/notifications/email.service');
const { check2FARequired } = require('../../core/middleware/require2FA');
const log = require('../../core/logger');
const { normalizeRole } = require('../../utils/normalizeRole');
const tenantRepo = require('../tenants/tenant.repository');
// Controller xác thực: đăng ký và đăng nhập

function isHttpsRequest(req) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return xfProto.includes('https') || req.protocol === 'https';
}

function setSessionCookie(req, res, token) {
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: accessTokenExpires * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie('session_token', { path: '/' });
}

function normalizeDateLike(input) {
  if (!input) return '';
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return '';
    return input.toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

function normalizeEmployeeCodeLike(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const stripped = raw.replace(/^emp\s*/i, '');
  const digits = stripped.replace(/\D/g, '');
  if (digits) return String(parseInt(digits, 10));
  return stripped;
}

// normalizeRole is imported from ../../utils/normalizeRole

function buildResetUrl(req, token) {
  const base = String(appBaseUrl || '').trim()
    || `${isHttpsRequest(req) ? 'https' : 'http'}://${req.get('host')}`;
  const u = new URL('/reset-password', base);
  u.searchParams.set('token', token);
  return u.toString();
}

// Đăng ký tài khoản mới
exports.signup = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { username, email, password } = req.body;
    // Kiểm tra email đã tồn tại chưa
    const existingUser = await authRepository.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'Email đã tồn tại!' });
    }
    // Hash password
    const hashedPassword = bcrypt.hashSync(password, bcryptRounds);
    // Thêm user mới vào DB
    // Bạn cần bổ sung hàm createUser trong auth.repository.js
    await authRepository.createUser({ username, email, password: hashedPassword });
    res.status(201).json({ message: 'User was registered successfully!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Đăng nhập
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    try {
      const flags = await require('../settings/settings.service').getFlags();
      const lockLogin = !!flags.lockLoginExceptSuper;
      const superEmail = process.env.SUPER_ADMIN_EMAIL;
      if (lockLogin && String(email).toLowerCase() !== String(superEmail).toLowerCase()) {
        return res.status(423).json({ message: 'Login is temporarily locked by administrator' });
      }
    } catch (e) { /* silently ignored — if settings service fails, allow login */ }
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (String(user.employment_status || 'active') !== 'active') {
      try { await auditRepo.writeLog({ userId: user.id, action: 'login_block_inactive', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ employment_status: user.employment_status }) }); } catch (e) { log.warn('audit_write_failed', { action: 'login_block_inactive', userId: user.id, error_message: e.message }); }
      return res.status(403).json({ message: 'Account inactive' });
    }
    if (await authRepository.isLocked(user.id)) {
      return res.status(423).json({ message: 'Account locked. Try later.' });
    }
    const passwordIsValid = bcrypt.compareSync(password, user.password);
    if (!passwordIsValid) {
      const fails = await authRepository.incrementFail(email);
      if (fails >= 5) {
        await authRepository.lockUser(email, 15);
      }
      // Chống brute-force timing attack bằng cách phản hồi với độ trễ ngẫu nhiên
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      try { require('../../core/metrics').inc('login_fail', 1); } catch (e) { log.warn('metrics_error', { action: 'login_fail', error_message: e.message }); }
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    await authRepository.resetLock(email);
    const m = typeof user.password === 'string' ? user.password.match(/^\$2[aby]\$(\d+)\$/) : null;
    const storedRounds = m ? parseInt(m[1], 10) : null;
    if (storedRounds !== null && storedRounds < bcryptRounds) {
      const upgraded = bcrypt.hashSync(password, bcryptRounds);
      await userRepo.setPassword(user.id, upgraded);
    }
    const role = normalizeRole(user.role || 'employee');
    const tokenVersion = user.token_version || 1;
    const token = jwt.sign({ id: user.id, role, v: tokenVersion }, jwtSecretCurrent, { expiresIn: accessTokenExpires });
    const rt = crypto.randomBytes(48).toString('base64url');
    const expires = new Date(Date.now() + refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
    await refreshRepo.createToken({ userId: user.id, token: rt, expiresAt: expires.toISOString().slice(0,19).replace('T',' '), userAgent: req.headers['user-agent'], ip: req.ip, tenantId: user.tenant_id || null });
    try { await userRepo.updateUser(user.id, { lastLogin: new Date().toISOString().slice(0,19).replace('T',' ') }); } catch (e) { log.warn('update_last_login_failed', { userId: user.id, error_message: e.message }); }
    try { await userRepo.touchLastActive(user.id); } catch (e) { log.warn('touch_last_active_failed', { userId: user.id, error_message: e.message }); }
    const isHttps = isHttpsRequest(req);
    res.cookie('refreshToken', rt, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });
    const csrf = crypto.randomBytes(24).toString('hex');
    res.cookie('csrfToken', csrf, {
      httpOnly: false,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
      path: '/'
    });
    // NOTE: session_token cookie is set AFTER auto-select logic below
    // to ensure it contains the tenant-scoped JWT when applicable.

    // Check if 2FA is required for this user
    let requires2FA = false;
    try {
      requires2FA = await check2FARequired(user.id, role);
    } catch (e) { /* fail open */ }

    // Load tenants this user has access to
    // If multi-tenant is not yet enabled, fall back to legacy nextPath
    let tenants = [];
    const multiTenantEnabled = String(process.env.ENABLE_MULTI_TENANT || '').toLowerCase() === 'true';
    const isSuperRole = role === 'sysadmin'; // sysadmin bypasses tenant selection
    if (multiTenantEnabled && !isSuperRole) {
      try {
        tenants = await tenantRepo.getTenantsForUser(user.id);
      } catch (e) {
        log.warn('tenant_load_failed_on_login', { userId: user.id, error_message: e.message });
      }
    }

    // nextPath logic:
    // - sysadmin → always /platform/dashboard (platform management)
    // - employee with exactly 1 tenant → auto-select, skip select-company
    // - multi-tenant enabled + has tenants → /ui/select-company
    // - otherwise → legacy path
    const legacyNextPath = (role === 'admin' || role === 'manager' || role === 'owner')
      ? '/admin/dashboard'
      : '/ui/portal';

    let finalToken = token;
    let finalNextPath;
    let autoSelectedTenant = null;

    if (isSuperRole) {
      finalNextPath = '/platform/dashboard';
    } else if (multiTenantEnabled && tenants.length === 1 && (role === 'employee' || role === 'staff')) {
      // Auto-select the single tenant for employees — skip select-company entirely
      try {
        const tenantId = tenants[0].id;
        const tenantRole = tenants[0].role || role;
        // Phải mang `v` (token_version) giống token thường — thiếu nó thì authenticate()
        // coi v=1, user có token_version > 1 (từng bị revoke phiên) bị từ chối ngay.
        // Dùng cùng secret/thời hạn với token thường, không có secret dự phòng cứng.
        const tokenPayload = { id: user.id, email: user.email, role: tenantRole, v: tokenVersion, tid: tenantId };
        finalToken = jwt.sign(tokenPayload, jwtSecretCurrent, { expiresIn: accessTokenExpires });
        autoSelectedTenant = tenants[0];
        finalNextPath = (tenantRole === 'admin' || tenantRole === 'manager') ? '/admin/dashboard' : '/ui/portal';
      } catch (e) {
        log.warn('auto_select_tenant_failed', { userId: user.id, error_message: e.message });
        finalNextPath = '/ui/select-company';
      }
    } else if (multiTenantEnabled && !isSuperRole && tenants.length > 0) {
      finalNextPath = '/ui/select-company';
    } else {
      finalNextPath = legacyNextPath;
    }

    // Set session cookie with the final token (tenant-scoped if auto-selected)
    setSessionCookie(req, res, finalToken);

    res.status(200).json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: autoSelectedTenant ? (autoSelectedTenant.role || role) : role,
      accessToken: finalToken,
      nextPath: finalNextPath,
      requires2FA,
      tenants: multiTenantEnabled ? tenants : undefined,
      tenantId: autoSelectedTenant ? autoSelectedTenant.id : undefined,
      tenantName: autoSelectedTenant ? autoSelectedTenant.name : undefined,
      tenantLogo: autoSelectedTenant ? (autoSelectedTenant.logo_url || '') : undefined,
      tenantLogoName: autoSelectedTenant ? (autoSelectedTenant.logo_name || '') : undefined,
    });
    try {
      await auditRepo.writeLog({
        userId: user.id,
        action: 'login_success',
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        beforeData: null,
        afterData: JSON.stringify({ role })
      });
    } catch (e) { log.warn('audit_write_failed', { action: 'login_success', error_message: e.message }); }
    try { require('../../core/metrics').inc('login_success', 1); } catch (e) { log.warn('metrics_error', { action: 'login_success', error_message: e.message }); }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Thông tin tài khoản hiện tại
exports.me = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const user = await userRepo.getUserById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Use role from JWT (req.user.role) rather than DB role.
    // After select-tenant, JWT has role=admin even if DB has role=owner.
    // This ensures requireAdmin() on admin pages passes correctly.
    const roleFromJWT = req.user?.role || user.role;

    // Attach department name if departmentId exists
    if (user.departmentId) {
      try {
        const dept = await userRepo.getDepartmentById(user.departmentId);
        if (dept) user.departmentName = dept.name;
      } catch (e) { /* silently ignored */ }
    }

    // Attach tenant info from JWT or DB
    const rawTenantId = req.user?.tid || req.user?.tenant_id || req.tenantId || user.tenant_id || null;
    const tenantId = rawTenantId ? parseInt(String(rawTenantId), 10) : null;
    let tenantName = null;
    if (tenantId && Number.isFinite(tenantId)) {
      try {
        const tenantRepo = require('../tenants/tenant.repository');
        const t = await tenantRepo.getTenantById(tenantId);
        if (t && t.name) tenantName = t.name;
      } catch (e) { /* silently ignored */ }
    }

    res.status(200).json({ ...user, role: roleFromJWT, tenantId: tenantId || null, tenantName });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Quên mật khẩu: nhận email, phản hồi 202 (stub)
exports.forgotPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { email, birthDate, employeeCode } = req.body || {};
    if (!email || !birthDate || !employeeCode) return res.status(400).json({ message: 'Missing email/birthDate/employeeCode' });
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      return res.status(202).json({ ok: true });
    }
    const normalizedInputBirthDate = normalizeDateLike(birthDate);
    const normalizedUserBirthDate = normalizeDateLike(user.birth_date || user.birthDate);
    const normalizedInputEmployeeCode = normalizeEmployeeCodeLike(employeeCode);
    const normalizedUserEmployeeCode = normalizeEmployeeCodeLike(user.employee_code || user.employeeCode);
    if (normalizedInputBirthDate !== normalizedUserBirthDate || normalizedInputEmployeeCode !== normalizedUserEmployeeCode) {
      return res.status(202).json({ ok: true });
    }
    const token = require('crypto').randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + (resetTokenExpiresMinutes || 30) * 60 * 1000);
    const pr = require('./password_reset.repository');
    await pr.revokeUnsedForUser(user.id);
    await pr.createReset({
      userId: user.id,
      token,
      expiresAt: expires.toISOString().slice(0,19).replace('T',' '),
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      tenantId: user.tenant_id || null
    });
    const resetUrl = buildResetUrl(req, token);
    try {
      // Email ký tên theo công ty của user, không phải COMPANY_NAME chung của hệ thống.
      const userTenant = user.tenant_id ? await tenantRepo.getTenantById(user.tenant_id).catch(() => null) : null;
      const sent = await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        expiresMinutes: resetTokenExpiresMinutes || 30,
        companyName: userTenant?.name || null
      });
      if (!sent) {
        // SECURITY: do NOT log the reset URL or token — it contains a sensitive credential.
        // If mail is not configured, the user will not receive the link. Configure MAIL_PROVIDER.
        console.warn('[forgot-password] mail provider not configured; reset link could not be delivered. userId=' + user.id);
      }
    } catch (mailErr) {
      console.error('[forgot-password] email send failed:', mailErr && mailErr.message ? mailErr.message : mailErr);
      if (!canSendMail()) {
        console.warn('[forgot-password] mail provider not configured; set MAIL_PROVIDER/MAIL_API_KEY/MAIL_FROM');
      }
    }
    try { require('../../core/metrics').inc('forgot_password_requests', 1); } catch (e) { /* silently ignored */ }
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Reset mật khẩu: xác thực token (stub) và đặt mật khẩu mới
exports.resetPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ message: 'Missing token/newPassword' });
    const pr = require('./password_reset.repository');
    // Pass tenantId for scoped validation when available (from X-Tenant-Id header or req.tenantId)
    const tenantIdForReset = req.tenantId || null;
    const row = await pr.findValid(token, tenantIdForReset);
    if (!row) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (row.used_at) {
      return res.status(401).json({ message: 'Token already used' });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ message: 'Token expired' });
    }
    const hashed = require('bcrypt').hashSync(newPassword, require('../../config/env').bcryptRounds);
    await userRepo.setPassword(row.userId, hashed);
    await pr.consume(token);
    await require('./refresh.repository').deleteUserTokens(row.userId);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Đặt lại mật khẩu cho SUPER_ADMIN qua Postman (bảo vệ bằng code)
// Security: progressive lockout — block after repeated invalid code attempts
const _superResetFails = new Map(); // ip -> { count, lockedUntil }
const SUPER_RESET_MAX_FAILS = 5;
const SUPER_RESET_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

exports.superReset = async (req, res) => {
  try {
    const clientIp = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const lockInfo = _superResetFails.get(clientIp);
    if (lockInfo && lockInfo.lockedUntil && Date.now() < lockInfo.lockedUntil) {
      return res.status(423).json({ message: 'Too many failed attempts. Locked for 15 minutes.' });
    }

    const { email, password, code } = req.body || {};
    const superEmail = process.env.SUPER_ADMIN_EMAIL;
    const resetCode = process.env.SUPER_ADMIN_RESET_CODE;
    if (!password || !code) return res.status(400).json({ message: 'Missing password/code' });
    if (!resetCode || code !== resetCode) {
      // Track failed attempts
      const info = _superResetFails.get(clientIp) || { count: 0, lockedUntil: null };
      info.count++;
      if (info.count >= SUPER_RESET_MAX_FAILS) {
        info.lockedUntil = Date.now() + SUPER_RESET_LOCKOUT_MS;
        log.warn('super_reset_locked', { ip: clientIp, attempts: info.count });
      }
      _superResetFails.set(clientIp, info);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000)); // timing attack mitigation
      return res.status(403).json({ message: 'Forbidden' });
    }
    // Reset fail counter on success
    _superResetFails.delete(clientIp);

    let targetEmail = String(email || '').trim();
    if (superEmail) {
      if (!targetEmail) targetEmail = superEmail;
      if (targetEmail !== superEmail) return res.status(403).json({ message: 'Forbidden' });
    }
    let user = null;
    if (targetEmail) {
      user = await authRepository.findUserByEmail(targetEmail);
    } else {
      const db = require('../../core/database/mysql');
      const [rows] = await db.query(`SELECT * FROM users WHERE LOWER(role) = 'admin' ORDER BY id ASC LIMIT 2`);
      if (!rows || !rows.length) return res.status(404).json({ message: 'User not found.' });
      if (rows.length > 1) return res.status(400).json({ message: 'Multiple admin users found; specify email.' });
      user = rows[0];
      targetEmail = user.email;
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const isHash = typeof password === 'string' && /^\$2[aby]\$\d+\$/.test(password);
    const hashed = isHash ? password : bcrypt.hashSync(password, bcryptRounds);
    await userRepo.setPassword(user.id, hashed);
    res.status(200).json({ ok: true, id: user.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Tạo SUPER ADMIN qua Postman khi chưa có, bảo vệ bằng code
exports.superBootstrap = async (req, res) => {
  try {
    const clientIp = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const lockInfo = _superResetFails.get(clientIp);
    if (lockInfo && lockInfo.lockedUntil && Date.now() < lockInfo.lockedUntil) {
      return res.status(423).json({ message: 'Too many failed attempts. Locked for 15 minutes.' });
    }

    const { email, password, code, name } = req.body || {};
    const superEmail = process.env.SUPER_ADMIN_EMAIL;
    const resetCode = process.env.SUPER_ADMIN_RESET_CODE;
    if (!password || !code) return res.status(400).json({ message: 'Missing password/code' });
    if (!resetCode || code !== resetCode) {
      const info = _superResetFails.get(clientIp) || { count: 0, lockedUntil: null };
      info.count++;
      if (info.count >= SUPER_RESET_MAX_FAILS) {
        info.lockedUntil = Date.now() + SUPER_RESET_LOCKOUT_MS;
        log.warn('super_bootstrap_locked', { ip: clientIp, attempts: info.count });
      }
      _superResetFails.set(clientIp, info);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      return res.status(403).json({ message: 'Forbidden' });
    }
    _superResetFails.delete(clientIp);

    const targetEmail = String(email || '').trim();
    if (superEmail && targetEmail !== superEmail) return res.status(403).json({ message: 'Forbidden' });
    if (!superEmail) {
      const db = require('../../core/database/mysql');
      const [cnt] = await db.query(`SELECT COUNT(*) AS c FROM users WHERE LOWER(role) = 'admin'`);
      const hasAdmin = Number(cnt?.[0]?.c || 0) > 0;
      if (hasAdmin) return res.status(409).json({ message: 'Admin already exists' });
    }
    if (!targetEmail) return res.status(400).json({ message: 'Missing email' });
    const existing = await authRepository.findUserByEmail(targetEmail);
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }
    const hashed = /^\$2[aby]\$\d+\$/.test(password) ? password : bcrypt.hashSync(password, bcryptRounds);
    const id = await userRepo.createUser({
      employeeCode: null,
      username: name || process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email: targetEmail,
      password: hashed,
      role: 'admin',
      departmentId: null,
      employmentType: 'full_time',
      hireDate: nowJSTMySQL().slice(0, 10),
      level: null,
      managerId: null,
      phone: null,
      birthDate: null,
      gender: null,
      avatarUrl: null,
      probationDate: null,
      officialDate: null,
      contractEnd: null,
      baseSalary: null,
      shiftId: null
    });
    try { await auditRepo.writeLog({ userId: id, action: 'super_bootstrap', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: null, afterData: JSON.stringify({ id, email: targetEmail }) }); } catch (e) { /* silently ignored */ }
    res.status(201).json({ id, email: targetEmail });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Refresh access token (và rotate refresh token)
exports.refresh = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const bodyRt = (req.body || {}).refreshToken;
    const cookieRt = req.cookies?.refreshToken;
    const refreshToken = bodyRt || cookieRt;
    if (!refreshToken) {
      return res.status(401).json({ message: 'Missing refreshToken' });
    }
    if (cookieRt) {
      try {
        const origin = String(req.headers.origin || '');
        const host = String(req.headers.host || '').toLowerCase();
        const u = new URL(origin || `http://${host}`);
        const sameHost = !!(host && u.host.toLowerCase() === host);
        if (!sameHost) {
          const csrfHeader = req.headers['x-csrf-token'];
          const csrfCookie = req.cookies?.csrfToken;
          if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
            return res.status(403).json({ message: 'CSRF validation failed' });
          }
        }
      } catch (e) { /* silently ignored */ }
    }
    // Scope refresh token lookup by tenant (from current session) to prevent cross-tenant reuse
    const refreshTenantId = (() => {
      try {
        const sessionToken = req.cookies?.session_token || '';
        if (!sessionToken) return null;
        const secrets = [jwtSecretCurrent, process.env.JWT_SECRET_PREVIOUS].filter(Boolean);
        for (const s of secrets) {
          try { const d = require('jsonwebtoken').verify(sessionToken, s); if (d?.tid) return d.tid; } catch (e) { /* silently ignored */ }
        }
      } catch (e) { /* silently ignored */ }
      return null;
    })();
    const row = await refreshRepo.findToken(refreshToken, refreshTenantId);
    if (!row) {
      const any = await refreshRepo.findAnyToken(refreshToken);
      if (any && any.revoked_at) {
        await refreshRepo.deleteUserTokens(any.userId);
      }
      try { require('../../core/metrics').inc('refresh_fail', 1); } catch (e) { /* silently ignored */ }
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      await refreshRepo.revokeToken(refreshToken);
      return res.status(401).json({ message: 'Expired refresh token' });
    }
    // cấp access token mới
    const u = await userRepo.getUserById(row.userId);
    const role2 = normalizeRole(u?.role || 'employee');
    const tokenVersion2 = u?.token_version || 1;
    const idleSecs = Math.max(0, Number(idleTimeoutSeconds || 0));
    try {
      if (idleSecs > 0) {
        const last = u?.last_active_at ? new Date(u.last_active_at).getTime() : 0;
        if (last && (Date.now() - last) > idleSecs * 1000) {
          await refreshRepo.deleteUserTokens(u?.id || row.userId);
          res.clearCookie('refreshToken', { path: '/api/auth' });
          clearSessionCookie(res);
          return res.status(401).json({ message: 'Session expired (idle)' });
        }
      }
    } catch (e) { /* silently ignored */ }

    // Preserve tid and role from the current session_token cookie
    // so impersonation/tenant sessions keep their context after refresh.
    // BUG FIX: jwt.verify() từ chối token đã hết hạn theo mặc định — mà /refresh
    // CHỈ được gọi khi access token đã hết hạn, nên preservedTid trước đây LUÔN
    // rỗng (bắt lỗi âm thầm ở catch bên dưới) => user mất tid vĩnh viễn sau lần
    // refresh đầu tiên, mọi thao tác sau đó (chấm công...) ghi tenant_id=NULL.
    // Dùng ignoreExpiration để vẫn đọc được claim của token cũ (chữ ký vẫn phải
    // đúng), và luôn lấy user.tenant_id thật từ DB làm nguồn xác thực chính —
    // chỉ ưu tiên preservedTid khi nó KHÁC tenant gốc (case sysadmin/owner đang
    // impersonate 1 công ty khác), giúp tự phục hồi các phiên đang bị lỗi ngay
    // lần refresh tiếp theo mà không cần đăng xuất lại.
    let preservedTid = null;
    let preservedRole = null;
    try {
      const sessionToken = req.cookies?.session_token || '';
      if (sessionToken) {
        const secrets = [jwtSecretCurrent, process.env.JWT_SECRET_PREVIOUS].filter(Boolean);
        for (const s of secrets) {
          try {
            const decoded = jwt.verify(sessionToken, s, { ignoreExpiration: true });
            if (decoded?.tid) {
              preservedTid = decoded.tid;
              // Only preserve role if it came from a select-tenant flow (has tid)
              // e.g. owner acting as admin in a specific tenant
              if (decoded?.role && decoded.role !== (u?.role || 'employee')) {
                preservedRole = decoded.role;
              }
            }
            break;
          } catch (e) { /* silently ignored */ }
        }
      }
    } catch (e) { /* silently ignored */ }

    const ownTenantId = u?.tenant_id || null;
    const isImpersonating = preservedTid && ownTenantId && String(preservedTid) !== String(ownTenantId);
    const effectiveTid = isImpersonating ? preservedTid : (ownTenantId || preservedTid);
    const effectiveRole = isImpersonating && preservedRole ? preservedRole : role2;
    const tokenPayload = { id: row.userId, role: effectiveRole, v: tokenVersion2 };
    if (effectiveTid) tokenPayload.tid = effectiveTid;
    const token = jwt.sign(tokenPayload, jwtSecretCurrent, { expiresIn: accessTokenExpires });
    // rotate refresh token
    const newRt = crypto.randomBytes(48).toString('base64url');
    const expires = new Date(Date.now() + refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
    await refreshRepo.revokeToken(refreshToken);
    await refreshRepo.createToken({ userId: row.userId, token: newRt, expiresAt: expires.toISOString().slice(0,19).replace('T',' '), userAgent: req.headers['user-agent'], ip: req.ip, tenantId: row.tenant_id || null });
    try { await userRepo.touchLastActive(row.userId); } catch (e) { /* silently ignored */ }
    res.cookie('refreshToken', newRt, {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'lax',
      maxAge: refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });
    setSessionCookie(req, res, token);
    res.status(200).json({ accessToken: token });
    try { require('../../core/metrics').inc('token_refresh', 1); } catch (e) { /* silently ignored */ }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Logout: revoke refresh token hiện tại
exports.logout = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const bodyRt = (req.body || {}).refreshToken;
    const cookieRt = req.cookies?.refreshToken;
    const refreshToken = bodyRt || cookieRt;
    if (!refreshToken) return res.status(400).json({ message: 'Missing refreshToken' });
    if (cookieRt) {
      try {
        const origin = String(req.headers.origin || '');
        const host = String(req.headers.host || '').toLowerCase();
        const u = new URL(origin || `http://${host}`);
        const sameHost = !!(host && u.host.toLowerCase() === host);
        if (!sameHost) {
          const csrfHeader = req.headers['x-csrf-token'];
          const csrfCookie = req.cookies?.csrfToken;
          if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
            return res.status(403).json({ message: 'CSRF validation failed' });
          }
        }
      } catch (e) { /* silently ignored */ }
    }
    await refreshRepo.revokeToken(refreshToken);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.clearCookie('csrfToken', { path: '/' });
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Revoke toàn bộ refresh tokens của người dùng hiện tại
exports.revokeAll = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    await refreshRepo.deleteUserTokens(userId);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Select Tenant ───────────────────────────────────────────────────────────
// After login, user picks which company to enter.
// Issues a new access token with tenant_id embedded.
exports.selectTenant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const tenantId = parseInt(String(req.body?.tenant_id || ''), 10);
    if (!tenantId) return res.status(400).json({ message: 'Missing tenant_id' });

    // Verify user actually has access to this tenant — cannot spoof
    const access = await tenantRepo.getUserTenantAccess(userId, tenantId);
    if (!access) {
      return res.status(403).json({ message: 'Forbidden: no access to this tenant' });
    }

    // Issue new access token with tenant_id embedded
    const user = await userRepo.getUserById(userId);
    const role = normalizeRole(access.role_in_tenant || user?.role || 'employee');
    const tokenVersion = user?.token_version || 1;

    const tenantToken = jwt.sign(
      { id: userId, role, v: tokenVersion, tid: tenantId },
      jwtSecretCurrent,
      { expiresIn: accessTokenExpires }
    );

    setSessionCookie(req, res, tenantToken);

    // Decide where to send user after selecting tenant
    const nextPath = (role === 'admin' || role === 'manager') ? '/admin/dashboard' : '/ui/portal';

    // Load tenant info for frontend (logo, name, color)
    const tenant = await tenantRepo.getTenantById(tenantId);

    try {
      await auditRepo.writeLog({
        userId,
        action: 'select_tenant',
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        beforeData: null,
        afterData: JSON.stringify({ tenantId, role }),
      });
    } catch (e) { /* silently ignored */ }

    res.status(200).json({
      accessToken: tenantToken,
      tenantId,
      tenantName: tenant?.name || '',
      tenantLogo: tenant?.logo_url || '',
      tenantLogoName: tenant?.logo_name || '',
      tenantColor: tenant?.primary_color || '#0b2c66',
      role,
      nextPath,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── My Tenants ───────────────────────────────────────────────────────────────
// Returns the list of tenants the current user has access to.
// Used when user navigates directly to /ui/select-company.
exports.myTenants = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const user = await userRepo.getUserById(userId);
    const tenants = await tenantRepo.getTenantsForUser(userId);
    res.status(200).json({
      tenants,
      username: user?.username || user?.email || '',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
