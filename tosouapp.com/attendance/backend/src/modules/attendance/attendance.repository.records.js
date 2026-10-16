'use strict';
const db = require('../../core/database/mysql');

// Ép kiểu tenantId về số cho an toàn
const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

const mergeLabels = (...values) => {
  const set = new Set();
  for (const value of values) {
    const parts = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) set.add(part);
  }
  return set.size ? Array.from(set).join(',') : null;
};

const todayJST = () => {
  try {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

// Cache danh sách cột để khỏi phải query information_schema mỗi lần
let _attendanceColCache = null;
let _attendanceColCacheTs = 0;
const COL_CACHE_TTL = 600000; // 10 phút

async function getAttendanceColumnSet() {
  const now = Date.now();
  if (_attendanceColCache && (now - _attendanceColCacheTs) < COL_CACHE_TTL) {
    return _attendanceColCache;
  }
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'attendance'
    `);
    _attendanceColCache = new Set((cols || []).map(c => String(c.name)));
    _attendanceColCacheTs = now;
    return _attendanceColCache;
  } catch {
    return _attendanceColCache || new Set();
  }
}

async function listColumns() {
  const set = await getAttendanceColumnSet();
  return Array.from(set);
}

let _usaColCache = null;
let _usaColCacheTs = 0;

async function getUSAColumnSet() {
  const now = Date.now();
  if (_usaColCache && (now - _usaColCacheTs) < COL_CACHE_TTL) {
    return _usaColCache;
  }
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'user_shift_assignments'
    `);
    _usaColCache = new Set((cols || []).map(c => String(c.name)));
    _usaColCacheTs = now;
    return _usaColCache;
  } catch {
    try {
      const [cols2] = await db.query(`SHOW COLUMNS FROM user_shift_assignments`);
      _usaColCache = new Set((cols2 || []).map(c => String(c.Field)));
      _usaColCacheTs = now;
      return _usaColCache;
    } catch {
      return _usaColCache || new Set();
    }
  }
}

function getUSAStartCol(set) {
  if (set && set.has && set.has('date')) return 'date';
  if (set && set.has && set.has('start_date')) return 'start_date';
  return 'start_date';
}

