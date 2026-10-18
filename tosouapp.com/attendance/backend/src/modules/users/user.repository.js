/**
 * @module user.repository
 * Data access layer for the users table.
 *
 * MULTI-TENANT: All functions accept an optional `tenantId` parameter.
 * When provided, queries are scoped to the specified tenant.
 * When ENABLE_MULTI_TENANT=true, callers MUST pass tenantId to prevent
 * cross-tenant data leakage.
 */
'use strict';

const db = require('../../core/database/mysql');
const { nowJSTMySQL } = require('../../utils/dateTime');
const { tenantScope } = require('../../core/database/tenantDb');

const _multiTenantEnabled = () => String(process.env.ENABLE_MULTI_TENANT || '').toLowerCase() === 'true';

/**
 * Parse tenant id safely.
 * @param {number|string|null} tenantId
 * @returns {number|null}
 */
const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

// これらの関数は SELECT * FROM users の結果をそのまま API レスポンスとして返す
// 呼び出し元が多数存在するため、ここで一度だけ加工しておけば全箇所を守れる。
// - password: bcrypt ハッシュを絶対にクライアントへ渡さない。
// - avatar_url: 生の /uploads パスの代わりに認証必須のダウンロードURLを返す
//   (静的配信 /uploads は認証なしで誰でも取得できてしまうため)。
function _sanitizeUserRow(row) {
  if (!row) return row;
  delete row.password;
  if (row.avatar_url) {
    row.avatar_url = `/api/admin/employees/${row.id}/avatar/download`;
  }
  return row;
}
function _sanitizeUserRows(rows) {
  return (rows || []).map(_sanitizeUserRow);
}

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string|null} employee_code
 * @property {string} username
 * @property {string} email
 * @property {string} role - 'admin' | 'manager' | 'employee' | 'payroll'
 * @property {number|null} departmentId
 * @property {string|null} branch_id
 * @property {string} employment_type - 'full_time' | 'part_time' | 'contract'
 * @property {string|null} hire_date - YYYY-MM-DD
 * @property {string} employment_status - 'active' | 'inactive'
 * @property {string|null} birth_date
 * @property {string|null} gender
 * @property {string|null} phone
 * @property {number|null} shift_id
 * @property {number|null} manager_id
 * @property {string|null} level
 * @property {number|null} base_salary
 * @property {number} token_version
 * @property {string|null} last_login
 * @property {string} created_at
 */

/**
 * @typedef {Object} PagedResult
 * @property {User[]} rows
 * @property {number} total
 * @property {number} limit
 * @property {number} offset
 */

