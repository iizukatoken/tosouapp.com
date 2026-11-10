const db = require('../../core/database/mysql');

const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      startDate DATE NOT NULL,
      endDate DATE NOT NULL,
      type VARCHAR(32) NOT NULL,
      reason VARCHAR(255) NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      processed_by BIGINT UNSIGNED NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (userId),
      INDEX idx_status (status),
      INDEX idx_type (type),
      INDEX idx_period (startDate, endDate),
      CONSTRAINT fk_leave_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS dtype, COLUMN_TYPE AS ctype
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'leave_requests'
    `);
    const colMap = new Map((cols || []).map(c => [String(c.name), c]));
    if (!colMap.has('processed_by')) {
      try { await db.query(`ALTER TABLE leave_requests ADD COLUMN processed_by BIGINT UNSIGNED NULL`); } catch (e) { /* silently ignored */ }
    }
    if (!colMap.has('processed_at')) {
      try { await db.query(`ALTER TABLE leave_requests ADD COLUMN processed_at DATETIME NULL`); } catch (e) { /* silently ignored */ }
    }
    const typeCol = colMap.get('type');
    if (typeCol && String(typeCol.dtype || '').toLowerCase() !== 'varchar') {
      try {
        await db.query(`ALTER TABLE leave_requests MODIFY COLUMN type VARCHAR(32) NOT NULL`);
      } catch (e) { /* silently ignored */ }
    }

    const [idx] = await db.query(`
      SELECT index_name
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'leave_requests'
    `);
    const idxSet = new Set((idx || []).map(i => String(i.index_name)));
    if (!idxSet.has('idx_user_status')) {
      try { await db.query(`ALTER TABLE leave_requests ADD INDEX idx_user_status (userId, status)`); } catch (e) { /* silently ignored */ }
    }
    if (!idxSet.has('idx_status_period')) {
      try { await db.query(`ALTER TABLE leave_requests ADD INDEX idx_status_period (status, startDate, endDate)`); } catch (e) { /* silently ignored */ }
    }
    if (!idxSet.has('idx_leave_user_type_status_period')) {
      try { await db.query(`ALTER TABLE leave_requests ADD INDEX idx_leave_user_type_status_period (userId, type, status, startDate, endDate)`); } catch (e) { /* silently ignored */ }
    }
    if (!idxSet.has('idx_leave_status_created')) {
      try { await db.query(`ALTER TABLE leave_requests ADD INDEX idx_leave_status_created (status, created_at, id)`); } catch (e) { /* silently ignored */ }
    }
  } catch (e) { /* silently ignored */ }
  try {
    const [tbls] = await db.query(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN ('paid_leave_grants','leave_grants')
    `);
    const set = new Set((tbls || []).map(t => String(t.name)));
    const grantsTable = set.has('paid_leave_grants') ? 'paid_leave_grants' : 'leave_grants';
    if (!set.has('paid_leave_grants') && !set.has('leave_grants')) {
      await db.query(`
        CREATE TABLE paid_leave_grants (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          userId BIGINT UNSIGNED NOT NULL,
          type VARCHAR(32) NOT NULL DEFAULT 'paid',
          grantDate DATE NOT NULL,
          daysGranted INT NOT NULL,
          expiryDate DATE NOT NULL,
          daysUsed INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_grant (userId, type, grantDate),
          INDEX idx_user_expiry (userId, expiryDate),
          CONSTRAINT fk_leave_grant_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } else {
      const [cols] = await db.query(`
        SELECT COLUMN_NAME AS name, COLUMN_TYPE AS ctype
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
      `, [grantsTable]);
      const colSet = new Set((cols || []).map(c => String(c.name)));
      if (!colSet.has('userId')) {
        await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN userId BIGINT UNSIGNED NOT NULL`);
      } else {
        const userCol = (cols || []).find(c => String(c.name) === 'userId');
        if (userCol && !/bigint\(\d+\)\s+unsigned/i.test(String(userCol.ctype))) {
          try {
            const [fks] = await db.query(`
              SELECT CONSTRAINT_NAME 
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'userId' AND REFERENCED_TABLE_NAME IS NOT NULL
            `, [grantsTable]);
            for (const fk of (fks || [])) {
              try { await db.query(`ALTER TABLE ${grantsTable} DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}`); } catch (e) { /* silently ignored */ }
            }
          } catch (e) { /* silently ignored */ }
          await db.query(`ALTER TABLE ${grantsTable} MODIFY COLUMN userId BIGINT UNSIGNED NOT NULL`);
        }
      }
      if (!colSet.has('type')) await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN type VARCHAR(32) NOT NULL DEFAULT 'paid'`);
      if (!colSet.has('grantDate')) await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN grantDate DATE NOT NULL`);
      if (!colSet.has('daysGranted')) await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN daysGranted INT NOT NULL`);
      if (!colSet.has('expiryDate')) await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN expiryDate DATE NOT NULL`);
      if (!colSet.has('daysUsed')) await db.query(`ALTER TABLE ${grantsTable} ADD COLUMN daysUsed INT NOT NULL DEFAULT 0`);
      const [idx] = await db.query(`
        SELECT index_name 
        FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ?
      `, [grantsTable]);
      const idxSet = new Set((idx || []).map(i => String(i.index_name)));
      if (!idxSet.has('uniq_user_grant')) {
        try { await db.query(`ALTER TABLE ${grantsTable} ADD UNIQUE KEY uniq_user_grant (userId, type, grantDate)`); } catch (e) { /* silently ignored */ }
      }
      if (!idxSet.has('idx_user_expiry')) {
        try { await db.query(`ALTER TABLE ${grantsTable} ADD INDEX idx_user_expiry (userId, expiryDate)`); } catch (e) { /* silently ignored */ }
      }
      const [fk] = await db.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'userId' AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [grantsTable]);
      if (!fk || !fk.length) {
        try { await db.query(`ALTER TABLE ${grantsTable} ADD CONSTRAINT fk_leave_grant_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`); } catch (e) { /* silently ignored */ }
      }
    }
  } catch (e) { /* silently ignored */ }
}

