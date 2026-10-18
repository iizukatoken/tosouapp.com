const db = require('../../core/database/mysql');

const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

module.exports = {
  async create({ userId, attendanceId, requestedCheckIn, requestedCheckOut, reason, tenantId }) {
    const tid = _tid(tenantId);
    const sql = `
      INSERT INTO time_adjust_requests (userId, attendanceId, requestedCheckIn, requestedCheckOut, reason, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [res] = await db.query(sql, [userId, attendanceId || null, requestedCheckIn || null, requestedCheckOut || null, reason || null, tid]);
    return res.insertId;
  },
  async listMine(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['r.userId = ?'];
    const params = [userId];
    if (tid != null) { where.push('r.tenant_id = ?'); params.push(tid); }
    // JOIN với bản ghi chấm công gốc để lấy giờ "変更前" (originalCheckIn/Out)
    // JOIN theo attendanceId để lấy giờ gốc (変更前). Không ràng buộc tenant ở đây vì
    // dữ liệu chấm công cũ có thể có tenant_id = NULL; việc cô lập đã đảm bảo qua r.userId
    // (mỗi bản ghi thuộc đúng 1 người dùng của 1 tenant).
    const sql = `
      SELECT r.*, a.checkIn AS originalCheckIn, a.checkOut AS originalCheckOut
      FROM time_adjust_requests r
      LEFT JOIN attendance a ON a.id = r.attendanceId
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async listByUser(userId, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['userId = ?'];
    const params = [userId];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      SELECT * FROM time_adjust_requests
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async updateStatus(id, status, adminNote = null, tenantId = null, processedBy = null) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const whereParams = [id];
    if (tid != null) { where.unshift('tenant_id = ?'); whereParams.unshift(tid); }
    const setParams = [status, status, adminNote || null, processedBy || null, processedBy ? new Date() : null];
    const sql = `
      UPDATE time_adjust_requests
      SET status = ?, admin_note = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END, processed_by = ?, processed_at = ?
      WHERE ${where.join(' AND ')}
    `;
    await db.query(sql, [...setParams, ...whereParams]);
  },
  // 承認を1回だけ確定させる (同じ申請の二重承認・同時承認を防ぐ)。
  // 既に approved の行は更新されず 0 を返す。
  async claimApproval(id, tenantId = null, processedBy = null) {
    const tid = _tid(tenantId);
    const where = ['id = ?', "status <> 'approved'"];
    const whereParams = [id];
    if (tid != null) { where.push('tenant_id = ?'); whereParams.push(tid); }
    const sql = `
      UPDATE time_adjust_requests
      SET status = 'approved', admin_note = NULL, processed_by = ?, processed_at = ?
      WHERE ${where.join(' AND ')}
    `;
    const [res] = await db.query(sql, [processedBy || null, processedBy ? new Date() : null, ...whereParams]);
    return Number(res?.affectedRows || 0);
  },
  // 勤怠への反映に失敗したとき、承認前の状態 (status / admin_note / processed_*) に戻す。
  async restoreStatus(id, prev, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const whereParams = [id];
    if (tid != null) { where.push('tenant_id = ?'); whereParams.push(tid); }
    const sql = `
      UPDATE time_adjust_requests
      SET status = ?, admin_note = ?, processed_by = ?, processed_at = ?
      WHERE ${where.join(' AND ')}
    `;
    await db.query(sql, [
      prev.status || 'pending',
      prev.admin_note ?? null,
      prev.processed_by ?? null,
      prev.processed_at ?? null,
      ...whereParams
    ]);
  },
  async getById(id, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [id];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `SELECT * FROM time_adjust_requests WHERE ${where.join(' AND ')}`;
    const [rows] = await db.query(sql, params);
    return rows[0];
  },
  async deleteById(id, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [id];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `DELETE FROM time_adjust_requests WHERE ${where.join(' AND ')}`;
    const [res] = await db.query(sql, params);
    return Number(res?.affectedRows || 0);
  },
  async updateFields(id, { requestedCheckIn, requestedCheckOut, reason, tenantId }) {
    const tid = _tid(tenantId);
    const fields = [];
    const params = [];
    fields.push('requestedCheckIn = ?'); params.push(requestedCheckIn || null);
    fields.push('requestedCheckOut = ?'); params.push(requestedCheckOut || null);
    fields.push('reason = ?'); params.push(reason || null);
    params.push(id);
    const where = ['id = ?'];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      UPDATE time_adjust_requests
      SET ${fields.join(', ')}
      WHERE ${where.join(' AND ')}
    `;
    const [res] = await db.query(sql, params);
    return Number(res?.affectedRows || 0);
  },
  async addMessage({ requestId, userId, message, tenantId }) {
    const tid = _tid(tenantId);
    if (tid != null) {
      const [check] = await db.query(
        `SELECT id FROM time_adjust_requests WHERE id = ? AND tenant_id = ?`,
        [requestId, tid]
      );
      if (!check || !check.length) return 0;
    }
    const [res] = await db.query(
      `INSERT INTO time_adjust_messages (adjust_request_id, sender_user_id, message) VALUES (?, ?, ?)`,
      [requestId, userId, String(message)]
    );
    return res.insertId || 0;
  },
  async listMessages(requestId, tenantId = null) {
    const tid = _tid(tenantId);
    const where = ['tm.adjust_request_id = ?'];
    const params = [requestId];
    if (tid != null) {
      where.push('r.tenant_id = ?');
      params.push(tid);
    }
    const [rows] = await db.query(
      `SELECT tm.id, tm.adjust_request_id, tm.sender_user_id, tm.message, tm.created_at,
              (SELECT COALESCE(u.username, u.email) FROM users u WHERE u.id = tm.sender_user_id) AS sender_name
       FROM time_adjust_messages tm
       INNER JOIN time_adjust_requests r ON r.id = tm.adjust_request_id
       WHERE ${where.join(' AND ')}
       ORDER BY tm.created_at ASC, tm.id ASC`,
      params
    );
    return rows || [];
  }
};

module.exports.listAll = async function(tenantId = null) {
  const tid = _tid(tenantId);
  const where = [];
  const params = [];
  if (tid != null) {
    where.push('r.tenant_id = ?');
    params.push(tid);
  }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT r.*, u.username, u.email
    FROM time_adjust_requests r
    LEFT JOIN users u ON r.userId = u.id
    ${wsql}
    ORDER BY r.created_at DESC
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports.listForManager = async function(tenantId = null) {
  const tid = _tid(tenantId);
  const where = ['u.role = \'employee\''];
  const params = [];
  if (tid != null) {
    where.push('r.tenant_id = ?');
    params.push(tid);
  }
  const sql = `
    SELECT r.*, u.username, u.email
    FROM time_adjust_requests r
    INNER JOIN users u ON r.userId = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports.ensureSchema = async function() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS time_adjust_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      attendanceId BIGINT UNSIGNED NULL,
      requestedCheckIn DATETIME NULL,
      requestedCheckOut DATETIME NULL,
      reason TEXT NULL,
      admin_note TEXT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      processed_by BIGINT UNSIGNED NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_userId (userId),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    await db.query(`ALTER TABLE time_adjust_requests ADD COLUMN admin_note TEXT NULL AFTER reason`);
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (!msg.includes('duplicate column')) throw e;
  }
  try {
    await db.query(`ALTER TABLE time_adjust_requests ADD COLUMN tenant_id BIGINT UNSIGNED NULL`);
  } catch (e) { /* column may exist */ }
  try {
    await db.query(`ALTER TABLE time_adjust_requests ADD INDEX idx_tar_tid (tenant_id)`);
  } catch (e) { /* index may exist */ }
  try {
    await db.query(`ALTER TABLE time_adjust_requests ADD COLUMN processed_by BIGINT UNSIGNED NULL`);
  } catch (e) { /* column may exist */ }
  try {
    await db.query(`ALTER TABLE time_adjust_requests ADD COLUMN processed_at DATETIME NULL`);
  } catch (e) { /* column may exist */ }
  await db.query(`
    CREATE TABLE IF NOT EXISTS time_adjust_messages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      adjust_request_id BIGINT NOT NULL,
      sender_user_id BIGINT UNSIGNED NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_adjust_request_id (adjust_request_id),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

module.exports.deleteAdminRequests = async function() {
  const sql = `
    DELETE r FROM time_adjust_requests r
    INNER JOIN users u ON r.userId = u.id
    WHERE u.role = 'admin'
  `;
  const [result] = await db.query(sql);
  return result.affectedRows;
};