module.exports = {
  /**
   * List all users (unpaged, ordered by hire_date).
   * @param {number|null} [tenantId] — when provided, only return users for that tenant
   * @returns {Promise<User[]>}
   */
  async listUsers(tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [rows] = await db.query(
        `SELECT * FROM users WHERE tenant_id = ? ORDER BY (hire_date IS NULL) ASC, hire_date ASC, COALESCE(employee_code, '') ASC, id ASC`,
        [tid]
      );
      return _sanitizeUserRows(rows);
    }
    const [rows] = await db.query(`SELECT * FROM users ORDER BY (hire_date IS NULL) ASC, hire_date ASC, COALESCE(employee_code, '') ASC, id ASC`);
    return _sanitizeUserRows(rows);
  },

  async listUsersByTenant(tenantId) {
    const [rows] = await db.query(
      `SELECT * FROM users WHERE tenant_id = ? ORDER BY (hire_date IS NULL) ASC, hire_date ASC, COALESCE(employee_code,'') ASC, id ASC`,
      [tenantId]
    );
    return _sanitizeUserRows(rows);
  },
  /**
   * List users with pagination, filtering by role/department/status/search.
   * @param {Object} options
   * @param {string} [options.q] - Search query (matches employee_code, username, email, id)
   * @param {string|null} [options.role] - Filter by role ('admin', 'manager', 'employee')
   * @param {string|null} [options.departmentId] - Filter by department ID
   * @param {string|null} [options.employmentStatus] - Filter by status ('active', 'inactive')
   * @param {number} [options.limit=100]
   * @param {number} [options.offset=0]
   * @returns {Promise<PagedResult>}
   */
  async listUsersPaged({ q = '', role = null, departmentId = null, employmentStatus = null, limit = 100, offset = 0, tenantId = null } = {}) {
    const qq = String(q || '').trim().toLowerCase();
    const lim = Math.min(5000, Math.max(1, Number.parseInt(String(limit || '100'), 10) || 100));
    const off = Math.max(0, Number.parseInt(String(offset || '0'), 10) || 0);
    const where = [];
    const params = [];
    // ── Tenant isolation ──────────────────────────────────────────────────
    if (tenantId) {
      where.push('tenant_id = ?');
      params.push(parseInt(String(tenantId), 10));
    }
    // ─────────────────────────────────────────────────────────────────────
    if (role != null && String(role || '').trim()) {
      where.push('LOWER(role) = ?');
      params.push(String(role).toLowerCase());
    }
    if (departmentId != null && String(departmentId || '').trim()) {
      where.push('departmentId = ?');
      params.push(String(departmentId));
    }
    if (employmentStatus != null && String(employmentStatus || '').trim()) {
      const esVal = String(employmentStatus).toLowerCase().trim();
      // Treat NULL employment_status as 'active' (legacy rows before status column was added)
      if (esVal === 'active') {
        where.push('(LOWER(employment_status) = ? OR employment_status IS NULL)');
        params.push('active');
      } else {
        where.push('LOWER(employment_status) = ?');
        params.push(esVal);
      }
    }
    if (qq) {
      where.push(`LOWER(CONCAT_WS(' ', employee_code, username, email, id)) LIKE ?`);
      params.push(`%${qq}%`);
    }
    const wsql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const [rows] = await db.query(
      `SELECT * FROM users ${wsql} ORDER BY (hire_date IS NULL) ASC, hire_date ASC, COALESCE(employee_code, '') ASC, id ASC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    const [cntRows] = await db.query(
      `SELECT COUNT(*) AS total FROM users ${wsql}`,
      params
    );
    const total = Number(cntRows?.[0]?.total || 0);
    return { rows: _sanitizeUserRows(rows), total, limit: lim, offset: off };
  },
  /**
   * Get a single user by ID.
   * @param {number|string} id
   * @param {number|null} [tenantId] — when provided, verify user belongs to tenant
   * @returns {Promise<User|undefined>}
   */
  async getUserById(id, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [rows] = await db.query(`SELECT * FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`, [id, tid]);
      return _sanitizeUserRow(rows[0]);
    }
    const [rows] = await db.query(`SELECT * FROM users WHERE id = ? LIMIT 1`, [id]);
    return _sanitizeUserRow(rows[0]);
  },
  async createUser({ employeeCode = null, username, email, password, role = 'employee', departmentId = null, branchId = null, employmentType = 'full_time', hireDate = null, level = null, managerId = null, phone = null, birthDate = null, gender = null, avatarUrl = null, probationDate = null, officialDate = null, contractEnd = null, baseSalary = null, shiftId = null, employmentStatus = null, joinDate = null, tenantId = null }) {
    const today = nowJSTMySQL().slice(0, 10); // ngày hôm nay theo giờ Nhật (server chạy UTC)
    const tid = _tid(tenantId);
    const cols = [
      'employee_code',
      'username',
      'email',
      'email_lower',
      'password',
      'role',
      'branch_id',
      'departmentId',
      'level',
      'manager_id',
      'employment_type',
      'hire_date',
      'birth_date',
      'gender',
      'phone',
      'avatar_url',
      'probation_date',
      'official_date',
      'contract_end',
      'base_salary',
      'shift_id',
      'employment_status',
      'join_date',
      'tenant_id'
    ];
    const vals = [
      employeeCode,
      username,
      email,
      email,
      password,
      role,
      branchId,
      departmentId,
      level,
      managerId,
      employmentType || 'full_time',
      hireDate,
      birthDate,
      gender,
      phone,
      avatarUrl,
      probationDate,
      officialDate,
      contractEnd,
      baseSalary,
      shiftId,
      employmentStatus || 'active',
      joinDate || hireDate || today,
      tid
    ];
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders})`;
    const [res] = await db.query(sql, vals);
    const id = res.insertId;
    if (!employeeCode) {
      const gen = 'EMP' + String(id).padStart(3, '0');
      await db.query(`UPDATE users SET employee_code = ? WHERE id = ?`, [gen, id]);
    }
    return id;
  },
  async updateUser(id, { employeeCode, username, email, role, branchId, departmentId, level, managerId, employmentType, hireDate, birthDate, gender, phone, avatarUrl, probationDate, officialDate, lang, region, timezone, address, contractType, visaNumber, visaExpiry, insuranceNumber, employmentStatus, contractEnd, baseSalary, shiftId, joinDate, lastLogin, allowanceTransport, dependentsCount, taxCategory, qualificationAllowance, commuteMethod, commuteDistanceKm, tenantId = null }) {
    const tid = _tid(tenantId);
    const whereClause = tid != null ? `WHERE id = ? AND tenant_id = ?` : `WHERE id = ?`;
    const whereParams = tid != null ? [id, tid] : [id];
    const sql = `
      UPDATE users
      SET username = COALESCE(?, username),
          email = COALESCE(?, email),
          email_lower = COALESCE(LOWER(?), email_lower),
          role = COALESCE(?, role),
          branch_id = COALESCE(?, branch_id),
          departmentId = COALESCE(?, departmentId),
          level = COALESCE(?, level),
          manager_id = COALESCE(?, manager_id),
          employment_type = COALESCE(?, employment_type),
          employee_code = COALESCE(?, employee_code),
          hire_date = COALESCE(?, hire_date),
          birth_date = COALESCE(?, birth_date),
          gender = COALESCE(?, gender),
          phone = COALESCE(?, phone),
          avatar_url = COALESCE(?, avatar_url),
          probation_date = COALESCE(?, probation_date),
          official_date = COALESCE(?, official_date),
          lang = COALESCE(?, lang),
          region = COALESCE(?, region),
          timezone = COALESCE(?, timezone),
          address = COALESCE(?, address),
          contract_type = COALESCE(?, contract_type),
          visa_number = COALESCE(?, visa_number),
          visa_expiry = COALESCE(?, visa_expiry),
          insurance_number = COALESCE(?, insurance_number),
          employment_status = COALESCE(?, employment_status),
          contract_end = COALESCE(?, contract_end),
          base_salary = COALESCE(?, base_salary),
          shift_id = COALESCE(?, shift_id),
          join_date = COALESCE(?, join_date)
          ${'' /* keep last_login separate to avoid MySQL syntax issues */}
          , last_login = COALESCE(?, last_login)
          , allowance_transport = COALESCE(?, allowance_transport)
          , dependents_count = COALESCE(?, dependents_count)
          , tax_category = COALESCE(?, tax_category)
          , qualification_allowance = COALESCE(?, qualification_allowance)
          , commute_method = COALESCE(?, commute_method)
          , commute_distance_km = COALESCE(?, commute_distance_km)
      ${whereClause}
    `;
    await db.query(sql, [
      username || null,
      email || null,
      email || null,
      role || null,
      branchId !== undefined ? branchId : null,
      departmentId || null,
      level || null,
      managerId || null,
      employmentType || null,
      employeeCode || null,
      hireDate || null,
      birthDate || null,
      gender || null,
      phone || null,
      avatarUrl || null,
      probationDate || null,
      officialDate || null,
      lang || null,
      region || null,
      timezone || null,
      address || null,
      contractType || null,
      visaNumber || null,
      visaExpiry || null,
      insuranceNumber || null,
      employmentStatus || null,
      contractEnd || null,
      baseSalary || null,
      shiftId || null,
      joinDate || null,
      lastLogin || null,
      allowanceTransport !== undefined && allowanceTransport !== null && allowanceTransport !== '' ? allowanceTransport : null,
      dependentsCount !== undefined && dependentsCount !== null && dependentsCount !== '' ? dependentsCount : null,
      taxCategory || null,
      qualificationAllowance !== undefined && qualificationAllowance !== null && qualificationAllowance !== '' ? qualificationAllowance : null,
      commuteMethod || null,
      commuteDistanceKm !== undefined && commuteDistanceKm !== null && commuteDistanceKm !== '' ? commuteDistanceKm : null,
      ...whereParams
    ]);
  },
  async deleteUser(id, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const sql = `DELETE FROM users WHERE id = ? AND tenant_id = ?`;
      await db.query(sql, [id, tid]);
    } else {
      const sql = `DELETE FROM users WHERE id = ?`;
      await db.query(sql, [id]);
    }
  },
  async setRole(id, role, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?`, [role, id, tid]);
    } else {
      await db.query(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
    }
  },
  async setDepartment(id, departmentId, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`UPDATE users SET departmentId = ? WHERE id = ? AND tenant_id = ?`, [departmentId, id, tid]);
    } else {
      await db.query(`UPDATE users SET departmentId = ? WHERE id = ?`, [departmentId, id]);
    }
  },
  async setPassword(id, hashedPassword, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`UPDATE users SET password = ? WHERE id = ? AND tenant_id = ?`, [hashedPassword, id, tid]);
    } else {
      await db.query(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, id]);
    }
  },
  async incrementTokenVersion(id, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ? AND tenant_id = ?`, [id, tid]);
    } else {
      await db.query(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`, [id]);
    }
  },
  async getAllDepartments(tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [rows] = await db.query(`SELECT * FROM departments WHERE tenant_id = ? ORDER BY name ASC`, [tid]);
      return rows;
    }
    const [rows] = await db.query(`SELECT * FROM departments ORDER BY name ASC`);
    return rows;
  },

  async getDepartmentById(id, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [rows] = await db.query(`SELECT * FROM departments WHERE id = ? AND tenant_id = ? LIMIT 1`, [id, tid]);
      return rows[0];
    }
    const [rows] = await db.query(`SELECT * FROM departments WHERE id = ? LIMIT 1`, [id]);
    return rows[0];
  },

  async createDepartment(name, tenantId = null) {
    const tid = _tid(tenantId);
    const sql = `INSERT INTO departments (name, tenant_id) VALUES (?, ?)`;
    const [result] = await db.query(sql, [name, tid]);
    return result.insertId;
  },

  async updateDepartment(id, name, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`UPDATE departments SET name = ? WHERE id = ? AND tenant_id = ?`, [name, id, tid]);
    } else {
      await db.query(`UPDATE departments SET name = ? WHERE id = ?`, [name, id]);
    }
  },

  async deleteDepartment(id, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      await db.query(`DELETE FROM departments WHERE id = ? AND tenant_id = ?`, [id, tid]);
    } else {
      await db.query(`DELETE FROM departments WHERE id = ?`, [id]);
    }
  },

  async touchLastActive(id, at = null, tenantId = null) {
    try { await db.query(`ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL`); } catch (e) { /* silently ignored */ }
    const tid = _tid(tenantId);
    if (tid != null) {
      const sql = `UPDATE users SET last_active_at = COALESCE(?, NOW()) WHERE id = ? AND tenant_id = ?`;
      await db.query(sql, [at ? String(at).slice(0, 19).replace('T', ' ') : null, id, tid]);
    } else {
      const sql = `UPDATE users SET last_active_at = COALESCE(?, NOW()) WHERE id = ?`;
      await db.query(sql, [at ? String(at).slice(0, 19).replace('T', ' ') : null, id]);
    }
  }
};