async function resolveGrantsTable() {
  const [[row]] = await db.query(`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('paid_leave_grants','leave_grants')
    ORDER BY CASE table_name WHEN 'paid_leave_grants' THEN 0 ELSE 1 END
    LIMIT 1
  `);
  return row ? String(row.name) : 'paid_leave_grants';
}

module.exports = {
  ensureSchema,
  async create({ userId, startDate, endDate, type, reason, tenantId = null }) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const sql = `
        INSERT INTO leave_requests (userId, startDate, endDate, type, reason, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const [res] = await db.query(sql, [userId, startDate, endDate, type, reason || null, tid]);
      return res.insertId;
    }
    const sql = `
      INSERT INTO leave_requests (userId, startDate, endDate, type, reason)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [res] = await db.query(sql, [userId, startDate, endDate, type, reason || null]);
    return res.insertId;
  },
  async listMine(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId];
    let where = 'WHERE userId = ?';
    if (tid != null) { where += ' AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT * FROM leave_requests
      ${where}
      ORDER BY created_at DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async findExactRequest({ userId, startDate, endDate, type = 'paid', statuses = ['pending', 'approved'], tenantId = null }) {
    const tid = _tid(tenantId);
    const list = Array.isArray(statuses) && statuses.length
      ? statuses.filter(s => ['pending', 'approved', 'rejected'].includes(String(s || '').toLowerCase()))
      : ['pending', 'approved'];
    const marks = list.map(() => '?').join(',');
    const params = [userId, startDate, endDate, type, ...list];
    let tenantFilter = '';
    if (tid != null) { tenantFilter = 'AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT id, userId, startDate, endDate, type, status
      FROM leave_requests
      WHERE userId = ?
        AND startDate = ?
        AND endDate = ?
        AND type = ?
        AND status IN (${marks})
        ${tenantFilter}
      ORDER BY id DESC
      LIMIT 1
    `;
    const [rows] = await db.query(sql, params);
    return rows && rows[0] ? rows[0] : null;
  },
  async listByUser(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId];
    let where = 'WHERE userId = ?';
    if (tid != null) { where += ' AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT * FROM leave_requests
      ${where}
      ORDER BY created_at DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async getById(id, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [id];
    let where = 'WHERE id = ?';
    if (tid != null) { where += ' AND tenant_id = ?'; params.push(tid); }
    const [rows] = await db.query(`SELECT * FROM leave_requests ${where} LIMIT 1`, params);
    return rows && rows[0] ? rows[0] : null;
  },
  async listApprovedByUserOverlap(userId, fromDate, toDate, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId, fromDate, toDate];
    let tenantFilter = '';
    if (tid != null) { tenantFilter = 'AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT *
      FROM leave_requests
      WHERE userId = ?
        AND status = 'approved'
        AND endDate >= ?
        AND startDate <= ?
        ${tenantFilter}
      ORDER BY startDate DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async listAllPending(tenantId = null, branchId = null) {
    const hasTid = tenantId != null && Number.isFinite(Number(tenantId));
    const hasBid = branchId != null && Number.isFinite(Number(branchId));
    const params = [];
    const where = ['lr.status = \'pending\''];
    if (hasTid) { where.push('u.tenant_id = ?'); params.push(parseInt(String(tenantId), 10)); }
    if (hasBid) { where.push('u.branch_id = ?'); params.push(parseInt(String(branchId), 10)); }
    const sql = `
      SELECT
        lr.*,
        u.username,
        u.employee_code,
        COALESCE(t.id, 0) AS tenant_id,
        COALESCE(t.name, '未設定') AS tenant_name,
        COALESCE(b.id, 0) AS branch_id,
        COALESCE(b.name, '') AS branch_name
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.userId
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ${where.join('\n      AND ')}
      ORDER BY COALESCE(t.id, 0) ASC, COALESCE(b.id, 0) ASC, lr.created_at DESC, lr.id DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async listAllRequests({ status = null, limit = 1000, tenantId = null } = {}) {
    const lim = Math.max(1, Math.min(5000, Number(limit || 1000)));
    const hasStatus = ['pending', 'approved', 'rejected'].includes(String(status || '').toLowerCase());
    const hasTid = tenantId != null && Number.isFinite(Number(tenantId));
    const params = [];
    const conditions = [];
    if (hasStatus) {
      conditions.push('lr.status = ?');
      params.push(String(status).toLowerCase());
    }
    conditions.push(`
      NOT (
        lr.type = 'paid'
        AND lr.status = 'approved'
        AND lr.startDate = lr.endDate
        AND (
          COALESCE(aw.hasWork, 0) = 1
          OR (
            ad.userId IS NOT NULL
            AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') <> '有給休暇'
          )
        )
      )
    `);
    conditions.push(`
      NOT (
        lr.type = 'paid'
        AND lr.status = 'rejected'
        AND (
          COALESCE(lr.reason, '') LIKE '%[AUTO_CANCEL]%'
          OR COALESCE(lr.reason, '') LIKE '%[AUTO_RECONCILE]%'
        )
      )
    `);
    conditions.push(`u.role NOT IN ('admin', 'manager')`);
    if (hasTid) {
      conditions.push('u.tenant_id = ?');
      params.push(parseInt(String(tenantId), 10));
    }
    params.push(lim);
    const sql = `
      SELECT
        lr.*,
        u.username,
        u.employee_code,
        COALESCE(t.id, 0) AS tenant_id,
        COALESCE(t.name, '未設定') AS tenant_name,
        COALESCE(b.id, 0) AS branch_id,
        COALESCE(b.name, '') AS branch_name
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.userId
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN attendance_daily ad
        ON ad.userId = lr.userId
       AND ad.date = lr.startDate
      LEFT JOIN (
        SELECT userId, DATE(COALESCE(checkIn, checkOut)) AS d,
               MAX(CASE WHEN checkIn IS NOT NULL OR checkOut IS NOT NULL THEN 1 ELSE 0 END) AS hasWork
        FROM attendance
        GROUP BY userId, DATE(COALESCE(checkIn, checkOut))
      ) aw
        ON aw.userId = lr.userId
       AND aw.d = lr.startDate
      WHERE ${conditions.join('\n      AND ')}
      ORDER BY COALESCE(t.id, 0) ASC, COALESCE(b.id, 0) ASC, lr.created_at DESC, lr.id DESC
      LIMIT ?
    `;
    try {
      const [rows] = await db.query(sql, params);
      return rows;
    } catch {
      const whereParts = [];
      const fbParams = [];
      if (hasStatus) { whereParts.push('lr.status = ?'); fbParams.push(String(status).toLowerCase()); }
      whereParts.push(`u.role NOT IN ('admin', 'manager')`);
      if (hasTid) { whereParts.push('u.tenant_id = ?'); fbParams.push(parseInt(String(tenantId), 10)); }
      fbParams.push(lim);
      const fallbackSql = `
        SELECT
          lr.*,
          u.username,
          u.employee_code,
          COALESCE(t.id, 0) AS tenant_id,
          COALESCE(t.name, '未設定') AS tenant_name,
          COALESCE(b.id, 0) AS branch_id,
          COALESCE(b.name, '') AS branch_name
        FROM leave_requests lr
        LEFT JOIN users u ON u.id = lr.userId
        LEFT JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN branches b ON b.id = u.branch_id
        ${whereParts.length ? 'WHERE ' + whereParts.join('\n        AND ') : ''}
        ORDER BY COALESCE(t.id, 0) ASC, COALESCE(b.id, 0) ASC, lr.created_at DESC, lr.id DESC
        LIMIT ?
      `;
      const [rows] = await db.query(fallbackSql, fbParams);
      return rows;
    }
  },
  async listAllRequestsSimple({ status = null, limit = 1000, tenantId = null, branchId = null } = {}) {
    const lim = Math.max(1, Math.min(5000, Number(limit || 1000)));
    const hasStatus = ['pending', 'approved', 'rejected'].includes(String(status || '').toLowerCase());
    const hasTid = tenantId != null && Number.isFinite(Number(tenantId));
    const hasBid = branchId != null && Number.isFinite(Number(branchId));
    const whereParts = [`u.role NOT IN ('admin', 'manager')`];
    const params = [];
    if (hasStatus) { whereParts.push('lr.status = ?'); params.push(String(status).toLowerCase()); }
    if (hasTid) { whereParts.push('u.tenant_id = ?'); params.push(parseInt(String(tenantId), 10)); }
    if (hasBid) { whereParts.push('u.branch_id = ?'); params.push(parseInt(String(branchId), 10)); }
    params.push(lim);
    const sql = `
      SELECT
        lr.*,
        u.username,
        u.employee_code,
        COALESCE(t.id, 0) AS tenant_id,
        COALESCE(t.name, '未設定') AS tenant_name,
        COALESCE(b.id, 0) AS branch_id,
        COALESCE(b.name, '') AS branch_name
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.userId
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ${whereParts.join('\n      AND ')}
      ORDER BY COALESCE(t.id, 0) ASC, COALESCE(b.id, 0) ASC, lr.created_at DESC, lr.id DESC
      LIMIT ?
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async getById(id, tenantId = null) {
    const hasTid = tenantId != null && Number.isFinite(Number(tenantId));
    const params = [id];
    const where = ['lr.id = ?'];
    if (hasTid) { where.push('u.tenant_id = ?'); params.push(parseInt(String(tenantId), 10)); }
    const [rows] = await db.query(`
      SELECT lr.*
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.userId
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `, params);
    return rows && rows[0] ? rows[0] : null;
  },
  async listByUser(userId, tenantId = null) {
    const hasTid = tenantId != null && Number.isFinite(Number(tenantId));
    const params = [userId];
    const where = ['lr.userId = ?'];
    if (hasTid) { where.push('u.tenant_id = ?'); params.push(parseInt(String(tenantId), 10)); }
    const sql = `
      SELECT lr.*
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.userId
      WHERE ${where.join(' AND ')}
      ORDER BY lr.created_at DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async updateStatus(id, status, tenantId = null, processedBy = null) {
    if (tenantId != null && Number.isFinite(Number(tenantId))) {
      const tid = parseInt(String(tenantId), 10);
      // 注意: JOIN を含む UPDATE では LIMIT を使用できない（MySQL: Incorrect usage of UPDATE and LIMIT）。
      // WHERE lr.id = ? が主キー条件で1行に限定されるため LIMIT は不要。
      const sql = `
        UPDATE leave_requests lr
        INNER JOIN users u ON u.id = lr.userId
        SET lr.status = ?, lr.processed_by = ?, lr.processed_at = ?
        WHERE lr.id = ? AND u.tenant_id = ?
      `;
      await db.query(sql, [status, processedBy || null, processedBy ? new Date() : null, id, tid]);
      return;
    }
    const sql = `
      UPDATE leave_requests
      SET status = ?, processed_by = ?, processed_at = ?
      WHERE id = ?
    `;
    await db.query(sql, [status, processedBy || null, processedBy ? new Date() : null, id]);
  },
  /**
   * シフト承認 = 有給承認: ngày 有給 trong ca của tháng → đơn 有給 (reason 'from_shift').
   * shiftStatus APPROVED: tạo/duyệt đơn cho từng ngày; ngày đã bỏ khỏi ca → 却下 đơn from_shift cũ.
   * REJECTED: 却下 các đơn from_shift của tháng. PENDING/draft: đưa đơn from_shift về pending.
   * Không đụng attendance_daily (quy tắc cứng của シフト承認).
   */
  async syncShiftPaidLeaves({ userId, month, paidDays = [], shiftStatus, approverId = null, tenantId = null }) {
    const tid = _tid(tenantId);
    const REASON = 'from_shift';
    // paidDays: [{ date, type: 'paid' | 'paid_half' }] — 有給休暇 と 半休(有給)
    const days = [];
    const seen = new Set();
    for (const p of paidDays || []) {
      const date = String(p?.date || '').slice(0, 10);
      const type = p?.type === 'paid_half' ? 'paid_half' : 'paid';
      if (!date.startsWith(`${month}-`) || seen.has(`${date}|${type}`)) continue;
      seen.add(`${date}|${type}`);
      days.push({ date, type });
    }
    const tenantFilter = tid != null ? ' AND tenant_id = ?' : '';
    const tenantParams = tid != null ? [tid] : [];
    const result = { approved: 0, rejected: 0, reopened: 0 };

    if (shiftStatus === 'APPROVED') {
      for (const { date, type } of days) {
        const existing = await this.findExactRequest({ userId, startDate: date, endDate: date, type, statuses: ['pending', 'approved'], tenantId: tid });
        if (existing && existing.status === 'approved') continue;
        const id = existing ? existing.id : await this.create({ userId, startDate: date, endDate: date, type, reason: REASON, tenantId: tid });
        await this.updateStatus(id, 'approved', tid, approverId);
        result.approved++;
      }
      const keys = days.map(d => `${d.date}|${d.type}`);
      const notIn = keys.length ? ` AND CONCAT(DATE_FORMAT(startDate, '%Y-%m-%d'), '|', type) NOT IN (${keys.map(() => '?').join(',')})` : '';
      const [r] = await db.query(
        `UPDATE leave_requests SET status = 'rejected', processed_by = ?, processed_at = ?,
           reason = CONCAT(COALESCE(reason, ''), ' / [SHIFT_CHANGED]')
         WHERE userId = ? AND type IN ('paid', 'paid_half') AND reason LIKE '%from_shift%' AND status IN ('pending', 'approved')
           AND startDate LIKE ?${notIn}${tenantFilter}`,
        [approverId, approverId ? new Date() : null, userId, `${month}-%`, ...keys, ...tenantParams]
      );
      result.rejected = Number(r?.affectedRows || 0);
      return result;
    }
    if (shiftStatus === 'REJECTED') {
      const [r] = await db.query(
        `UPDATE leave_requests SET status = 'rejected', processed_by = ?, processed_at = ?
         WHERE userId = ? AND type IN ('paid', 'paid_half') AND reason LIKE '%from_shift%' AND status IN ('pending', 'approved')
           AND startDate LIKE ?${tenantFilter}`,
        [approverId, approverId ? new Date() : null, userId, `${month}-%`, ...tenantParams]
      );
      result.rejected = Number(r?.affectedRows || 0);
      return result;
    }
    const [r] = await db.query(
      `UPDATE leave_requests SET status = 'pending', processed_by = NULL, processed_at = NULL
       WHERE userId = ? AND type IN ('paid', 'paid_half') AND reason LIKE '%from_shift%' AND status = 'approved'
         AND startDate LIKE ?${tenantFilter}`,
      [userId, `${month}-%`, ...tenantParams]
    );
    result.reopened = Number(r?.affectedRows || 0);
    return result;
  },
  // Đơn tạo khi nhân viên chọn 区分 nghỉ (欠勤/無給/半休/半休(有給)/代替休日) trên bảng tháng.
  async ensureKubunRequest({ userId, date, type, tenantId = null }) {
    const existing = await this.findExactRequest({ userId, startDate: date, endDate: date, type, statuses: ['pending', 'approved'], tenantId });
    if (existing) return { id: existing.id, created: false };
    const id = await this.create({ userId, startDate: date, endDate: date, type, reason: 'from_kubun', tenantId });
    return { id, created: true };
  },
  // Nhân viên đổi 区分 của ngày → huỷ các đơn 区分 cũ (chỉ đơn sinh từ 区分, không đụng đơn nhân viên tự viết).
  async cancelKubunRequestsByDate(userId, date, tenantId = null, exceptType = null) {
    const tid = _tid(tenantId);
    const params = [userId, date, date];
    let extra = '';
    if (exceptType) { extra += ' AND type <> ?'; params.push(exceptType); }
    if (tid != null) { extra += ' AND tenant_id = ?'; params.push(tid); }
    const [res] = await db.query(`
      UPDATE leave_requests
      SET status = 'rejected', reason = CONCAT(COALESCE(reason, ''), ' / [AUTO_CANCEL] kubun changed')
      WHERE userId = ? AND reason LIKE '%from_kubun%' AND status IN ('pending', 'approved')
        AND startDate <= ? AND endDate >= ?${extra}
    `, params);
    return Number(res?.affectedRows || 0);
  },
  async cancelOwnPaidByDate(userId, date, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId, date, date];
    let tenantFilter = '';
    if (tid != null) { tenantFilter = 'AND tenant_id = ?'; params.push(tid); }
    const sql = `
      UPDATE leave_requests
      SET
        status = 'rejected',
        reason = CASE
          WHEN COALESCE(reason, '') = '' THEN '[AUTO_CANCEL] kubun changed from 有給休暇'
          ELSE CONCAT(reason, ' / [AUTO_CANCEL] kubun changed from 有給休暇')
        END
      WHERE userId = ?
        AND type = 'paid'
        AND status IN ('pending', 'approved')
        AND startDate <= ?
        AND endDate >= ?
        ${tenantFilter}
    `;
    const [res] = await db.query(sql, params);
    return Number(res?.affectedRows || 0);
  },
  // Trả về danh sách các đơn bị tự động từ chối (không chỉ số lượng), để controller
  // có thể thông báo cho từng nhân viên bị ảnh hưởng.
  async reconcileApprovedPaidWithAttendance(tenantId = null) {
    const tid = _tid(tenantId);
    // Safety scope: reconcile only one-day paid requests to avoid changing multi-day requests unexpectedly.
    try {
      const params = [];
      let tenantFilter = '';
      if (tid != null) { tenantFilter = 'AND lr.tenant_id = ?'; params.push(tid); }
      const selectSql = `
        SELECT lr.id, lr.userId, lr.startDate, lr.endDate
        FROM leave_requests lr
        LEFT JOIN attendance_daily ad
          ON ad.userId = lr.userId
         AND ad.date = lr.startDate
        LEFT JOIN attendance a
          ON a.userId = lr.userId
         AND DATE(COALESCE(a.checkIn, a.checkOut)) = lr.startDate
        WHERE lr.type = 'paid'
          AND lr.status = 'approved'
          AND lr.startDate = lr.endDate
          AND (
            (ad.userId IS NOT NULL AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') <> '有給休暇'
              -- 有給 từ シフト承認 không ghi 区分 vào bảng tháng: 区分 trống không phải là "đã đổi"
              AND NOT (COALESCE(lr.reason, '') LIKE '%from_shift%' AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') = ''))
            OR (a.id IS NOT NULL AND (a.checkIn IS NOT NULL OR a.checkOut IS NOT NULL))
          )
          ${tenantFilter}
      `;
      const [candidates] = await db.query(selectSql, params);
      if (!candidates || !candidates.length) return [];
      const ids = candidates.map(c => c.id);
      const marks = ids.map(() => '?').join(',');
      await db.query(`
        UPDATE leave_requests
        SET
          status = 'rejected',
          reason = CASE
            WHEN COALESCE(reason, '') = '' THEN '[AUTO_RECONCILE] attendance kubun is not 有給休暇'
            WHEN reason LIKE '%[AUTO_RECONCILE]%' THEN reason
            ELSE CONCAT(reason, ' / [AUTO_RECONCILE] attendance kubun is not 有給休暇')
          END
        WHERE id IN (${marks})
      `, ids);
      return candidates;
    } catch {
      // Fallback for environments where attendance table/join may fail.
      const params2 = [];
      let tenantFilter2 = '';
      if (tid != null) { tenantFilter2 = 'AND lr.tenant_id = ?'; params2.push(tid); }
      const selectSql2 = `
        SELECT lr.id, lr.userId, lr.startDate, lr.endDate
        FROM leave_requests lr
        INNER JOIN attendance_daily ad
          ON ad.userId = lr.userId
         AND ad.date = lr.startDate
        WHERE lr.type = 'paid'
          AND lr.status = 'approved'
          AND lr.startDate = lr.endDate
          AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') <> '有給休暇'
          AND NOT (COALESCE(lr.reason, '') LIKE '%from_shift%' AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') = '')
          ${tenantFilter2}
      `;
      const [candidates2] = await db.query(selectSql2, params2);
      if (!candidates2 || !candidates2.length) return [];
      const ids2 = candidates2.map(c => c.id);
      const marks2 = ids2.map(() => '?').join(',');
      await db.query(`
        UPDATE leave_requests
        SET
          status = 'rejected',
          reason = CASE
            WHEN COALESCE(reason, '') = '' THEN '[AUTO_RECONCILE] attendance kubun is not 有給休暇'
            WHEN reason LIKE '%[AUTO_RECONCILE]%' THEN reason
            ELSE CONCAT(reason, ' / [AUTO_RECONCILE] attendance kubun is not 有給休暇')
          END
        WHERE id IN (${marks2})
      `, ids2);
      return candidates2;
    }
  },
  async upsertGrant({ userId, type = 'paid', grantDate, daysGranted, expiryDate, tenantId = null }) {
    const tid = _tid(tenantId);
    if (tid != null) {
      // Verify userId belongs to tenant before upserting
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return;
    }
    const table = await resolveGrantsTable();
    const sql = `
      INSERT INTO ${table} (userId, type, grantDate, daysGranted, expiryDate)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE daysGranted = VALUES(daysGranted), expiryDate = VALUES(expiryDate)
    `;
    await db.query(sql, [userId, type, grantDate, daysGranted, expiryDate]);
  },
  async deleteGrant({ userId, type = 'paid', grantDate, tenantId = null }) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return 0;
    }
    const table = await resolveGrantsTable();
    const [res] = await db.query(`
      DELETE FROM ${table}
      WHERE userId = ? AND type = ? AND grantDate = ?
    `, [userId, type, grantDate]);
    return Number(res?.affectedRows || 0);
  },
  async listGrants(userId, type = 'paid', tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return [];
    }
    const table = await resolveGrantsTable();
    const [rows] = await db.query(`
      SELECT * FROM ${table}
      WHERE userId = ? AND type = ?
        AND COALESCE(daysGranted, 0) > 0
      ORDER BY grantDate ASC
    `, [userId, type]);
    return rows;
  },
  async listApprovedPaidLeaves(userId, fromDate, toDate, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId, fromDate, toDate];
    let tenantFilter = '';
    if (tid != null) { tenantFilter = 'AND lr.tenant_id = ?'; params.push(tid); }
    try {
      const [rows] = await db.query(`
        SELECT lr.id, lr.userId, lr.startDate, lr.endDate, lr.type, lr.status
        FROM leave_requests lr
        LEFT JOIN attendance_daily ad
          ON ad.userId = lr.userId
         AND ad.date = lr.startDate
        LEFT JOIN (
          SELECT userId, DATE(COALESCE(checkIn, checkOut)) AS d,
                 MAX(CASE WHEN checkIn IS NOT NULL OR checkOut IS NOT NULL THEN 1 ELSE 0 END) AS hasWork
          FROM attendance
          GROUP BY userId, DATE(COALESCE(checkIn, checkOut))
        ) aw
          ON aw.userId = lr.userId
         AND aw.d = lr.startDate
        WHERE lr.userId = ? 
          AND lr.type = 'paid' 
          AND lr.status = 'approved'
          AND lr.endDate >= ? AND lr.startDate <= ?
          AND NOT (
            lr.startDate = lr.endDate
            AND (
              COALESCE(aw.hasWork, 0) = 1
              OR (
                ad.userId IS NOT NULL
                AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') <> '有給休暇'
              )
            )
          )
          ${tenantFilter}
        ORDER BY startDate ASC
      `, params);
      return rows;
    } catch {
      // Hard fallback: preserve page availability when advanced join fails.
      const fbParams = [userId, fromDate, toDate];
      let fbFilter = '';
      if (tid != null) { fbFilter = 'AND tenant_id = ?'; fbParams.push(tid); }
      const [rows] = await db.query(`
        SELECT id, userId, startDate, endDate, type, status
        FROM leave_requests
        WHERE userId = ? 
          AND type = 'paid' 
          AND status = 'approved'
          AND endDate >= ? AND startDate <= ?
          ${fbFilter}
        ORDER BY startDate ASC
      `, fbParams);
      return rows;
    }
  },
  // 有給休暇（全日=1.0）と半休(有給)（半日=0.5）の取得済み日を勤怠実績(attendance_daily)から取得。
  // 半休(有給) は leave_requests に半日情報が無いため、kubun を正とする。
  async listPaidLeaveUsedDays(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId];
    let tenantFilter = '';
    if (tid != null) {
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return [];
      // Da xac minh user thuoc tenant nay. Van chap nhan cac ban ghi cham cong co
      // tenant_id NULL (du lieu cu/thieu tenant khi ghi attendance_daily) cua chinh user do,
      // neu khong ngay 半休(有給)/有給休暇 co tenant_id NULL se bi bo sot khoi 取得済み.
      tenantFilter = 'AND (ad.tenant_id = ? OR ad.tenant_id IS NULL)';
      params.push(tid);
    }
    const [rows] = await db.query(`
      SELECT ad.date AS date,
             REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') AS kubun
      FROM attendance_daily ad
      WHERE ad.userId = ?
        AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') IN ('有給休暇', '半休(有給)')
        ${tenantFilter}
      ORDER BY ad.date ASC
    `, params);
    return (rows || []).map(r => {
      const kubun = String(r.kubun || '');
      const days = kubun === '半休(有給)' ? 0.5 : 1.0;
      return { date: String(r.date).slice(0, 10), kubun, days };
    });
  },
  // 法定付与の出勤率(8割)判定用: 勤怠区分のある日を全件取得（件数は1人あたり年数百件程度）。
  async listAttendanceKubun(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const params = [userId];
    let tenantFilter = '';
    if (tid != null) {
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return [];
      tenantFilter = 'AND (ad.tenant_id = ? OR ad.tenant_id IS NULL)';
      params.push(tid);
    }
    const [rows] = await db.query(`
      SELECT ad.date AS date, ad.kubun AS kubun
      FROM attendance_daily ad
      WHERE ad.userId = ?
        AND COALESCE(ad.kubun, '') <> ''
        ${tenantFilter}
    `, params);
    return (rows || []).map(r => ({ date: String(r.date).slice(0, 10), kubun: r.kubun }));
  },
  // 指定月の 有給休暇/半休(有給) 取得実績を全社員分集計する（attendance_daily を正とし、残数計算と同じ基準）。
  // ad.tenant_id は欠損データがあり得るため、users.tenant_id で絞り込む（listPaidLeaveUsedDaysより堅牢）。
  async getMonthlyPaidLeaveUsageSummary(month, tenantId = null, branchId = null) {
    const tid = _tid(tenantId);
    const bid = branchId != null && Number.isFinite(Number(branchId)) ? parseInt(String(branchId), 10) : null;
    const params = [month];
    const extra = [];
    if (tid != null) { extra.push('u.tenant_id = ?'); params.push(tid); }
    if (bid != null) { extra.push('u.branch_id = ?'); params.push(bid); }
    const sql = `
      SELECT
        REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') AS kubun,
        COUNT(DISTINCT ad.userId) AS userCount,
        COUNT(*) AS occurrenceCount
      FROM attendance_daily ad
      INNER JOIN users u ON u.id = ad.userId
      WHERE DATE_FORMAT(ad.date, '%Y-%m') = ?
        AND REPLACE(TRIM(COALESCE(ad.kubun, '')), '　', '') IN ('有給休暇', '半休(有給)')
        AND u.role NOT IN ('admin', 'manager')
        ${extra.length ? 'AND ' + extra.join(' AND ') : ''}
      GROUP BY kubun
    `;
    const [rows] = await db.query(sql, params);
    const out = { paid: { userCount: 0, days: 0 }, paidHalf: { userCount: 0, days: 0 } };
    for (const r of (rows || [])) {
      const k = String(r.kubun || '');
      const userCount = Number(r.userCount || 0);
      const occurrenceCount = Number(r.occurrenceCount || 0);
      if (k === '有給休暇') out.paid = { userCount, days: occurrenceCount };
      else if (k === '半休(有給)') out.paidHalf = { userCount, days: occurrenceCount * 0.5 };
    }
    return out;
  },
  async getAttendanceStats(userId, fromDate, toDate, tenantId = null) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [check] = await db.query(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [userId, tid]);
      if (!check || !check.length) return { workDays: 0, presentDays: 0 };
    }
    // Workdays: rows that are not explicit holidays.
    // Present days: workdays excluding explicit absence types.
    const [rows] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(kubun, '') NOT IN ('', '休日', '代替休日') THEN 1 ELSE 0 END), 0) AS workDays,
        COALESCE(SUM(CASE WHEN COALESCE(kubun, '') NOT IN ('', '休日', '代替休日', '欠勤', '無給休暇') THEN 1 ELSE 0 END), 0) AS presentDays
      FROM attendance_daily
      WHERE userId = ?
        AND date >= ?
        AND date <= ?
    `, [userId, fromDate, toDate]);
    const r = (rows && rows[0]) || {};
    return {
      workDays: Number(r.workDays || 0),
      presentDays: Number(r.presentDays || 0)
    };
  }
};
