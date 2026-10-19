const db = require('../../core/database/mysql');
// Ghi audit log thất bại → báo quản trị (nơi gọi thường nuốt lỗi), rồi ném lại như cũ.
const _reportAndRethrow = (context) => (e) => {
  if (!(Number(e?.status) >= 400 && Number(e?.status) < 500)) {
    try { require('../../core/errorReporter').reportSwallowed(context, e); } catch (e2) { /* ignore */ }
  }
  throw e;
};

function _tid(tenantId) {
  return tenantId != null ? parseInt(String(tenantId), 10) : null;
}

module.exports = {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NULL,
        tenant_id BIGINT UNSIGNED NULL,
        action VARCHAR(64) NOT NULL,
        path VARCHAR(255),
        method VARCHAR(16),
        ip VARCHAR(64),
        userAgent VARCHAR(255),
        beforeData TEXT,
        afterData TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (userId),
        INDEX idx_action (action),
        INDEX idx_created (created_at),
        INDEX idx_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Ensure tenant_id column exists on older tables
    try {
      const [cols] = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'audit_logs'
      `);
      const set = new Set((cols || []).map(c => String(c.column_name)));
      if (!set.has('tenant_id')) {
        await db.query(`ALTER TABLE audit_logs ADD COLUMN tenant_id BIGINT UNSIGNED NULL AFTER userId`);
        try { await db.query(`ALTER TABLE audit_logs ADD INDEX idx_tenant (tenant_id)`); } catch (e) { /* silently ignored */ }
      }
    } catch (e) { /* silently ignored */ }
  },
  async writeLog(data) {
    return module.exports._writeLog(data).catch(_reportAndRethrow('audit.writeLog'));
  },
  async _writeLog(data) {
    const tid = _tid(data.tenantId);
    const sql = `
      INSERT INTO audit_logs (userId, tenant_id, action, path, method, ip, userAgent, beforeData, afterData)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.query(sql, [
      data.userId,
      tid,
      data.action,
      data.path,
      data.method,
      data.ip,
      data.userAgent,
      data.beforeData,
      data.afterData
    ]);
  },
  async listLogs({ userId, action, actionPrefix, actionPrefixes, from, to, page = 1, pageSize = 50, tenantId = null }) {
    const tid = _tid(tenantId);
    const where = [];
    const params = [];
    if (userId) { where.push('a.userId = ?'); params.push(userId); }
    if (action) { where.push('a.action = ?'); params.push(action); }
    if (actionPrefix) { where.push('a.action LIKE ?'); params.push(`${actionPrefix}%`); }
    const prefixList = Array.isArray(actionPrefixes) ? actionPrefixes.filter(Boolean) : [];
    if (prefixList.length) {
      where.push(`(${prefixList.map(() => 'a.action LIKE ?').join(' OR ')})`);
      for (const p of prefixList) params.push(`${p}%`);
    }
    if (from) { where.push('a.created_at >= ?'); params.push(from + ' 00:00:00'); }
    if (to) { where.push('a.created_at <= ?'); params.push(to + ' 23:59:59'); }
    if (tid != null) { where.push('u.tenant_id = ?'); params.push(tid); }
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.max(1, parseInt(pageSize, 10) || 50);
    const offset = (p - 1) * ps;
    const joinSql = tid != null ? `INNER JOIN users u ON u.id = a.userId` : '';
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = `
      SELECT a.id, a.userId, a.action, a.path, a.method, a.ip, a.userAgent, a.beforeData, a.afterData, a.created_at
      FROM audit_logs a
      ${joinSql}
      ${wsql}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(sql, [...params, ps, offset]);
    const countWhere = where.slice();
    const countParams = params.slice();
    const countJoinSql = joinSql;
    const countWsql = countWhere.length ? 'WHERE ' + countWhere.join(' AND ') : '';
    const [[{ total } = { total: 0 }]] = await db.query(`
      SELECT COUNT(*) AS total FROM audit_logs a ${countJoinSql} ${countWsql}
    `, countParams);
    return { data: rows, page: p, pageSize: ps, total, pages: Math.ceil(total / ps) };
  }
};


// 未使用 (どこからも呼ばれていない)。DB側の trg_audit_logs_no_delete トリガーにより
// 呼び出してもエラーになる — 保持期間削除が本当に必要になったら、先にトリガーを見直すこと。
async function pruneOldLogs(retentionDays = 90) {
  const [result] = await db.query(
    `DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [retentionDays]
  );
  return result.affectedRows || 0;
}

module.exports.pruneOldLogs = pruneOldLogs;
