'use strict';

const db = require('../../core/database/mysql');
// Đánh dấu tổng hợp tháng (36協定) cần tính lại thất bại → báo quản trị, rồi ném lại như cũ.
const _reportAndRethrow = (context) => (e) => {
  if (!(Number(e?.status) >= 400 && Number(e?.status) < 500)) {
    try { require('../../core/errorReporter').reportSwallowed(context, e); } catch (e2) { /* ignore */ }
  }
  throw e;
};

function _tid(tenantId) {
  return tenantId != null ? parseInt(String(tenantId), 10) : null;
}

// 特別条項なしの基本条項相当をデフォルトにする (安全側)。特別条項がある会社は
// 管理画面 or setConfig() で明示的に上書きする。
const DEFAULT_CONFIG = {
  monthlyOtLimitMinutes: 45 * 60,
  annualOtLimitMinutes: 360 * 60,
  singleMonthLimitMinutes: 100 * 60,
  rollingAvgLimitMinutes: 80 * 60,
  maxMonthsOverLimit: 6,
  cautionThresholdRatio: 0.8
};

function _mapConfigRow(row) {
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    monthlyOtLimitMinutes: row.monthly_ot_limit_minutes,
    annualOtLimitMinutes: row.annual_ot_limit_minutes,
    singleMonthLimitMinutes: row.single_month_limit_minutes,
    rollingAvgLimitMinutes: row.rolling_avg_limit_minutes,
    maxMonthsOverLimit: row.max_months_over_limit,
    cautionThresholdRatio: Number(row.caution_threshold_ratio)
  };
}

