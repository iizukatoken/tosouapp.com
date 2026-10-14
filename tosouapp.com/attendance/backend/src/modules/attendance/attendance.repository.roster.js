'use strict';
const db = require('../../core/database/mysql');

const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

module.exports = {
  async getUserWorkDetails(userId, limit = 10, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?'];
    const params = [userId];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    params.push(limit);
    const [rows] = await db.query(`
      SELECT id, start_date, end_date, company_name, work_place_address, work_content, role_title, responsibility_level
      FROM user_work_details
      WHERE ${where.join(' AND ')}
      ORDER BY start_date DESC, id DESC
      LIMIT ?
    `, params);
    return rows || [];
  },
  async getTodaySummaryStats(dateStr, tenantId = null) {
    const tid = _tid(tenantId);
    const attTidClause = tid ? 'AND tenant_id = ?' : '';
    const attTidParam = tid ? [tid] : [];
    const [[{ c_checkin } = { c_checkin: 0 }]] = await db.query(`
      SELECT COUNT(DISTINCT userId) AS c_checkin
      FROM attendance
      WHERE DATE(checkIn) = ? ${attTidClause}
    `, [dateStr, ...attTidParam]);
    const [[{ c_open } = { c_open: 0 }]] = await db.query(`
      SELECT COUNT(DISTINCT userId) AS c_open
      FROM attendance
      WHERE DATE(checkIn) = ? AND checkOut IS NULL ${attTidClause}
    `, [dateStr, ...attTidParam]);
    const tidClause = tid ? 'AND tenant_id = ?' : '';
    const tidParam = tid ? [tid] : [];
    const [[{ c_active } = { c_active: 0 }]] = await db.query(`
      SELECT COUNT(*) AS c_active
      FROM users
      WHERE employment_status = 'active'
        AND role IN ('employee','manager')
        ${tidClause}
    `, tidParam);
    const leaveTidClause = tid ? 'AND lr.userId IN (SELECT id FROM users WHERE tenant_id = ?)' : '';
    const leaveTidParam = tid ? [tid] : [];
    const [[{ c_leave_users } = { c_leave_users: 0 }]] = await db.query(`
      SELECT COUNT(DISTINCT userId) AS c_leave_users
      FROM leave_requests lr
      WHERE lr.status = 'approved'
        AND ? BETWEEN lr.startDate AND lr.endDate
        ${leaveTidClause}
    `, [dateStr, ...leaveTidParam]);
    return { c_checkin, c_open, c_active, c_leave_users };
  },
  async getTodayAttendanceRecords(userId, dateStr, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', '(DATE(checkIn) = ? OR (checkIn IS NULL AND DATE(checkOut) = ?))'];
    const params = [userId, dateStr, dateStr];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`
      SELECT id, checkIn, checkOut
      FROM attendance
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(checkIn, checkOut) DESC
    `, params);
    return rows || [];
  },
  async getTodayRosterItems(date, tenantId = null) {
    const tidClause = tenantId ? 'AND u.tenant_id = ?' : '';
    const tidParam = tenantId ? [parseInt(String(tenantId), 10)] : [];
    const [rows] = await db.query(`
      SELECT
        u.id AS userId,
        u.employee_code AS employeeCode,
        u.username AS username,
        u.role AS role,
        u.employment_type AS employmentType,
        u.departmentId AS departmentId,
        d.name AS departmentName,
        a.id AS attendanceId,
        a.shiftId AS shiftId,
        a.checkIn AS checkIn,
        a.checkOut AS checkOut,
        a.site AS site,
        a.work AS work,
        ad.kubun AS dailyKubun,
        sr.status AS shiftStatus,
        sr.leaveType AS shiftLeaveType
      FROM users u
      LEFT JOIN departments d
        ON d.id = u.departmentId
      LEFT JOIN attendance_daily ad
        ON ad.userId = u.id AND ad.date = ?
      LEFT JOIN shift_requests sr
        ON sr.userId = u.id AND sr.date = ?
      LEFT JOIN (
        SELECT
          userId,
          MIN(id) AS id,
          MIN(shiftId) AS shiftId,
          MIN(checkIn) AS checkIn,
          CASE WHEN SUM(checkOut IS NULL) > 0 THEN NULL ELSE MAX(checkOut) END AS checkOut,
          MAX(CASE WHEN (location IS NOT NULL AND location <> '') OR (memo IS NOT NULL AND memo <> '') THEN location END) AS site,
          MAX(CASE WHEN (location IS NOT NULL AND location <> '') OR (memo IS NOT NULL AND memo <> '') THEN memo END) AS work
        FROM attendance
        WHERE DATE(checkIn) = ? OR (checkIn IS NULL AND DATE(checkOut) = ?)
        GROUP BY userId
      ) a ON a.userId = u.id
      WHERE u.employment_status = 'active'
        AND u.role IN ('employee','manager')
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests lr
          WHERE lr.userId = u.id
            AND lr.status = 'approved'
            AND ? BETWEEN lr.startDate AND lr.endDate
        )
        ${tidClause}
      ORDER BY
        COALESCE(u.employee_code, '') ASC,
        u.id ASC,
        a.checkIn ASC
    `, [date, date, date, date, date, ...tidParam]);
    return rows || [];
  },
  async getTodayPlannedItems(date, tenantId = null) {
    const tid = _tid(tenantId);
    const tidClause = tid ? 'AND u.tenant_id = ?' : '';
    const tidParam = tid ? [tid] : [];
    const [rows] = await db.query(`
      SELECT
        u.id AS userId,
        u.employee_code AS employeeCode,
        u.username AS username,
        u.role AS role,
        u.departmentId AS departmentId,
        d.name AS departmentName,
        CASE WHEN lr.id IS NULL THEN 0 ELSE 1 END AS isLeave,
        lr.type AS leaveType
      FROM users u
      LEFT JOIN departments d
        ON d.id = u.departmentId
      LEFT JOIN leave_requests lr
        ON lr.userId = u.id
       AND lr.status = 'approved'
       AND ? BETWEEN lr.startDate AND lr.endDate
      WHERE u.employment_status = 'active'
        AND u.role IN ('employee','manager')
        ${tidClause}
      ORDER BY COALESCE(u.employee_code, '') ASC, u.id ASC
    `, [date, ...tidParam]);
    return rows || [];
  },
  // asOfDate があれば「その日時点で在籍していた部署」で絞り込む (異動履歴ベース) —
  // 月次の一括承認 (approveReadyMonth) はこれを渡すことで、承認する頃には他部署へ異動済みの人も
  // 正しく対象月の部署の一員として扱える。省略時は今の users.departmentId で絞り込む (現状の一覧・通知用途)。
  async getActiveUserIds(departmentId = null, { tenantId = null, asOfDate = null } = {}) {
    const tid = _tid(tenantId);
    if (departmentId != null && asOfDate) {
      const historyService = require('../departments/department.history.service');
      const historicUserIds = await historyService.getUsersInDepartmentAsOf(departmentId, asOfDate, { tenantId: tid });
      if (!historicUserIds.length) return [];
      const [rows] = await db.query(
        `SELECT id AS userId FROM users WHERE employment_status = 'active' AND role IN ('employee','manager') AND id IN (?)`,
        [historicUserIds]
      );
      return rows || [];
    }
    const params = [];
    let sql = `
      SELECT u.id AS userId
      FROM users u
      WHERE u.employment_status = 'active'
        AND u.role IN ('employee','manager')
    `;
    if (departmentId != null) {
      sql += ` AND u.departmentId = ?`;
      params.push(parseInt(String(departmentId), 10));
    }
    if (tid != null) {
      sql += ` AND u.tenant_id = ?`;
      params.push(tid);
    }
    const [rows] = await db.query(sql, params);
    return rows || [];
  },
  async recordGoOut(userId, dateStr, time, type, reason, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const sql = `
      INSERT INTO attendance_go_out (userId, date, go_out_time, type, reason, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(sql, [userId, dateStr, time, type, reason || null, tid]);
    return result.insertId;
  },
  async recordReturn(userId, dateStr, time, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'date = ?', 'return_time IS NULL'];
    const params = [time, userId, dateStr];
    if (tid != null) { where.push('tenant_id = ?'); params.splice(1, 0, tid); }
    const sql = `
      UPDATE attendance_go_out
      SET return_time = ?, status = '完了'
      WHERE ${where.join(' AND ')}
      ORDER BY go_out_time DESC LIMIT 1
    `;
    const [result] = await db.query(sql, params);
    return result.affectedRows;
  },
  async getGoOutRecords(userId, dateStr, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'date = ?'];
    const params = [userId, dateStr];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      SELECT id, go_out_time, return_time, type, reason, status, admin_note
      FROM attendance_go_out
      WHERE ${where.join(' AND ')}
      ORDER BY go_out_time ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows || [];
  },
  async getGoOutRecordsByMonth(userId, year, month, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const mStr = String(m).padStart(2, '0');
    const prefix = `${y}-${mStr}-`;
    const where = ['userId = ?', 'date LIKE ?'];
    const params = [userId, `${prefix}%`];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      SELECT id, date, go_out_time, return_time, type, reason, status, admin_note
      FROM attendance_go_out
      WHERE ${where.join(' AND ')}
      ORDER BY date ASC, go_out_time ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows || [];
  },
  async adminListGoOutRecords(filters) {
    const tid = _tid(filters.tenantId);
    let sql = `
      SELECT g.id, g.userId, u.username as employeeName, u.employee_code as employeeCode,
             g.date, g.go_out_time, g.return_time, g.type, g.reason, g.status, g.admin_note
      FROM attendance_go_out g
      LEFT JOIN users u ON g.userId = u.id
      WHERE 1=1
    `;
    const params = [];
    if (tid != null) {
      sql += ' AND g.tenant_id = ?';
      params.push(tid);
    }
    if (filters.userId) {
      sql += ' AND g.userId = ?';
      params.push(filters.userId);
    }
    if (filters.date) {
      sql += ' AND g.date = ?';
      params.push(filters.date);
    }
    if (filters.month) {
      sql += ' AND g.date LIKE ?';
      params.push(`${filters.month}-%`);
    }
    if (filters.status) {
      sql += ' AND g.status = ?';
      params.push(filters.status);
    }
    if (filters.type) {
      sql += ' AND g.type = ?';
      params.push(filters.type);
    }
    sql += ' ORDER BY g.date DESC, g.go_out_time DESC';
    const [rows] = await db.query(sql, params);
    return rows || [];
  },
  async adminForceEndGoOut(id, returnTime, status, adminNote, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [returnTime, status, adminNote, id];
    if (tid != null) { where.unshift('tenant_id = ?'); params.splice(3, 0, tid); }
    const sql = `
      UPDATE attendance_go_out
      SET return_time = ?, status = ?, admin_note = ?
      WHERE ${where.join(' AND ')}
    `;
    const [result] = await db.query(sql, params);
    return result.affectedRows;
  },
  async adminUpdateGoOut(id, goOutTime, returnTime, type, reason, adminNote, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [goOutTime, returnTime, type, reason, adminNote, id];
    if (tid != null) { where.unshift('tenant_id = ?'); params.splice(5, 0, tid); }
    const sql = `
      UPDATE attendance_go_out
      SET go_out_time = ?, return_time = ?, type = ?, reason = ?, status = '修正済み', admin_note = ?
      WHERE ${where.join(' AND ')}
    `;
    const [result] = await db.query(sql, params);
    return result.affectedRows;
  },
  async adminDeleteGoOut(id, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [id];
    if (tid != null) { where.unshift('tenant_id = ?'); params.unshift(tid); }
    const sql = `DELETE FROM attendance_go_out WHERE ${where.join(' AND ')}`;
    const [result] = await db.query(sql, params);
    return result.affectedRows;
  },
  async listWorkDetailsBetween(userId, fromDate, toDate, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const uid = parseInt(String(userId), 10);
    const from = String(fromDate || '').slice(0, 10);
    const to = String(toDate || '').slice(0, 10);
    if (!uid) return [];
    const where = ['d.userId = ?'];
    const params = [uid];
    if (tid != null) { where.push('d.tenant_id = ?'); params.push(tid); }
    if (from && to) {
      // start_date が NULL のレコードも含める（期間未設定の契約内容を除外しない）
      where.push('(d.start_date IS NULL OR d.start_date <= ?)');
      where.push('(d.end_date IS NULL OR d.end_date >= ?)');
      params.push(to, from);
    }
    const [rows] = await db.query(`
      SELECT *
      FROM user_work_details d
      WHERE ${where.join(' AND ')}
      ORDER BY d.start_date ASC, d.id ASC
    `, params);
    return rows || [];
  },
  async getWorkDetailById(id, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const xid = parseInt(String(id), 10);
    if (!xid) return null;
    const where = ['id = ?'];
    const params = [xid];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`SELECT * FROM user_work_details WHERE ${where.join(' AND ')} LIMIT 1`, params);
    return rows && rows[0] ? rows[0] : null;
  },
  async createWorkDetail(userId, data, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const uid = parseInt(String(userId), 10);
    if (!uid) return null;
    const d = data && typeof data === 'object' ? data : {};
    const startDate = String(d.startDate || d.start_date || '').slice(0, 10);
    const endDate = d.endDate == null || d.endDate === '' ? null : String(d.endDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    const company = d.companyName != null ? String(d.companyName).slice(0, 120) : null;
    const addr = d.workPlaceAddress != null ? String(d.workPlaceAddress).slice(0, 255) : null;
    const content = d.workContent != null ? String(d.workContent).slice(0, 255) : null;
    const roleTitle = d.roleTitle != null ? String(d.roleTitle).slice(0, 80) : null;
    const resp = d.responsibilityLevel != null ? String(d.responsibilityLevel).slice(0, 80) : null;
    const [res] = await db.query(`
      INSERT INTO user_work_details (userId, start_date, end_date, company_name, work_place_address, work_content, role_title, responsibility_level, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        end_date = VALUES(end_date),
        company_name = VALUES(company_name),
        work_place_address = VALUES(work_place_address),
        work_content = VALUES(work_content),
        role_title = VALUES(role_title),
        responsibility_level = VALUES(responsibility_level)
    `, [uid, startDate, endDate, company, addr, content, roleTitle, resp, tid]);
    return res?.insertId || null;
  },
  async updateWorkDetail(id, userId, data, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const xid = parseInt(String(id), 10);
    const uid = parseInt(String(userId), 10);
    if (!xid || !uid) return { ok: false, updated: 0 };
    const d = data && typeof data === 'object' ? data : {};
    const fields = [];
    const vals = [];
    if (Object.prototype.hasOwnProperty.call(d, 'startDate') || Object.prototype.hasOwnProperty.call(d, 'start_date')) {
      fields.push(`start_date = ?`);
      vals.push(String(d.startDate || d.start_date).slice(0, 10));
    }
    if (Object.prototype.hasOwnProperty.call(d, 'endDate') || Object.prototype.hasOwnProperty.call(d, 'end_date')) {
      fields.push(`end_date = ?`);
      vals.push(d.endDate == null || d.endDate === '' ? null : String(d.endDate).slice(0, 10));
    }
    if (Object.prototype.hasOwnProperty.call(d, 'companyName')) { fields.push(`company_name = ?`); vals.push(d.companyName); }
    if (Object.prototype.hasOwnProperty.call(d, 'workPlaceAddress')) { fields.push(`work_place_address = ?`); vals.push(d.workPlaceAddress); }
    if (Object.prototype.hasOwnProperty.call(d, 'workContent')) { fields.push(`work_content = ?`); vals.push(d.workContent); }
    if (Object.prototype.hasOwnProperty.call(d, 'roleTitle')) { fields.push(`role_title = ?`); vals.push(d.roleTitle); }
    if (Object.prototype.hasOwnProperty.call(d, 'responsibilityLevel')) { fields.push(`responsibility_level = ?`); vals.push(d.responsibilityLevel); }
    if (!fields.length) return { ok: true, updated: 0 };
    const where = ['id = ?', 'userId = ?'];
    vals.push(xid, uid);
    if (tid != null) { where.push('tenant_id = ?'); vals.push(tid); }
    const [res] = await db.query(`UPDATE user_work_details SET ${fields.join(', ')} WHERE ${where.join(' AND ')}`, vals);
    return { ok: true, updated: res?.affectedRows || 0 };
  },
  async deleteWorkDetail(id, userId, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const xid = parseInt(String(id), 10);
    const uid = parseInt(String(userId), 10);
    if (!xid || !uid) return { ok: false, deleted: 0 };
    const where = ['id = ?', 'userId = ?'];
    const params = [xid, uid];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [res] = await db.query(`DELETE FROM user_work_details WHERE ${where.join(' AND ')}`, params);
    return { ok: true, deleted: Number(res?.affectedRows || 0) };
  }
};