module.exports = {
  async createCheckIn(userId, time, loc, labels, workType, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const dateStr = String(time).slice(0, 10);
    const setUSA = await getUSAColumnSet();
    const startCol = getUSAStartCol(setUSA);
    const hasEnd = setUSA.has('end_date');
    const whereEnd = hasEnd ? 'AND (a.end_date IS NULL OR a.end_date >= ?)' : '';
    const params = hasEnd ? [userId, dateStr, dateStr] : [userId, dateStr];
    const [assignRows] = await db.query(`
      SELECT a.*
      FROM user_shift_assignments a
      WHERE a.userId = ? AND a.${startCol} <= ? ${whereEnd}
      ORDER BY a.${startCol} DESC
      LIMIT 1
    `, params);
    const assign = assignRows && assignRows[0] ? assignRows[0] : null;
    const set = await getAttendanceColumnSet();
    const cols = ['userId', 'checkIn'];
    const vals = [userId, time];
    let assignedShiftId = assign?.shiftId || null;
    if (!assignedShiftId && assign && Object.prototype.hasOwnProperty.call(assign, 'shift')) {
      const [defs] = await db.query(`SELECT id FROM shift_definitions WHERE name = ? LIMIT 1`, [assign.shift]);
      assignedShiftId = defs && defs[0] ? defs[0].id : null;
    }
    if (set.has('shiftId')) { cols.push('shiftId'); vals.push(assignedShiftId); }
    if (set.has('work_type')) { cols.push('work_type'); vals.push(workType || null); }
    if (set.has('in_latitude')) { cols.push('in_latitude'); vals.push(loc?.latitude ?? null); }
    if (set.has('in_longitude')) { cols.push('in_longitude'); vals.push(loc?.longitude ?? null); }
    if (set.has('in_accuracy')) { cols.push('in_accuracy'); vals.push(loc?.accuracy ?? null); }
    if (set.has('in_locationSource')) { cols.push('in_locationSource'); vals.push(loc?.locationSource ?? null); }
    if (set.has('in_countryCode')) { cols.push('in_countryCode'); vals.push(loc?.countryCode ?? null); }
    if (set.has('in_note')) { cols.push('in_note'); vals.push(loc?.note ?? null); }
    if (set.has('in_deviceId')) { cols.push('in_deviceId'); vals.push(loc?.deviceId ?? null); }
    if (set.has('in_tzOffset')) { cols.push('in_tzOffset'); vals.push(loc?.tzOffset ?? null); }
    if (set.has('labels')) { cols.push('labels'); vals.push(labels || null); }
    if (set.has('tenant_id') && tid != null) { cols.push('tenant_id'); vals.push(tid); }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO attendance (${cols.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`;
    const [result] = await db.query(sql, vals);
    return result.insertId;
  },
  async createCheckInTx(userId, time, loc, labels, workType, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`SELECT id FROM users WHERE id = ? FOR UPDATE`, [userId]);
      const dateStr = String(time).slice(0, 10);
      const setUSA = await getUSAColumnSet();
      const startCol = getUSAStartCol(setUSA);
      const hasEnd = setUSA.has('end_date');
      const whereEnd = hasEnd ? 'AND (a.end_date IS NULL OR a.end_date >= ?)' : '';
      const orderCol = startCol;
      const hasShiftName = setUSA.has('shift');
      const hasShiftId = setUSA.has('shiftId');
      const sqlAssign = hasShiftName
        ? `
        SELECT COALESCE(a.shiftId, d.id) AS sid, d.start_time AS shift_start, d.end_time AS shift_end
        FROM user_shift_assignments a
        LEFT JOIN shift_definitions d ON d.name = a.shift
        WHERE a.userId = ? AND a.${startCol} <= ? ${whereEnd}
        ORDER BY a.${orderCol} DESC
        LIMIT 1
      `
        : (hasShiftId
          ? `
        SELECT a.shiftId AS sid, d.start_time AS shift_start, d.end_time AS shift_end
        FROM user_shift_assignments a
        LEFT JOIN shift_definitions d ON d.id = a.shiftId
        WHERE a.userId = ? AND a.${startCol} <= ? ${whereEnd}
        ORDER BY a.${orderCol} DESC
        LIMIT 1
      `
          : `
        SELECT NULL AS sid, NULL AS shift_start, NULL AS shift_end
        FROM user_shift_assignments a
        WHERE a.userId = ? AND a.${startCol} <= ? ${whereEnd}
        ORDER BY a.${orderCol} DESC
        LIMIT 1
      `);
      const paramsAssign = hasEnd ? [userId, dateStr, dateStr] : [userId, dateStr];
      const [assignRows] = await conn.query(sqlAssign, paramsAssign);
      const assignedShiftId = assignRows && assignRows[0] ? assignRows[0].sid : null;
      const assignedShiftStart = String(assignRows?.[0]?.shift_start || '08:00').trim() || '08:00';
      const assignedShiftEnd = String(assignRows?.[0]?.shift_end || '17:00').trim() || '17:00';

      // Màn hình chấm công: mỗi ngày chỉ cho check-in một lần
      const [openRows] = await conn.query(
        `SELECT id, checkIn, checkOut, work_type, labels
         FROM attendance
         WHERE userId = ? AND DATE(checkIn) = ?
         ORDER BY checkIn DESC
         LIMIT 1`,
        [userId, dateStr]
      );
      if (openRows && openRows.length) {
        const existing = openRows[0];
        const hasOut = !!existing?.checkOut;
        const inHm = String(existing?.checkIn || '').slice(11, 16);
        const outHm = String(existing?.checkOut || '').slice(11, 16);
        const looksPlannedShape = !!(inHm && inHm === assignedShiftStart && (!outHm || outHm === assignedShiftEnd));
        const canPromotePlanned = !!looksPlannedShape;
        if (canPromotePlanned) {
          const nextLabels = String(labels || '').trim() || null;
          await conn.query(
            `UPDATE attendance
             SET checkIn = ?, checkOut = NULL, work_type = COALESCE(?, work_type), labels = COALESCE(?, labels)
             WHERE id = ? AND userId = ?`,
            [time, workType || null, nextLabels, existing.id, userId]
          );
          await conn.commit();
          return existing.id;
        }
        await conn.rollback();
        return null;
      }
      const set = await getAttendanceColumnSet();
      const cols = ['userId', 'checkIn'];
      const vals = [userId, time];
      if (set.has('shiftId')) { cols.push('shiftId'); vals.push(assignedShiftId); }
      if (set.has('work_type')) { cols.push('work_type'); vals.push(workType || null); }
      if (set.has('in_latitude')) { cols.push('in_latitude'); vals.push(loc?.latitude ?? null); }
      if (set.has('in_longitude')) { cols.push('in_longitude'); vals.push(loc?.longitude ?? null); }
      if (set.has('in_accuracy')) { cols.push('in_accuracy'); vals.push(loc?.accuracy ?? null); }
      if (set.has('in_locationSource')) { cols.push('in_locationSource'); vals.push(loc?.locationSource ?? null); }
      if (set.has('in_countryCode')) { cols.push('in_countryCode'); vals.push(loc?.countryCode ?? null); }
      if (set.has('in_note')) { cols.push('in_note'); vals.push(loc?.note ?? null); }
      if (set.has('in_deviceId')) { cols.push('in_deviceId'); vals.push(loc?.deviceId ?? null); }
      if (set.has('in_tzOffset')) { cols.push('in_tzOffset'); vals.push(loc?.tzOffset ?? null); }
      if (set.has('labels')) { cols.push('labels'); vals.push(labels || null); }
      if (set.has('tenant_id') && tid != null) { cols.push('tenant_id'); vals.push(tid); }
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO attendance (${cols.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`;
      const [result] = await conn.query(sql, vals);
      await conn.commit();
      return result.insertId;
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally {
      conn.release();
    }
  },
  async getOpenAttendanceForUser(userId, dateStr, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const d = String(dateStr || todayJST()).slice(0, 10);
    const where = ['userId = ?', 'checkOut IS NULL', 'DATE(checkIn) = ?'];
    const params = [userId, d];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `SELECT * FROM attendance WHERE ${where.join(' AND ')} ORDER BY checkIn DESC LIMIT 1`;
    const [rows] = await db.query(sql, params);
    return rows[0];
  },
  async createMissingCheckIn(userId, checkOutTime, loc, labels, anomalyType, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const set = await getAttendanceColumnSet();
    const cols = ['userId', 'checkOut'];
    const vals = [userId, checkOutTime];
    if (set.has('is_anomaly')) { cols.push('is_anomaly'); vals.push(1); }
    if (set.has('anomaly_type')) { cols.push('anomaly_type'); vals.push(anomalyType); }
    if (set.has('out_latitude')) { cols.push('out_latitude'); vals.push(loc?.latitude ?? null); }
    if (set.has('out_longitude')) { cols.push('out_longitude'); vals.push(loc?.longitude ?? null); }
    if (set.has('out_accuracy')) { cols.push('out_accuracy'); vals.push(loc?.accuracy ?? null); }
    if (set.has('out_locationSource')) { cols.push('out_locationSource'); vals.push(loc?.locationSource ?? null); }
    if (set.has('out_countryCode')) { cols.push('out_countryCode'); vals.push(loc?.countryCode ?? null); }
    if (set.has('out_note')) { cols.push('out_note'); vals.push(loc?.note ?? null); }
    if (set.has('out_deviceId')) { cols.push('out_deviceId'); vals.push(loc?.deviceId ?? null); }
    if (set.has('out_tzOffset')) { cols.push('out_tzOffset'); vals.push(loc?.tzOffset ?? null); }
    if (set.has('labels')) { cols.push('labels'); vals.push(labels || null); }
    if (set.has('tenant_id') && tid != null) { cols.push('tenant_id'); vals.push(tid); }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO attendance (${cols.join(', ')}) VALUES (${placeholders})`;
    const [result] = await db.query(sql, vals);
    return result.insertId;
  },
  async setCheckOut(attendanceId, time, loc, labels, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const set = await getAttendanceColumnSet();
    const updates = ['checkOut = ?'];
    const vals = [time];
    if (set.has('out_latitude')) { updates.push('out_latitude = ?'); vals.push(loc?.latitude ?? null); }
    if (set.has('out_longitude')) { updates.push('out_longitude = ?'); vals.push(loc?.longitude ?? null); }
    if (set.has('out_accuracy')) { updates.push('out_accuracy = ?'); vals.push(loc?.accuracy ?? null); }
    if (set.has('out_locationSource')) { updates.push('out_locationSource = ?'); vals.push(loc?.locationSource ?? null); }
    if (set.has('out_countryCode')) { updates.push('out_countryCode = ?'); vals.push(loc?.countryCode ?? null); }
    if (set.has('out_note')) { updates.push('out_note = ?'); vals.push(loc?.note ?? null); }
    if (set.has('out_deviceId')) { updates.push('out_deviceId = ?'); vals.push(loc?.deviceId ?? null); }
    if (set.has('out_tzOffset')) { updates.push('out_tzOffset = ?'); vals.push(loc?.tzOffset ?? null); }
    if (set.has('labels')) { updates.push('labels = ?'); vals.push(labels || null); }
    const where = ['id = ?'];
    vals.push(attendanceId);
    if (tid != null) { where.push('tenant_id = ?'); vals.push(tid); }
    const sql = `UPDATE attendance SET ${updates.join(', ')} WHERE ${where.join(' AND ')}`;
    await db.query(sql, vals);
  },
  async listByUserBetween(userId, fromDate, toDate, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const start = fromDate + ' 00:00:00';
    const end = toDate + ' 23:59:59';
    let tidClause = '';
    const params = [userId, start, end, start, end];
    if (tid != null) { tidClause = ' AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT * FROM attendance
      WHERE userId = ?
        AND (
          (checkIn >= ? AND checkIn <= ?)
          OR (checkIn IS NULL AND checkOut >= ? AND checkOut <= ?)
        )
        ${tidClause}
      ORDER BY COALESCE(checkIn, checkOut) ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  // listByUserBetween の複数ユーザー版。N人分を1クエリで取る (N+1 を避けるため —
  // 200人規模の月次台帳/サマリーで、ユーザーごとに毎回クエリを投げると遅すぎるので追加した)。
  async listByUserIdsBetween(userIds, fromDate, toDate, { tenantId = null } = {}) {
    if (!Array.isArray(userIds) || !userIds.length) return [];
    const tid = _tid(tenantId);
    const start = fromDate + ' 00:00:00';
    const end = toDate + ' 23:59:59';
    let tidClause = '';
    const params = [userIds, start, end, start, end];
    if (tid != null) { tidClause = ' AND tenant_id = ?'; params.push(tid); }
    const sql = `
      SELECT * FROM attendance
      WHERE userId IN (?)
        AND (
          (checkIn >= ? AND checkIn <= ?)
          OR (checkIn IS NULL AND checkOut >= ? AND checkOut <= ?)
        )
        ${tidClause}
      ORDER BY userId ASC, COALESCE(checkIn, checkOut) ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async findCheckInByTime(userId, time, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'checkIn = ?'];
    const params = [userId, time];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`SELECT id FROM attendance WHERE ${where.join(' AND ')} LIMIT 1`, params);
    return rows[0];
  },
  // Tìm nhiều checkIn trong một query, trả về Map<checkInTime, { id }>
  async findCheckInsByTimes(userId, times, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const result = new Map();
    if (!Array.isArray(times) || !times.length) return result;
    const placeholders = times.map(() => '?').join(',');
    const where = ['userId = ?', `checkIn IN (${placeholders})`];
    const params = [userId, ...times];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `SELECT id, checkIn FROM attendance WHERE ${where.join(' AND ')}`,
      params
    );
    for (const r of (rows || [])) {
      result.set(String(r.checkIn), { id: r.id });
    }
    return result;
  },
  async findCheckOutByTime(userId, time, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'checkOut = ?'];
    const params = [userId, time];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`SELECT id FROM attendance WHERE ${where.join(' AND ')} LIMIT 1`, params);
    return rows[0];
  },
  async getById(attendanceId, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [attendanceId];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(`SELECT * FROM attendance WHERE ${where.join(' AND ')} LIMIT 1`, params);
    return rows[0];
  },
  async updateTimes(attendanceId, checkIn, checkOut, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const inV = checkIn ? String(checkIn) : '';
    const outV = checkOut ? String(checkOut) : '';
    if (!inV && !outV) return;

    const current = await this.getById(attendanceId, { tenantId });
    if (!current) return;
    const currentUserId = parseInt(String(current.userId || 0), 10);
    if (!currentUserId) return;
    const nextIn = inV;

    // Cho phép lưu bản ghi thiếu checkIn bằng cách đánh dấu là bất thường
    const isAnomaly = (!inV && outV) ? 1 : 0;
    const anomalyType = (!inV && outV) ? 'missing_checkin' : null;

    const [dups] = await db.query(
      `SELECT id, checkOut, work_type, labels, shiftId FROM attendance WHERE userId = ? AND checkIn = ? AND id <> ? ORDER BY id ASC LIMIT 1`,
      [currentUserId, nextIn || '1970-01-01', attendanceId] // Tránh match nhầm khi nextIn rỗng
    );
    const dup = dups && dups[0] ? dups[0] : null;
    if (dup && nextIn) {
      await db.query(`DELETE FROM attendance WHERE id = ?`, [dup.id]);
      const mergedLabels = mergeLabels(current.labels, dup.labels);
      const mergedShiftId = current.shiftId != null ? current.shiftId : dup.shiftId;
      await db.query(
        `
          UPDATE attendance
          SET checkIn = ?,
              checkOut = ?,
              work_type = ?,
              labels = ?,
              shiftId = ?,
              is_anomaly = ?,
              anomaly_type = ?
          WHERE id = ?
        `,
        [
          nextIn,
          outV || null,
          current.work_type || dup.work_type || null,
          mergedLabels,
          mergedShiftId != null ? mergedShiftId : null,
          isAnomaly,
          anomalyType,
          attendanceId
        ]
      );
      return;
    }
    
    // Kiểm tra bảng có cột is_anomaly và anomaly_type hay không
    const set = await getAttendanceColumnSet();
    
    if (set.has('is_anomaly') && set.has('anomaly_type')) {
      const sql = `
        UPDATE attendance
        SET checkIn = ?,
            checkOut = ?,
            is_anomaly = ?,
            anomaly_type = ?
        WHERE id = ?
      `;
      await db.query(sql, [inV || null, outV || null, isAnomaly, anomalyType, attendanceId]);
    } else {
      const sql = `
        UPDATE attendance
        SET checkIn = ?,
            checkOut = ?
        WHERE id = ?
      `;
      await db.query(sql, [inV || null, outV || null, attendanceId]);
    }
  },
  // Upsert hàng loạt trong một transaction: xử lý cả attendance_daily và các segment attendance
  async bulkUpsertAttendance(userId, { updates, dailyUpdates }, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const conn = await db.getConnection();

    // Đổi "HH:MM" thành số phút tính từ nửa đêm
    const hmToMin = (hm) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    };

    // Suy ra trạng thái từ kubun, có checkIn/checkOut hay chưa, có đi trễ hay không, và có memo không
    const deriveStatus = (kubun, checkInTime, shiftStart, checkOutTime, memo) => {
      const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
      const nonWorkKubunSet = new Set(['休日', '代替休日', '有給休暇', '無給休暇', '欠勤']);
      const k = String(kubun || '').trim();

      if (k && nonWorkKubunSet.has(k)) return '未承認';
      // 休日の出勤 (休日出勤/代替出勤/振替出勤 は休日にしか選べない): 定時が無いので遅刻にしない
      const holidayWorkKubunSet = new Set(['休日出勤', '代替出勤', '振替出勤']);

      if (!checkInTime) {
        // Chưa check-in: chỉ báo 未入力 cho ngày làm việc thực sự
        if (!k || workKubunSet.has(k)) return '未入力';
        return '未承認';
      }

      // checkIn + checkOut + memo đầy đủ → 確認済み
      const hasMemo = !!String(memo || '').trim();
      const hasCheckOut = !!String(checkOutTime || '').trim();
      if (hasCheckOut && hasMemo) return '確認済み';

      // Đã có check-in: so với giờ bắt đầu ca
      const ciMin = hmToMin(checkInTime);
      const ssMin = hmToMin(shiftStart || '08:00') ?? (8 * 60);
      const isLate = !holidayWorkKubunSet.has(k) && ciMin != null && ciMin > ssMin;
      return isLate ? '遅刻' : '未承認';
    };

    try {
      await conn.beginTransaction();

      let dailySaved = 0;
      let segCreated = 0;
      let segUpdated = 0;
      const createdIds = [];

      // Map date → checkInTime / checkOutTime lấy từ payload updates (các segment đang lưu)
      // Để dailyUpdates tính trạng thái theo check-in/out MỚI thay vì dữ liệu trong DB
      const checkInByDate = new Map();
      const checkOutByDate = new Map();
      if (Array.isArray(updates)) {
        for (const u of updates) {
          if (u?.delete === true) continue;
          const ci = String(u?.checkIn || '').trim();
          if (!ci) continue;
          // checkIn có dạng "YYYY-MM-DD HH:MM:SS" hoặc "YYYY-MM-DDTHH:MM:SS"
          const dateStr = ci.slice(0, 10);
          const timePart = ci.slice(11, 16); // "HH:MM"
          if (dateStr && timePart && !checkInByDate.has(dateStr)) {
            checkInByDate.set(dateStr, timePart);
          }
          const co = String(u?.checkOut || '').trim();
          if (co && dateStr && !checkOutByDate.has(dateStr)) {
            checkOutByDate.set(dateStr, co.slice(11, 16));
          }
        }
      }

      // 1. Xử lý các segment TRƯỚC để phần tính trạng thái thấy được trạng thái cuối cùng
      if (Array.isArray(updates)) {
        // Lấy sẵn tất cả bản ghi sẽ cập nhật trong một lần (tránh N câu SELECT riêng lẻ)
        const idsToUpdate = updates.filter(u => u.id && u.delete !== true).map(u => u.id);
        const currentMap = new Map();
        if (idsToUpdate.length) {
          const placeholders = idsToUpdate.map(() => '?').join(',');
          const [currentRows] = await conn.query(
            `SELECT id, checkIn, checkOut, work_type, labels, shiftId FROM attendance WHERE id IN (${placeholders}) AND userId = ?`,
            [...idsToUpdate, userId]
          );
          for (const row of (currentRows || [])) {
            currentMap.set(Number(row.id), row);
          }
        }

        for (const u of updates) {
          if (u.id) {
            if (u.delete === true) {
              await conn.query(`DELETE FROM attendance WHERE id = ? AND userId = ?`, [u.id, userId]);
              segUpdated++;
              continue;
            }
            const current = currentMap.get(Number(u.id));
            if (!current) continue;
            const nextCheckIn = u.checkIn ? String(u.checkIn) : null;
            // Chỉ kiểm tra trùng khi checkIn thực sự thay đổi
            if (nextCheckIn && nextCheckIn !== String(current.checkIn || '')) {
              const [dupRows] = await conn.query(
                `SELECT id, checkOut, work_type, labels, shiftId FROM attendance WHERE userId = ? AND checkIn = ? AND id <> ? ORDER BY id ASC LIMIT 1`,
                [userId, nextCheckIn, u.id]
              );
              const dup = dupRows && dupRows[0] ? dupRows[0] : null;
              if (dup) {
                await conn.query(`DELETE FROM attendance WHERE id = ? AND userId = ?`, [dup.id, userId]);
                const mergedLabels = mergeLabels(current.labels, dup.labels);
                const mergedShiftId = current.shiftId != null ? current.shiftId : dup.shiftId;
                await conn.query(
                  `UPDATE attendance SET checkIn=?,checkOut=?,work_type=?,labels=?,shiftId=? WHERE id=? AND userId=?`,
                  [nextCheckIn, u.checkOut||null, u.workType||current.work_type||dup.work_type||null, mergedLabels, mergedShiftId!=null?mergedShiftId:null, u.id, userId]
                );
                segUpdated++;
                continue;
              }
            }
            const fields = ['checkIn = ?', 'checkOut = ?', 'work_type = ?'];
            const vals = [u.checkIn||null, u.checkOut||null, u.workType||null];
            
            if (u.location !== undefined) { fields.push('location = ?'); vals.push(u.location || null); }
            if (u.memo !== undefined) { fields.push('memo = ?'); vals.push(u.memo || null); }
            if (u.notes !== undefined) { fields.push('notes = ?'); vals.push(u.notes || null); }
            
            vals.push(u.id, userId);
            await conn.query(`UPDATE attendance SET ${fields.join(', ')} WHERE id = ? AND userId = ?`, vals);
            segUpdated++;
          } else if (u.checkIn) {
            const loc = u.location || null;
            const mem = u.memo || null;
            const not = u.notes || null;
            const insertCols = ['userId', 'checkIn', 'checkOut', 'work_type', 'location', 'memo', 'notes'];
            const insertVals = [userId, u.checkIn, u.checkOut||null, u.workType||null, loc, mem, not];
            if (tid != null) { insertCols.push('tenant_id'); insertVals.push(tid); }
            const ph = insertCols.map(() => '?').join(', ');
            const [res] = await conn.query(
              `INSERT INTO attendance (${insertCols.join(', ')}) VALUES (${ph})
               ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),checkOut=VALUES(checkOut),work_type=VALUES(work_type),location=VALUES(location),memo=VALUES(memo),notes=VALUES(notes)`,
              insertVals
            );
            const newId = Number(res?.insertId||0)||null;
            const affected = Number(res?.affectedRows||0);
            if (affected===1) segCreated++;
            else segUpdated++;
            if (u.clientId && newId) {
              createdIds.push({ clientId: u.clientId, id: newId, checkIn: u.checkIn, checkOut: u.checkOut||null });
            }
          }
        }
      }

      // 2. Xử lý dailyUpdates — lúc này các segment đã nằm trong cùng transaction
      // ⚠️ QUAN TRỌNG: Phải MERGE existing giống repo.upsertDaily, KHÔNG được ghi đè toàn bộ
      //    field không có trong payload bằng null (gây mất 作業内容, 現場, giờ làm thực tế...)
      if (Array.isArray(dailyUpdates)) {
        // Chuẩn hóa, lọc date hợp lệ
        const validDaily = [];
        for (const d of dailyUpdates) {
          const date = String(d?.date || '').slice(0, 10);
          if (!date) continue;
          validDaily.push({ raw: d, date });
        }

        // Lấy sẵn giờ checkIn cho những ngày chưa có trong map payload
        const datesToLookup = [];
        for (const { date, raw: d } of validDaily) {
          if (checkInByDate.has(date)) continue;
          if (d.checkInTime) continue;
          datesToLookup.push(date);
        }
        const dbCheckInByDate = new Map();
        const dbCheckOutByDate = new Map();
        if (datesToLookup.length) {
          try {
            const placeholders = datesToLookup.map(() => '?').join(',');
            const [attRows] = await conn.query(
              `SELECT DATE(checkIn) AS d, checkIn, checkOut FROM attendance WHERE userId = ? AND DATE(checkIn) IN (${placeholders}) ORDER BY checkIn ASC`,
              [userId, ...datesToLookup]
            );
            for (const row of (attRows || [])) {
              const ds = String(row.d || '').slice(0, 10);
              if (ds && !dbCheckInByDate.has(ds)) {
                dbCheckInByDate.set(ds, String(row.checkIn).slice(11, 16));
              }
              if (ds && row.checkOut && !dbCheckOutByDate.has(ds)) {
                dbCheckOutByDate.set(ds, String(row.checkOut).slice(11, 16));
              }
            }
          } catch (e) { /* bỏ qua */ }
        }

        // Batch fetch existing attendance_daily để merge (1 câu SELECT thay vì N câu)
        const existingByDate = new Map();
        if (validDaily.length) {
          const allDates = validDaily.map(v => v.date);
          const ph = allDates.map(() => '?').join(',');
          const tenantSql = tid != null ? ' AND tenant_id = ? ' : '';
          const tenantParams = tid != null ? [tid] : [];
          try {
            const [existRows] = await conn.query(
              `SELECT date, kubun, kubun_confirmed, work_type, location, reason, memo, notes,
                      late_minutes, early_minutes, break_minutes, night_break_minutes,
                      furikae_holiday_date
               FROM attendance_daily
               WHERE userId = ? ${tenantSql} AND date IN (${ph})`,
              [userId, ...tenantParams, ...allDates]
            );
            for (const r of (existRows || [])) {
              const ds = String(r.date || '').slice(0, 10);
              if (ds) existingByDate.set(ds, r);
            }
          } catch (e) { /* bỏ qua */ }
        }

        const allowedKubunSet = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休日', '休日出勤', '代替出勤']);
        const protectedKubunSet = new Set([
          '出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤',
          '有給休暇', '欠勤', '無給休暇', '代替休日'
        ]);
        const sameStr = (a, b) => String(a ?? '') === String(b ?? '');

        for (const { raw: d, date } of validDaily) {
          const existing = existingByDate.get(date) || null;

          // === MERGE từng field: chỉ ghi đè nếu field CÓ MẶT (được định nghĩa) trong payload ===
          let kubun = existing?.kubun ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'kubun')) {
            const k = String(d.kubun || '').trim();
            if (allowedKubunSet.has(k)) {
              const newKubun = k || null;
              // Guard: nếu incoming = 休日 nhưng existing đã có kubun được bảo vệ → giữ nguyên existing
              if (newKubun === '休日') {
                const exK = String(existing?.kubun || '').trim();
                if (exK !== '' && exK !== '休日' && protectedKubunSet.has(exK)) {
                  // skip override, keep existing kubun
                } else {
                  kubun = newKubun;
                }
              } else {
                kubun = newKubun;
              }
            }
          }

          let kubunConfirmed = existing?.kubun_confirmed ?? 0;
          if (Object.prototype.hasOwnProperty.call(d, 'kubunConfirmed')) {
            kubunConfirmed = Number(d.kubunConfirmed || 0) ? 1 : 0;
          } else if (kubun != null && kubun !== '') {
            kubunConfirmed = 1;
          }

          let workType = existing?.work_type ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'workType')) {
            const wt = String(d.workType || '').trim();
            workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
          }

          let location = existing?.location ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'location')) {
            location = d.location != null ? String(d.location).slice(0, 120) : null;
          }

          let reason = existing?.reason ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'reason')) {
            reason = d.reason != null ? String(d.reason).slice(0, 32) : null;
          }

          let memo = existing?.memo ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'memo')) {
            memo = d.memo != null ? String(d.memo).slice(0, 60000) : null;
          }

          let notes = existing?.notes ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'notes')) {
            notes = d.notes != null ? String(d.notes).slice(0, 60000) : null;
          }

          let late_minutes = existing?.late_minutes ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'late_minutes')) {
            late_minutes = d.late_minutes == null ? null : Number(d.late_minutes);
          } else if (Object.prototype.hasOwnProperty.call(d, 'lateMinutes')) {
            late_minutes = d.lateMinutes == null ? null : Number(d.lateMinutes);
          }

          let early_minutes = existing?.early_minutes ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'early_minutes')) {
            early_minutes = d.early_minutes == null ? null : Number(d.early_minutes);
          } else if (Object.prototype.hasOwnProperty.call(d, 'earlyMinutes')) {
            early_minutes = d.earlyMinutes == null ? null : Number(d.earlyMinutes);
          }

          let breakMin = existing?.break_minutes ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'break_minutes')) {
            breakMin = d.break_minutes == null ? null : Number(d.break_minutes);
          } else if (Object.prototype.hasOwnProperty.call(d, 'breakMinutes')) {
            breakMin = d.breakMinutes == null ? null : Number(d.breakMinutes);
          }

          let nightBreakMin = existing?.night_break_minutes ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'night_break_minutes')) {
            nightBreakMin = d.night_break_minutes == null ? null : Number(d.night_break_minutes);
          } else if (Object.prototype.hasOwnProperty.call(d, 'nightBreakMinutes')) {
            nightBreakMin = d.nightBreakMinutes == null ? null : Number(d.nightBreakMinutes);
          }

          let furikaeHolidayDate = existing?.furikae_holiday_date ?? null;
          if (Object.prototype.hasOwnProperty.call(d, 'furikae_holiday_date')) {
            const fv = String(d.furikae_holiday_date || '').slice(0, 10);
            furikaeHolidayDate = /^\d{4}-\d{2}-\d{2}$/.test(fv) ? fv : null;
          } else if (Object.prototype.hasOwnProperty.call(d, 'furikaeHolidayDate')) {
            const fv = String(d.furikaeHolidayDate || '').slice(0, 10);
            furikaeHolidayDate = /^\d{4}-\d{2}-\d{2}$/.test(fv) ? fv : null;
          }

          // Skip INSERT/UPDATE nếu existing tồn tại và KHÔNG có field nào thay đổi (performance)
          if (existing) {
            const unchanged =
              sameStr(existing.kubun, kubun) &&
              Number(existing.kubun_confirmed || 0) === Number(kubunConfirmed || 0) &&
              sameStr(existing.work_type, workType) &&
              sameStr(existing.location, location) &&
              sameStr(existing.reason, reason) &&
              sameStr(existing.memo, memo) &&
              sameStr(existing.notes, notes) &&
              String(existing.late_minutes ?? '') === String(late_minutes ?? '') &&
              String(existing.early_minutes ?? '') === String(early_minutes ?? '') &&
              String(existing.break_minutes ?? '') === String(breakMin ?? '') &&
              String(existing.night_break_minutes ?? '') === String(nightBreakMin ?? '');
            if (unchanged) { dailySaved++; continue; }
          }

          // Ưu tiên checkIn từ payload; nếu không có thì dùng kết quả lấy từ DB
          let checkInTime = checkInByDate.get(date) || null;
          if (!checkInTime && d.checkInTime) {
            checkInTime = String(d.checkInTime).slice(0, 5);
          }
          if (!checkInTime) {
            checkInTime = dbCheckInByDate.get(date) || null;
          }
          // Tương tự cho checkOut
          let checkOutTime = checkOutByDate.get(date) || null;
          if (!checkOutTime) {
            checkOutTime = dbCheckOutByDate.get(date) || null;
          }
          const shiftStart = String(d.shiftStart || '08:00').trim();
          const status = deriveStatus(kubun, checkInTime, shiftStart, checkOutTime, memo);

          await conn.query(
            `
            INSERT INTO attendance_daily (userId, date, kubun, kubun_confirmed, work_type, location, reason, memo, notes, late_minutes, early_minutes, break_minutes, night_break_minutes, status, furikae_holiday_date, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              kubun = VALUES(kubun),
              kubun_confirmed = VALUES(kubun_confirmed),
              work_type = VALUES(work_type),
              location = VALUES(location),
              reason = VALUES(reason),
              memo = VALUES(memo),
              notes = VALUES(notes),
              late_minutes = VALUES(late_minutes),
              early_minutes = VALUES(early_minutes),
              break_minutes = VALUES(break_minutes),
              night_break_minutes = VALUES(night_break_minutes),
              status = VALUES(status),
              furikae_holiday_date = VALUES(furikae_holiday_date)
          `,
            [
              userId, date, kubun, kubunConfirmed, workType, location, reason, memo, notes,
              late_minutes, early_minutes,
              Number.isFinite(breakMin) ? breakMin : null,
              Number.isFinite(nightBreakMin) ? nightBreakMin : null,
              status, furikaeHolidayDate, tid
            ]
          );
          dailySaved++;
        }
      }

      await conn.commit();
      return { 
        ok: true, 
        saved: { daily: dailySaved, segmentsCreated: segCreated, segmentsUpdated: segUpdated },
        created: createdIds
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
};
