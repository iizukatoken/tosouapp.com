const db = require('../../core/database/mysql');
// Tạo thông báo thất bại → báo quản trị (nơi gọi thường nuốt lỗi), rồi ném lại như cũ.
const _reportAndRethrow = (context) => (e) => {
  if (!(Number(e?.status) >= 400 && Number(e?.status) < 500)) {
    try { require('../../core/errorReporter').reportSwallowed(context, e); } catch (e2) { /* ignore */ }
  }
  throw e;
};

function _tid(tenantId) {
  return tenantId != null ? parseInt(String(tenantId), 10) : null;
}

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isYM = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const isSelfSubmitNotice = (row, uid) => {
  const me = parseInt(String(uid || 0), 10) || 0;
  const createdBy = parseInt(String(row?.created_by || row?.createdBy || 0), 10) || 0;
  if (!me || !createdBy || createdBy !== me) return false;
  const kind = String(row?.kind || '').toLowerCase();
  if (kind === 'expense_apply' || kind === 'leave_request' || kind === 'time_adjust' || kind === 'employee_action' || kind === 'attendance_punch') return true;
  const msg = String(row?.message || '');
  return /申請/.test(msg) && /(交通費|有休|休暇|時間修正|修正)/.test(msg);
};

async function ensureNoticeReadsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notice_reads (
      notice_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notice_id, user_id),
      INDEX idx_user_id (user_id),
      INDEX idx_read_at (read_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureNoticeHidesSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notice_hides (
      notice_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      hidden_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notice_id, user_id),
      INDEX idx_user_id (user_id),
      INDEX idx_hidden_at (hidden_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureNoticesSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      target_user_id BIGINT UNSIGNED NULL,
      target_date DATE NULL,
      target_month CHAR(7) NULL,
      message TEXT NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_target_user_id (target_user_id),
      INDEX idx_target_date (target_date),
      INDEX idx_target_month (target_month),
      INDEX idx_created_at (created_at),
      INDEX idx_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try { await db.query(`ALTER TABLE notices ADD COLUMN target_user_id BIGINT UNSIGNED NULL`); } catch (e) { /* silently ignored */ }
  try { await db.query(`CREATE INDEX idx_target_user_id ON notices (target_user_id)`); } catch (e) { /* silently ignored */ }
  try { await db.query(`ALTER TABLE notices ADD COLUMN kind VARCHAR(64) NULL`); } catch (e) { /* silently ignored */ }
  try { await db.query(`ALTER TABLE notices ADD COLUMN title VARCHAR(255) NULL`); } catch (e) { /* silently ignored */ }
  try { await db.query(`ALTER TABLE notices ADD COLUMN link_url VARCHAR(255) NULL`); } catch (e) { /* silently ignored */ }
  try { await db.query(`ALTER TABLE notices ADD COLUMN payload_json JSON NULL`); } catch (e) { /* silently ignored */ }
  try { await db.query(`ALTER TABLE notices ADD COLUMN audience VARCHAR(32) NOT NULL DEFAULT 'all'`); } catch (e) { /* silently ignored */ }
  try { await db.query(`CREATE INDEX idx_notices_audience ON notices (audience)`); } catch (e) { /* silently ignored */ }
  try { await db.query(`CREATE INDEX idx_notices_kind ON notices (kind)`); } catch (e) { /* silently ignored */ }
  try {
    const [cols] = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'notices'
    `);
    const set = new Set((cols || []).map(c => String(c.column_name)));
    const alters = [];
    if (!set.has('target_user_id')) alters.push(`ADD COLUMN target_user_id BIGINT UNSIGNED NULL`);
    if (!set.has('target_date')) alters.push(`ADD COLUMN target_date DATE NULL`);
    if (!set.has('target_month')) alters.push(`ADD COLUMN target_month CHAR(7) NULL`);
    if (!set.has('message')) alters.push(`ADD COLUMN message TEXT NOT NULL`);
    if (!set.has('created_by')) alters.push(`ADD COLUMN created_by BIGINT UNSIGNED NULL`);
    if (!set.has('created_at')) alters.push(`ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    if (!set.has('kind')) alters.push(`ADD COLUMN kind VARCHAR(64) NULL`);
    if (!set.has('title')) alters.push(`ADD COLUMN title VARCHAR(255) NULL`);
    if (!set.has('link_url')) alters.push(`ADD COLUMN link_url VARCHAR(255) NULL`);
    if (!set.has('payload_json')) alters.push(`ADD COLUMN payload_json JSON NULL`);
    if (!set.has('audience')) alters.push(`ADD COLUMN audience VARCHAR(32) NOT NULL DEFAULT 'all'`);
    if (alters.length) {
      try { await db.query(`ALTER TABLE notices ${alters.join(', ')}`); } catch (e) { /* silently ignored */ }
    }
  } catch (e) { /* silently ignored */ }
  // Migration: gán tenant_id = 1 cho thông báo cũ không có tenant_id (飯塚塗研 default)
  try { await db.query(`UPDATE notices SET tenant_id = 1 WHERE tenant_id IS NULL`); } catch (e) { /* silently ignored */ }
}

function buildSyntheticNoticeId(kind, sourceId) {
  const sid = parseInt(String(sourceId || 0), 10) || 0;
  if (!sid) return 0;
  const base = ({
    leave_request: 1000000000,
    time_adjust: 2000000000,
    expense_apply: 3000000000,
    faq_question: 4000000000
  })[String(kind || '')] || 9000000000;
  return base + sid;
}

const SYSTEM_KINDS = new Set([
  'system',
  'system_announcement',
  'announcement',
  'broadcast',
  'maintenance',
  'policy_update'
]);

const WORKFLOW_KINDS = new Set([
  'approval',
  'attendance',
  'expense',
  'chat',
  'leave_request',
  'time_adjust',
  'expense_apply',
  'faq_question',
  'workflow'
]);

const AUDIT_KINDS = new Set([
  'audit',
  'activity',
  'attendance_punch',
  'employee_action'
]);

function inferCategoryFromRow(row) {
  const kind = String(row?.kind || '').toLowerCase();
  if (SYSTEM_KINDS.has(kind)) return 'system';
  if (WORKFLOW_KINDS.has(kind)) return 'workflow';
  if (AUDIT_KINDS.has(kind)) return 'audit';
  const targetUserId = parseInt(String(row?.target_user_id || row?.targetUserId || 0), 10) || 0;
  if (targetUserId) return 'workflow';
  const audience = String(row?.audience || '').toLowerCase();
  if (audience === 'admin' || audience === 'manager' || audience === 'admin_manager') return 'workflow';
  const msg = String(row?.message || '');
  if (/(申請|承認|差戻|却下|打刻|check[- ]?in|check[- ]?out)/i.test(msg)) return 'workflow';
  return 'system';
}

module.exports = {
  ensureNoticesSchema,
  ensureNoticeReadsSchema,
  ensureNoticeHidesSchema,
  async createNotice(args) {
    return module.exports._createNotice(args).catch(_reportAndRethrow('notices.createNotice'));
  },
  async _createNotice({ targetUserId, targetDate, targetMonth, message, createdBy, kind = null, title = null, audience = 'all', tenantId = null }) {
    await ensureNoticesSchema();
    const tu = Number.isFinite(parseInt(String(targetUserId || ''), 10)) ? parseInt(String(targetUserId), 10) : null;
    const date = isISODate(targetDate) ? String(targetDate) : null;
    const month = isYM(targetMonth) ? String(targetMonth) : null;
    const msg = String(message || '').trim();
    if (!msg) throw Object.assign(new Error('Missing message'), { status: 400 });
    const k = String(kind || '').trim().slice(0, 64) || null;
    const t = String(title || '').trim().slice(0, 255) || null;
    const aud = ['all', 'admin', 'manager', 'admin_manager'].includes(String(audience)) ? String(audience) : 'all';
    const tid = tenantId ? parseInt(String(tenantId), 10) : null;
    const [res] = await db.query(
      `INSERT INTO notices (target_user_id, target_date, target_month, message, created_by, kind, title, audience, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tu, date, month, msg, createdBy || null, k, t, aud, tid]
    );
    const id = Number(res?.insertId || 0);
    const [rows] = await db.query(`SELECT * FROM notices WHERE id = ? LIMIT 1`, [id]);
    return rows && rows[0] ? rows[0] : { id };
  },
  async createAdminNotification(args) {
    return module.exports._createAdminNotification(args).catch(_reportAndRethrow('notices.createAdminNotification'));
  },
  async _createAdminNotification({ kind, title, message, linkUrl, payload, createdBy, audience = 'admin_manager', tenantId = null }) {
    await ensureNoticesSchema();
    const k = String(kind || '').slice(0, 64) || 'general';
    const t = String(title || '').trim().slice(0, 255) || '通知';
    const msg = String(message || '').trim();
    if (!msg) throw Object.assign(new Error('Missing message'), { status: 400 });
    const link = String(linkUrl || '').trim().slice(0, 255) || null;
    let pj = null;
    try { pj = payload == null ? null : JSON.stringify(payload); } catch { pj = null; }
    const aud = ['all', 'admin', 'manager', 'admin_manager'].includes(String(audience)) ? String(audience) : 'admin_manager';
    const tid = _tid(tenantId);
    try {
      const [res] = await db.query(
        `INSERT INTO notices (target_user_id, target_date, target_month, message, created_by, kind, title, link_url, payload_json, audience, tenant_id)
         VALUES (NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msg, createdBy || null, k, t, link, pj, aud, tid]
      );
      return { id: Number(res?.insertId || 0) };
    } catch {
      // Backward-compatible fallback if optional columns are unavailable on older DB schema.
      const compact = `[${t}] ${msg}`;
      const [res2] = await db.query(
        `INSERT INTO notices (target_user_id, target_date, target_month, message, created_by, tenant_id)
         VALUES (NULL, NULL, NULL, ?, ?, ?)`,
        [compact, createdBy || null, tid]
      );
      return { id: Number(res2?.insertId || 0) };
    }
  },
  async listAdminFeed({ userId, role, limit = 50, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeReadsSchema();
    await ensureNoticeHidesSchema();
    const uid = parseInt(String(userId || 0), 10) || 0;
    const r = String(role || '').toLowerCase();
    const lim = Math.min(200, Math.max(1, parseInt(String(limit || 50), 10) || 50));
    const tid = tenantId ? parseInt(String(tenantId), 10) : null;
    const tenantClause = tid ? `AND (n.tenant_id = ${tid} OR n.target_user_id = ${uid})` : '';
    const audienceSql = r === 'admin'
      ? `(n.audience IS NULL OR n.audience = '' OR n.audience IN ('all','admin','admin_manager'))`
      : `(n.audience IS NULL OR n.audience = '' OR n.audience IN ('all','manager','admin_manager'))`;
    let items = [];
    try {
      const [rows] = await db.query(
        `
        SELECT
          n.id,
          n.kind,
          n.title,
          n.message,
          n.link_url AS linkUrl,
          n.created_at AS createdAt,
          n.created_by AS createdBy,
          n.audience,
          n.payload_json AS payloadJson,
          CASE WHEN nr.read_at IS NULL THEN 0 ELSE 1 END AS isRead
        FROM notices n
        LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = ?
        WHERE n.target_user_id IS NULL
          AND ${audienceSql}
          ${tenantClause}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?
        `,
        [uid, lim]
      );
      items = Array.isArray(rows) ? rows.map((it) => {
        let payload = null;
        try { payload = it?.payloadJson ? JSON.parse(String(it.payloadJson)) : null; } catch { payload = null; }
        return {
          id: Number(it.id),
          kind: it.kind || 'general',
          title: it.title || '通知',
          message: it.message || '',
          linkUrl: it.linkUrl || null,
          createdAt: it.createdAt || null,
          createdBy: it.createdBy || null,
          audience: it.audience || 'all',
          isRead: Number(it.isRead || 0) === 1,
          payload,
          category: inferCategoryFromRow(it)
        };
      }).filter((it) => it.category === 'workflow') : [];
    } catch {
      // Backward-compatible fallback for minimal notices schema.
      const [rows2] = await db.query(
        `
        SELECT
          n.id,
          n.message,
          n.created_at AS createdAt,
          n.created_by AS createdBy,
          CASE WHEN nr.read_at IS NULL THEN 0 ELSE 1 END AS isRead
        FROM notices n
        LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = ?
        WHERE n.target_user_id IS NULL
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?
        `,
        [uid, lim]
      );
      items = Array.isArray(rows2) ? rows2.map((it) => ({
        id: Number(it.id),
        kind: 'general',
        title: '通知',
        message: it.message || '',
        linkUrl: '/admin/dashboard',
        createdAt: it.createdAt || null,
        createdBy: it.createdBy || null,
        audience: 'all',
        isRead: Number(it.isRead || 0) === 1,
        payload: null,
        category: inferCategoryFromRow(it)
      })).filter((it) => it.category === 'workflow') : [];
    }
    if (!items.length) {
      // Compatibility path: return legacy notice history even when audience metadata is missing/broken.
      const legacyTenantClause = tid ? `AND (n.tenant_id = ${tid})` : '';
      const [legacyRows] = await db.query(
        `
        SELECT
          n.id,
          n.message,
          n.created_at AS createdAt,
          n.created_by AS createdBy,
          CASE WHEN nr.read_at IS NULL THEN 0 ELSE 1 END AS isRead
        FROM notices n
        LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = ?
        WHERE n.target_user_id IS NULL
          ${legacyTenantClause}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?
        `,
        [uid, lim]
      );
      items = Array.isArray(legacyRows) ? legacyRows.map((it) => ({
        id: Number(it.id),
        kind: 'general',
        title: '通知',
        message: it.message || '',
        linkUrl: '/admin/dashboard',
        createdAt: it.createdAt || null,
        createdBy: it.createdBy || null,
        audience: 'all',
        isRead: Number(it.isRead || 0) === 1,
        payload: null,
        category: inferCategoryFromRow(it)
      })).filter((it) => it.category === 'workflow') : [];
    }
    if (!items.length) {
      // Last fallback: synthesize feed from real request tables so admin can still see history when notices table is empty.
      const whereRole = r === 'manager' ? ` AND u.role = 'employee'` : ``;
      const whereTenant = tid ? ` AND u.tenant_id = ${tid}` : ``;
      const whereAll = `${whereRole}${whereTenant}`;
      const [leaveItems] = await db.query(
        `
        SELECT
          lr.id AS sourceId,
          COALESCE(lr.created_at, NOW()) AS createdAt,
          COALESCE(u.username, u.email, CONCAT('user#', lr.userId)) AS username,
          lr.startDate AS startDate,
          lr.endDate AS endDate
        FROM leave_requests lr
        INNER JOIN users u ON u.id = lr.userId
        WHERE 1=1 ${whereAll}
        ORDER BY lr.created_at DESC
        LIMIT 20
        `
      );
      const [adjustItems] = await db.query(
        `
        SELECT
          ar.id AS sourceId,
          COALESCE(ar.created_at, NOW()) AS createdAt,
          COALESCE(u.username, u.email, CONCAT('user#', ar.userId)) AS username
        FROM time_adjust_requests ar
        INNER JOIN users u ON u.id = ar.userId
        WHERE 1=1 ${whereAll}
        ORDER BY ar.created_at DESC
        LIMIT 20
        `
      );
      const [expenseItems] = await db.query(
        `
        SELECT
          ec.id AS sourceId,
          COALESCE(ec.applied_at, ec.updated_at, ec.created_at, NOW()) AS createdAt,
          COALESCE(u.username, u.email, CONCAT('user#', ec.userId)) AS username,
          ec.amount AS amount
        FROM expense_claims ec
        INNER JOIN users u ON u.id = ec.userId
        WHERE 1=1 ${whereAll}
        ORDER BY COALESCE(ec.applied_at, ec.updated_at, ec.created_at) DESC
        LIMIT 20
        `
      );
      let faqItems = [];
      try {
        const [rowsFaq] = await db.query(
          `
          SELECT
            fq.id AS sourceId,
            COALESCE(fq.created_at, NOW()) AS createdAt,
            COALESCE(u.username, u.email, CONCAT('user#', fq.user_id)) AS username,
            fq.question AS question
          FROM faq_user_questions fq
          INNER JOIN users u ON u.id = fq.user_id
          WHERE 1=1 ${whereAll}
          ORDER BY fq.created_at DESC
          LIMIT 20
          `
        );
        faqItems = rowsFaq || [];
      } catch (e) { /* silently ignored */ }
      const mapped = []
        .concat((leaveItems || []).map((it) => ({
          id: buildSyntheticNoticeId('leave_request', it.sourceId),
          kind: 'leave_request',
          title: '有休申請',
          message: `${it.username || ''} さんの休暇申請 (${String(it.startDate || '').slice(0, 10)} ~ ${String(it.endDate || '').slice(0, 10)})`,
          linkUrl: '/admin/leave/requests',
          createdAt: it.createdAt || null,
          createdBy: null,
          audience: 'all',
          isRead: false,
          payload: null
        })))
        .concat((adjustItems || []).map((it) => ({
          id: buildSyntheticNoticeId('time_adjust', it.sourceId),
          kind: 'time_adjust',
          title: '時間修正',
          message: `${it.username || ''} さんの時間修正申請`,
          linkUrl: '/admin/attendance/adjust-requests',
          createdAt: it.createdAt || null,
          createdBy: null,
          audience: 'all',
          isRead: false,
          payload: null
        })))
        .concat((expenseItems || []).map((it) => ({
          id: buildSyntheticNoticeId('expense_apply', it.sourceId),
          kind: 'expense_apply',
          title: '交通費申請',
          message: `${it.username || ''} さんの交通費申請 ¥${Number(it.amount || 0).toLocaleString()}`,
          linkUrl: '/admin/expenses',
          createdAt: it.createdAt || null,
          createdBy: null,
          audience: 'all',
          isRead: false,
          payload: null
        })))
        .concat((faqItems || []).map((it) => ({
          id: buildSyntheticNoticeId('faq_question', it.sourceId),
          kind: 'faq_question',
          title: 'FAQ質問',
          message: `${it.username || ''} さん: ${String(it.question || '')}`,
          linkUrl: '/admin/chatbot/faq',
          createdAt: it.createdAt || null,
          createdBy: null,
          audience: 'all',
          isRead: false,
          payload: null
        })));
      items = mapped
        .map((it) => ({ ...it, category: inferCategoryFromRow(it) }))
        .filter((it) => it.category === 'workflow')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, lim);
      const syntheticIds = items.map((it) => Number(it.id || 0)).filter((n) => n > 0);
      if (syntheticIds.length && uid) {
        const placeholders = syntheticIds.map(() => '?').join(',');
        const [readRows] = await db.query(
          `SELECT notice_id FROM notice_reads WHERE user_id = ? AND notice_id IN (${placeholders})`,
          [uid, ...syntheticIds]
        );
        const readSet = new Set((readRows || []).map((r) => Number(r.notice_id || 0)));
        items = items.map((it) => ({ ...it, isRead: readSet.has(Number(it.id || 0)) }));
      }
    }
    const adminIds = items.map((it) => Number(it?.id || 0)).filter((n) => n > 0);
    if (uid && adminIds.length) {
      const placeholders = adminIds.map(() => '?').join(',');
      const [hiddenRows] = await db.query(
        `SELECT notice_id FROM notice_hides WHERE user_id = ? AND notice_id IN (${placeholders})`,
        [uid, ...adminIds]
      );
      const hiddenSet = new Set((hiddenRows || []).map((r) => Number(r.notice_id || 0)));
      items = items.filter((it) => !hiddenSet.has(Number(it?.id || 0)));
    }
    const unread = items.reduce((s, it) => s + (it.isRead ? 0 : 1), 0);
    return { unread, total: items.length, items };
  },
  async listForDate({ date, month, limit, userId, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeReadsSchema();
    await ensureNoticeHidesSchema();
    const d = isISODate(date) ? String(date) : null;
    const m = isYM(month) ? String(month) : (d ? String(d).slice(0, 7) : null);
    const lim = Math.min(50, Math.max(1, parseInt(String(limit || 10), 10) || 10));
    const uid = parseInt(String(userId || 0), 10) || 0;
    const tid = tenantId ? parseInt(String(tenantId), 10) : null;
    const tenantClause = tid ? 'AND (n.tenant_id = ? OR n.target_user_id = ?)' : '';
    const tenantParams = tid ? [tid, uid] : [];
    const [rows] = await db.query(
      `
        SELECT n.id, n.target_user_id, n.target_date, n.target_month, n.message, n.created_by, n.created_at, n.link_url,
               n.audience, r.read_at
        FROM notices n
        LEFT JOIN notice_reads r
          ON r.notice_id = n.id AND r.user_id = ?
        LEFT JOIN notice_hides h
          ON h.notice_id = n.id AND h.user_id = ?
        WHERE (n.target_user_id = ? OR (n.target_user_id IS NULL AND (n.audience IS NULL OR n.audience = '' OR n.audience = 'all')))
          AND h.notice_id IS NULL
          AND (n.kind IS NULL OR n.kind != 'attendance_punch')
          ${tenantClause}
          AND (
            (n.target_date IS NULL AND n.target_month IS NULL)
            OR (n.target_date IS NOT NULL AND ? IS NOT NULL AND n.target_date = ?)
            OR (n.target_month IS NOT NULL AND ? IS NOT NULL AND n.target_month = ?)
          )
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?
      `,
      [uid, uid, uid, ...tenantParams, d, d, m, m, lim]
    );
    return (rows || [])
      .filter((r) => !isSelfSubmitNotice(r, uid));
  },
  async listForUserFeed({ limit, userId, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeReadsSchema();
    await ensureNoticeHidesSchema();
    const lim = Math.min(200, Math.max(1, parseInt(String(limit || 30), 10) || 30));
    const uid = parseInt(String(userId || 0), 10) || 0;
    const tid = tenantId ? parseInt(String(tenantId), 10) : null;
    const tenantClause = tid ? 'AND (n.tenant_id = ? OR n.target_user_id = ?)' : '';
    const tenantParams = tid ? [tid, uid] : [];
    const [rows] = await db.query(
      `
        SELECT n.id, n.target_user_id, n.target_date, n.target_month, n.message, n.created_by, n.created_at,
               n.audience, r.read_at
        FROM notices n
        LEFT JOIN notice_reads r
          ON r.notice_id = n.id AND r.user_id = ?
        LEFT JOIN notice_hides h
          ON h.notice_id = n.id AND h.user_id = ?
        WHERE (n.target_user_id = ? OR (n.target_user_id IS NULL AND (n.audience IS NULL OR n.audience = '' OR n.audience = 'all')))
          AND h.notice_id IS NULL
          AND (n.kind IS NULL OR n.kind != 'attendance_punch')
          ${tenantClause}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?
      `,
      [uid, uid, uid, ...tenantParams, lim]
    );
    const baseRows = rows || [];
    if (baseRows.length) {
      return baseRows
        .filter((r) => !isSelfSubmitNotice(r, uid));
    }

    // Fallback feed for employee side when notices table is still empty:
    // synthesize from own request history so bell is never empty in real usage.
    const [leaveItems] = await db.query(
      `
      SELECT id AS sourceId, status, startDate, endDate, created_at AS createdAt
      FROM leave_requests
      WHERE userId = ?
        AND LOWER(COALESCE(status, '')) IN ('approved','rejected')
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [uid]
    );
    const [adjustItems] = await db.query(
      `
      SELECT id AS sourceId, status, requestedCheckIn, requestedCheckOut, created_at AS createdAt
      FROM time_adjust_requests
      WHERE userId = ?
        AND LOWER(COALESCE(status, '')) IN ('approved','rejected')
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [uid]
    );
    const [expenseItems] = await db.query(
      `
      SELECT id AS sourceId, status, amount, date, COALESCE(applied_at, updated_at, created_at) AS createdAt
      FROM expense_claims
      WHERE userId = ?
        AND LOWER(COALESCE(status, '')) IN ('approved','rejected')
      ORDER BY COALESCE(applied_at, updated_at, created_at) DESC
      LIMIT 20
      `,
      [uid]
    );
    let items = []
      .concat((leaveItems || []).map((it) => ({
        id: buildSyntheticNoticeId('leave_request', it.sourceId),
        target_user_id: uid,
        target_date: null,
        target_month: null,
        message: `有休申請: ${String(it.startDate || '').slice(0, 10)} ~ ${String(it.endDate || '').slice(0, 10)} (${String(it.status || '')})`,
        created_by: null,
        created_at: it.createdAt || null,
        link_url: '/ui/requests',
        read_at: null
      })))
      .concat((adjustItems || []).map((it) => ({
        id: buildSyntheticNoticeId('time_adjust', it.sourceId),
        target_user_id: uid,
        target_date: null,
        target_month: null,
        message: `時間修正申請: ${String(it.requestedCheckIn || '').slice(0, 16)} ~ ${String(it.requestedCheckOut || '').slice(0, 16)} (${String(it.status || '')})`,
        created_by: null,
        created_at: it.createdAt || null,
        link_url: '/ui/adjust',
        read_at: null
      })))
      .concat((expenseItems || []).map((it) => ({
        id: buildSyntheticNoticeId('expense_apply', it.sourceId),
        target_user_id: uid,
        target_date: null,
        target_month: null,
        message: `交通費申請: ¥${Number(it.amount || 0).toLocaleString()} (${String(it.status || '')})`,
        created_by: null,
        created_at: it.createdAt || null,
        link_url: '/ui/expenses',
        read_at: null
      })));
    items = items
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, lim);

    const ids = items.map((it) => Number(it.id || 0)).filter((n) => n > 0);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [readRows] = await db.query(
        `SELECT notice_id, read_at FROM notice_reads WHERE user_id = ? AND notice_id IN (${placeholders})`,
        [uid, ...ids]
      );
      const readMap = new Map((readRows || []).map((r) => [Number(r.notice_id || 0), r.read_at || null]));
      const [hiddenRows] = await db.query(
        `SELECT notice_id FROM notice_hides WHERE user_id = ? AND notice_id IN (${placeholders})`,
        [uid, ...ids]
      );
      const hiddenSet = new Set((hiddenRows || []).map((r) => Number(r.notice_id || 0)));
      items = items
        .filter((it) => !hiddenSet.has(Number(it.id || 0)))
        .map((it) => ({ ...it, read_at: readMap.get(Number(it.id || 0)) || null }));
    }
    return items;
  },
  async listAdmin({ from, to, limit, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeReadsSchema();
    const f = isISODate(from) ? String(from) : null;
    const t = isISODate(to) ? String(to) : null;
    const lim = Math.min(200, Math.max(1, parseInt(String(limit || 50), 10) || 50));
    const where = [];
    const args = [];
    if (f) { where.push(`n.created_at >= ?`); args.push(`${f} 00:00:00`); }
    if (t) { where.push(`n.created_at <= ?`); args.push(`${t} 23:59:59`); }
    where.push(`(n.kind IS NULL OR n.kind != 'system')`);
    if (tenantId) {
      where.push(`(n.tenant_id IS NULL OR n.tenant_id = ?)`);
      args.push(parseInt(String(tenantId), 10));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(
      `
        SELECT n.id, n.target_user_id, n.target_date, n.target_month, n.message, n.created_by, n.created_at,
               u.username AS target_username, u.employee_code AS target_employee_code, u.email AS target_email,
               rr.read_at AS target_read_at,
               COALESCE(rc.read_count, 0) AS read_count,
               n.kind,
               n.audience
        FROM notices n
        LEFT JOIN users u ON u.id = n.target_user_id
        LEFT JOIN notice_reads rr ON rr.notice_id = n.id AND rr.user_id = n.target_user_id
        LEFT JOIN (
          SELECT notice_id, COUNT(*) AS read_count
          FROM notice_reads
          GROUP BY notice_id
        ) rc ON rc.notice_id = n.id
        ${w}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      [...args, lim]
    );
    return (rows || []).filter((r) => inferCategoryFromRow(r) === 'system');
  },
  async markRead({ noticeIds, userId, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeReadsSchema();
    const uid = parseInt(String(userId || 0), 10) || 0;
    if (!uid) throw Object.assign(new Error('Missing userId'), { status: 400 });
    const ids = Array.isArray(noticeIds) ? noticeIds : [];
    const cleaned = [];
    for (const x of ids) {
      const n = parseInt(String(x || 0), 10);
      if (n) cleaned.push(n);
    }
    const unique = Array.from(new Set(cleaned)).slice(0, 50);
    if (!unique.length) return { marked: 0 };
    const tid = _tid(tenantId);
    let validIds = unique;
    if (tid) {
      // Kiem tra notice hop le truoc khi danh dau da doc.
      // Phai dong bo voi listForUserFeed: thong bao thuoc tenant HOAC gui rieng cho chinh user
      // (target_user_id = uid) deu duoc phep doc, du tenant_id cua notice khac.
      const placeholders = unique.map(() => '?').join(',');
      const [validRows] = await db.query(
        `SELECT id FROM notices WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL OR target_user_id = ?)`,
        [...unique, tid, uid]
      );
      const validSet = new Set((validRows || []).map(r => Number(r.id)));
      validIds = unique.filter(id => validSet.has(id));
    }
    if (!validIds.length) return { marked: 0 };
    for (const nid of validIds) {
      await db.query(
        `INSERT INTO notice_reads (notice_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE read_at = read_at`,
        [nid, uid]
      );
    }
    return { marked: validIds.length };
  },
  async hideForUser({ noticeIds, userId, tenantId = null }) {
    await ensureNoticesSchema();
    await ensureNoticeHidesSchema();
    const uid = parseInt(String(userId || 0), 10) || 0;
    if (!uid) throw Object.assign(new Error('Missing userId'), { status: 400 });
    const ids = Array.isArray(noticeIds) ? noticeIds : [];
    const cleaned = [];
    for (const x of ids) {
      const n = parseInt(String(x || 0), 10);
      if (n) cleaned.push(n);
    }
    const unique = Array.from(new Set(cleaned)).slice(0, 200);
    if (!unique.length) return { hidden: 0 };
    const tid = _tid(tenantId);
    let validIds = unique;
    if (tid) {
      // Kiem tra notice hop le truoc khi an.
      // Dong bo voi listForUserFeed va markRead: cho phep an notice thuoc tenant
      // HOAC notice gui rieng cho chinh user (target_user_id = uid).
      const placeholders = unique.map(() => '?').join(',');
      const [validRows] = await db.query(
        `SELECT id FROM notices WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL OR target_user_id = ?)`,
        [...unique, tid, uid]
      );
      const validSet = new Set((validRows || []).map(r => Number(r.id)));
      validIds = unique.filter(id => validSet.has(id));
    }
    if (!validIds.length) return { hidden: 0 };
    for (const nid of validIds) {
      await db.query(
        `INSERT INTO notice_hides (notice_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE hidden_at = hidden_at`,
        [nid, uid]
      );
    }
    return { hidden: validIds.length };
  },
  async deleteNotice(id, tenantId = null) {
    await ensureNoticesSchema();
    const nid = parseInt(String(id || 0), 10);
    if (!nid) throw Object.assign(new Error('Missing id'), { status: 400 });
    const tid = _tid(tenantId);
    if (tid) {
      const [res] = await db.query(`DELETE FROM notices WHERE id = ? AND tenant_id = ?`, [nid, tid]);
      return { deleted: Number(res?.affectedRows || 0) };
    }
    const [res] = await db.query(`DELETE FROM notices WHERE id = ?`, [nid]);
    return { deleted: Number(res?.affectedRows || 0) };
  }
};