module.exports = {
  DEFAULT_CONFIG,

  async getLaborAgreementConfig(tenantId = null) {
    const tid = _tid(tenantId);
    const sql = tid
      ? `SELECT * FROM labor_agreement_configs WHERE tenant_id = ? LIMIT 1`
      : `SELECT * FROM labor_agreement_configs WHERE tenant_id IS NULL LIMIT 1`;
    const [rows] = await db.query(sql, tid ? [tid] : []);
    return _mapConfigRow(rows[0]);
  },

  async setLaborAgreementConfig(tenantId, patch = {}) {
    const tid = _tid(tenantId);
    const current = await module.exports.getLaborAgreementConfig(tenantId);
    const next = { ...current, ...patch };
    const existingSql = tid
      ? `SELECT id FROM labor_agreement_configs WHERE tenant_id = ? LIMIT 1`
      : `SELECT id FROM labor_agreement_configs WHERE tenant_id IS NULL LIMIT 1`;
    const [existing] = await db.query(existingSql, tid ? [tid] : []);
    if (existing[0]) {
      await db.query(
        `UPDATE labor_agreement_configs SET monthly_ot_limit_minutes=?, annual_ot_limit_minutes=?, single_month_limit_minutes=?, rolling_avg_limit_minutes=?, max_months_over_limit=?, caution_threshold_ratio=? WHERE id=?`,
        [next.monthlyOtLimitMinutes, next.annualOtLimitMinutes, next.singleMonthLimitMinutes, next.rollingAvgLimitMinutes, next.maxMonthsOverLimit, next.cautionThresholdRatio, existing[0].id]
      );
      return;
    }
    await db.query(
      `INSERT INTO labor_agreement_configs (tenant_id, monthly_ot_limit_minutes, annual_ot_limit_minutes, single_month_limit_minutes, rolling_avg_limit_minutes, max_months_over_limit, caution_threshold_ratio) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tid, next.monthlyOtLimitMinutes, next.annualOtLimitMinutes, next.singleMonthLimitMinutes, next.rollingAvgLimitMinutes, next.maxMonthsOverLimit, next.cautionThresholdRatio]
    );
  },

  async getSummary(userId, year, month, tenantId = null) {
    const tid = _tid(tenantId);
    const sql = tid
      ? `SELECT * FROM monthly_summaries WHERE tenant_id = ? AND user_id = ? AND year = ? AND month = ? LIMIT 1`
      : `SELECT * FROM monthly_summaries WHERE tenant_id IS NULL AND user_id = ? AND year = ? AND month = ? LIMIT 1`;
    const params = tid ? [tid, userId, year, month] : [userId, year, month];
    const [rows] = await db.query(sql, params);
    return rows[0] || null;
  },

  // 指定ユーザーの、指定月より前 N ヶ月分 (同一年またがりも可) を新しい順で取得 — 年間累積・移動平均の計算に使う
  async listRecentSummaries(userId, beforeYear, beforeMonth, count, tenantId = null) {
    const tid = _tid(tenantId);
    const sql = tid
      ? `SELECT * FROM monthly_summaries WHERE tenant_id = ? AND user_id = ? AND (year < ? OR (year = ? AND month < ?)) ORDER BY year DESC, month DESC LIMIT ?`
      : `SELECT * FROM monthly_summaries WHERE tenant_id IS NULL AND user_id = ? AND (year < ? OR (year = ? AND month < ?)) ORDER BY year DESC, month DESC LIMIT ?`;
    const params = tid
      ? [tid, userId, beforeYear, beforeYear, beforeMonth, count]
      : [userId, beforeYear, beforeYear, beforeMonth, count];
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async listSummariesForYear(userId, year, tenantId = null) {
    const tid = _tid(tenantId);
    const sql = tid
      ? `SELECT * FROM monthly_summaries WHERE tenant_id = ? AND user_id = ? AND year = ? ORDER BY month ASC`
      : `SELECT * FROM monthly_summaries WHERE tenant_id IS NULL AND user_id = ? AND year = ? ORDER BY month ASC`;
    const params = tid ? [tid, userId, year] : [userId, year];
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // 月次集計(36協定)admin画面用: テナント内の該当月サマリーを社員名/部署名付きでまとめて取得する
  async listSummariesForMonth({ tenantId = null, year, month, dept = '', userId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['ms.year = ?', 'ms.month = ?'];
    const params = [year, month];
    if (tid != null) { where.push('u.tenant_id = ?'); params.push(tid); }
    if (dept) { where.push('d.name = ?'); params.push(dept); }
    if (userId) { where.push('ms.user_id = ?'); params.push(userId); }
    const [rows] = await db.query(`
      SELECT ms.*, u.employee_code AS employeeCode, u.username AS username, d.name AS departmentName
      FROM monthly_summaries ms
      JOIN users u ON u.id = ms.user_id
      LEFT JOIN departments d ON d.id = ms.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC
    `, params);
    return rows || [];
  },

  async upsertSummary(data) {
    const tid = _tid(data.tenantId);
    const existing = await module.exports.getSummary(data.userId, data.year, data.month, data.tenantId);
    const fields = [
      data.departmentId ?? null, data.attendDays, data.regularMinutes, data.overtimeMinutes,
      data.nightMinutes, data.holidayWorkMinutes, data.singleMonthBasisMinutes, data.annualOvertimeMinutes,
      data.rollingAvgMaxMinutes, data.monthsOver45hThisYear, data.judgement, data.ruleVersion || 'v1'
    ];
    if (existing) {
      await db.query(
        `UPDATE monthly_summaries SET department_id=?, attend_days=?, regular_minutes=?, overtime_minutes=?,
           night_minutes=?, holiday_work_minutes=?, single_month_basis_minutes=?, annual_overtime_minutes=?,
           rolling_avg_max_minutes=?, months_over_45h_this_year=?, judgement=?, rule_version=?, computed_at=NOW(), dirty=0
         WHERE id=?`,
        [...fields, existing.id]
      );
      return existing.id;
    }
    const [result] = await db.query(
      `INSERT INTO monthly_summaries (tenant_id, user_id, year, month, department_id, attend_days, regular_minutes,
         overtime_minutes, night_minutes, holiday_work_minutes, single_month_basis_minutes, annual_overtime_minutes,
         rolling_avg_max_minutes, months_over_45h_this_year, judgement, rule_version, computed_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [tid, data.userId, data.year, data.month, ...fields]
    );
    return result.insertId;
  },

  async markDirty(userId, year, month, tenantId = null) {
    return module.exports._markDirty(userId, year, month, tenantId).catch(_reportAndRethrow('summary.markDirty'));
  },
  async _markDirty(userId, year, month, tenantId = null) {
    const tid = _tid(tenantId);
    const existing = await module.exports.getSummary(userId, year, month, tenantId);
    if (existing) {
      await db.query(`UPDATE monthly_summaries SET dirty = 1 WHERE id = ?`, [existing.id]);
      return;
    }
    // まだ行が無ければ「dirty な空行」を作っておく — バッチが次回スキャンで拾って計算する
    await db.query(
      `INSERT INTO monthly_summaries (tenant_id, user_id, year, month, dirty) VALUES (?, ?, ?, ?, 1)`,
      [tid, userId, year, month]
    );
  },

  async listDirty(tenantId = null, limit = 500) {
    const tid = _tid(tenantId);
    const sql = tid
      ? `SELECT user_id, year, month FROM monthly_summaries WHERE tenant_id = ? AND dirty = 1 LIMIT ?`
      : `SELECT user_id, year, month FROM monthly_summaries WHERE tenant_id IS NULL AND dirty = 1 LIMIT ?`;
    const [rows] = await db.query(sql, tid ? [tid, limit] : [limit]);
    return rows;
  }
};
