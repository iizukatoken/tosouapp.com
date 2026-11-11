'use strict';
const db = require('../../core/database/mysql');

// Chuẩn hóa tenant id về số nguyên (hoặc null).
const { scopedTid } = require('../../core/database/tenantContext');
// Không truyền tenantId trong request có công ty → xem core/database/tenantContext.js
function _tid(tenantId) {
  return scopedTid(tenantId);
}

// Cache danh sách cột bảng attendance để tránh truy vấn information_schema mỗi request
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

let _dailySchemaEnsured = false;
let _dailySchemaPromise = null;

async function ensureAttendanceDailySchema() {
  if (_dailySchemaEnsured) return;
  if (_dailySchemaPromise) return _dailySchemaPromise;
  _dailySchemaPromise = _doEnsureAttendanceDailySchema();
  try {
    await _dailySchemaPromise;
    _dailySchemaEnsured = true;
  } finally {
    _dailySchemaPromise = null;
  }
}

async function _doEnsureAttendanceDailySchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_daily (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      date DATE NOT NULL,
      kubun VARCHAR(24) NULL,
      kubun_confirmed TINYINT(1) NOT NULL DEFAULT 0,
      work_type VARCHAR(24) NULL,
      location VARCHAR(120) NULL,
      reason VARCHAR(32) NULL,
      memo VARCHAR(255) NULL,
      notes VARCHAR(255) NULL,
      late_minutes INT NULL,
      early_minutes INT NULL,
      break_minutes INT NULL,
      night_break_minutes INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_date (userId, date),
      INDEX idx_user_date (userId, date),
      CONSTRAINT fk_attendance_daily_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'attendance_daily'
    `);
    const set = new Set((cols || []).map((c) => String(c.name)));
    const alters = [];
    if (!set.has('kubun')) alters.push(`ADD COLUMN kubun VARCHAR(24) NULL`);
    if (!set.has('kubun_confirmed')) alters.push(`ADD COLUMN kubun_confirmed TINYINT(1) NOT NULL DEFAULT 0`);
    if (!set.has('work_type')) alters.push(`ADD COLUMN work_type VARCHAR(24) NULL`);
    if (!set.has('location')) alters.push(`ADD COLUMN location VARCHAR(120) NULL`);
    if (!set.has('reason')) alters.push(`ADD COLUMN reason VARCHAR(32) NULL`);
    if (!set.has('memo')) alters.push(`ADD COLUMN memo VARCHAR(255) NULL`);
    if (!set.has('notes')) alters.push(`ADD COLUMN notes VARCHAR(255) NULL`);
    if (!set.has('late_minutes')) alters.push(`ADD COLUMN late_minutes INT NULL`);
    if (!set.has('early_minutes')) alters.push(`ADD COLUMN early_minutes INT NULL`);
    if (!set.has('break_minutes')) alters.push(`ADD COLUMN break_minutes INT NULL`);
    if (!set.has('night_break_minutes')) alters.push(`ADD COLUMN night_break_minutes INT NULL`);
    if (!set.has('status')) alters.push(`ADD COLUMN status ENUM('未入力','未承認','遅刻','承認待ち','承認済み') NULL DEFAULT '未入力'`);
    if (!set.has('created_at')) alters.push(`ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    if (!set.has('updated_at')) alters.push(`ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    if (alters.length) {
      try { await db.query(`ALTER TABLE attendance_daily ${alters.join(', ')}`); } catch {}
    }
    if (set.has('status')) {
      try {
        const [typeCols] = await db.query(`SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attendance_daily' AND COLUMN_NAME = 'status'`);
        const colType = typeCols && typeCols[0] ? String(typeCols[0].COLUMN_TYPE) : '';
        if (colType && !colType.includes('遅刻')) {
          await db.query(`ALTER TABLE attendance_daily MODIFY COLUMN status ENUM('未入力','未承認','遅刻','承認待ち','承認済み') NULL DEFAULT '未入力'`);
        }
      } catch {}
    }
    // Nới các cột nội dung tự do (memo/notes/location) sang TEXT nếu đang là VARCHAR,
    // để không giới hạn độ dài 作業内容 → tránh lỗi "Data too long for column 'memo'".
    try {
      const [dtCols] = await db.query(`
        SELECT COLUMN_NAME AS name, DATA_TYPE AS dtype
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'attendance_daily'
          AND COLUMN_NAME IN ('memo','notes','location')
      `);
      for (const c of (dtCols || [])) {
        if (String(c.dtype).toLowerCase() !== 'text') {
          try { await db.query(`ALTER TABLE attendance_daily MODIFY COLUMN ${c.name} TEXT NULL`); } catch {}
        }
      }
    } catch {}
    try {
      const [idx] = await db.query(`
        SELECT index_name
        FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'attendance_daily'
      `);
      const idxSet = new Set((idx || []).map((i) => String(i.index_name)));
      if (!idxSet.has('idx_user_date')) {
        try { await db.query(`ALTER TABLE attendance_daily ADD INDEX idx_user_date (userId, date)`); } catch {}
      }
      if (!idxSet.has('idx_attendance_daily_date_user')) {
        try { await db.query(`ALTER TABLE attendance_daily ADD INDEX idx_attendance_daily_date_user (date, userId)`); } catch {}
      }
      if (!idxSet.has('idx_attendance_daily_user_status_date')) {
        try { await db.query(`ALTER TABLE attendance_daily ADD INDEX idx_attendance_daily_user_status_date (userId, status, date)`); } catch {}
      }
      if (!idxSet.has('idx_attendance_daily_date_kubun')) {
        try { await db.query(`ALTER TABLE attendance_daily ADD INDEX idx_attendance_daily_date_kubun (date, kubun)`); } catch {}
      }
    } catch {}
  } catch {}
}

module.exports = {
  async listPlanBetween(userId, fromDate, toDate, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'date >= ?', 'date <= ?'];
    const params = [userId, String(fromDate).slice(0, 10), String(toDate).slice(0, 10)];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `SELECT * FROM attendance_plan WHERE ${where.join(' AND ')} ORDER BY date ASC`,
      params
    );
    return rows;
  },
  async upsertPlan(userId, dateStr, plan, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const date = String(dateStr).slice(0, 10);
    const p = plan || {};
    const [res] = await db.query(
      `INSERT INTO attendance_plan (userId, date, shiftId, work_type, location, memo, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         shiftId = VALUES(shiftId),
         work_type = VALUES(work_type),
         location = VALUES(location),
         memo = VALUES(memo)`,
      [userId, date, p.shiftId || null, p.workType || null, p.location || null, p.memo || null, tid]
    );
    return { ok: true, affectedRows: res.affectedRows };
  },
  async getMonthStatus(userId, year, month, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!userId || !y || !m) return null;
    const where = ['ams.userId = ?', 'ams.year = ?', 'ams.month = ?'];
    const params = [userId, y, m];
    if (tid != null) { where.push('ams.tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `
      SELECT ams.*, u.username AS approved_by_name
      FROM attendance_month_status ams
      LEFT JOIN users u ON u.id = ams.approved_by
      WHERE ${where.join(' AND ')}
      LIMIT 1
      `,
      params
    );
    return rows && rows[0] ? rows[0] : null;
  },
  async getMonthStatusBulk(userIds, year, month, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!Array.isArray(userIds) || !userIds.length || !y || !m) return [];
    const where = ['ams.userId IN (?)', 'ams.year = ?', 'ams.month = ?'];
    const params = [userIds, y, m];
    if (tid != null) { where.push('ams.tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `
      SELECT ams.*, u.username AS approved_by_name
      FROM attendance_month_status ams
      LEFT JOIN users u ON u.id = ams.approved_by
      WHERE ${where.join(' AND ')}
      `,
      params
    );
    return rows || [];
  },
  async setMonthStatus(userId, year, month, status, actorId, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    const st = String(status || '').trim();
    if (!userId || !y || !m) return { ok: false };
    const allowed = new Set(['draft','submitted','approved','unlocked']);
    if (!allowed.has(st)) return { ok: false };
    const actor = actorId != null ? parseInt(String(actorId), 10) : null;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const fmt = (d) => {
      const z = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
    };
    const submittedAt = st === 'submitted' ? fmt(now) : null;
    const approvedAt = st === 'approved' ? fmt(now) : null;
    const unlockedAt = st === 'unlocked' ? fmt(now) : null;
    const [res] = await db.query(
      `
        INSERT INTO attendance_month_status (userId, year, month, status, submitted_at, submitted_by, approved_at, approved_by, unlocked_at, unlocked_by, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          submitted_at = COALESCE(VALUES(submitted_at), submitted_at),
          submitted_by = COALESCE(VALUES(submitted_by), submitted_by),
          approved_at = COALESCE(VALUES(approved_at), approved_at),
          approved_by = COALESCE(VALUES(approved_by), approved_by),
          unlocked_at = COALESCE(VALUES(unlocked_at), unlocked_at),
          unlocked_by = COALESCE(VALUES(unlocked_by), unlocked_by)
      `,
      [
        userId,
        y,
        m,
        st,
        submittedAt,
        st === 'submitted' ? actor : null,
        approvedAt,
        st === 'approved' ? actor : null,
        unlockedAt,
        st === 'unlocked' ? actor : null,
        tid
      ]
    );
    return { ok: true, affectedRows: Number(res?.affectedRows || 0) };
  },
  async upsertDaily(userId, dateStr, daily, { tenantId = null } = {}) {
    await ensureAttendanceDailySchema();
    const tid = _tid(tenantId);
    const date = String(dateStr).slice(0, 10);
    const incoming = daily && typeof daily === 'object' ? daily : {};
    const existing = await this.getDaily(userId, date, { tenantId });

    let kubun = existing?.kubun ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'kubun')) {
      const k = String(incoming.kubun || '').trim();
      const allowed = new Set(['', '出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休日', '休日出勤', '代替出勤']);
      if (allowed.has(k)) {
        const newKubun = k || null;
        // Bảo vệ: Nếu incoming muốn set '休日' nhưng existing đã có kubun cụ thể (khác null/'' và khác '休日')
        //         → giữ nguyên existing, tránh ghi đè dữ liệu đi làm / nghỉ phép bằng 休日
        if (newKubun === '休日') {
          const exK = String(existing?.kubun || '').trim();
          const protectedKubun = new Set([
            '出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤',
            '有給休暇', '欠勤', '無給休暇', '代替休日'
          ]);
          if (exK !== '' && exK !== '休日' && protectedKubun.has(exK)) {
            // keep existing kubun (skip override)
          } else {
            kubun = newKubun;
          }
        } else {
          kubun = newKubun;
        }
      }
    }

    let kubunConfirmed = existing?.kubun_confirmed ?? 0;
    if (Object.prototype.hasOwnProperty.call(incoming, 'kubunConfirmed')) {
      kubunConfirmed = Number(incoming.kubunConfirmed || 0) ? 1 : 0;
    } else if (kubun != null && kubun !== '') {
      kubunConfirmed = 1;
    }

    let workType = existing?.work_type ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'workType')) {
      const wt = String(incoming.workType || '').trim();
      workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
    }

    let location = existing?.location ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'location')) {
      location = incoming.location != null ? String(incoming.location).slice(0, 120) : null;
    }

    let reason = existing?.reason ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'reason')) {
      reason = incoming.reason != null ? String(incoming.reason).slice(0, 32) : null;
    }

    let memo = existing?.memo ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'memo')) {
      // Cột memo là TEXT (~65535 bytes). Giới hạn rộng để không mất dữ liệu 作業内容.
      memo = incoming.memo != null ? String(incoming.memo).slice(0, 60000) : null;
    }

    let notes = existing?.notes ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'notes')) {
      notes = incoming.notes != null ? String(incoming.notes).slice(0, 60000) : null;
    }

    let late_minutes = existing?.late_minutes ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'late_minutes')) {
      late_minutes = incoming.late_minutes == null ? null : Number(incoming.late_minutes);
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'lateMinutes')) {
      late_minutes = incoming.lateMinutes == null ? null : Number(incoming.lateMinutes);
    }
    
    let early_minutes = existing?.early_minutes ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'early_minutes')) {
      early_minutes = incoming.early_minutes == null ? null : Number(incoming.early_minutes);
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'earlyMinutes')) {
      early_minutes = incoming.earlyMinutes == null ? null : Number(incoming.earlyMinutes);
    }
    // 半休 / 半休(有給) の日は 遅刻・早退 を持たない（午前・午後どちらの出勤でもよい。月次勤怠・Excelと同じ規則）
    if (['半休', '半休(有給)', '半休（有給）'].includes(String(kubun || '').trim())) {
      late_minutes = null;
      early_minutes = null;
    }
    
    let breakMin = existing?.break_minutes ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'break_minutes')) {
      breakMin = incoming.break_minutes == null ? null : Number(incoming.break_minutes);
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'breakMinutes')) {
      breakMin = incoming.breakMinutes == null ? null : Number(incoming.breakMinutes);
    }
    
    let nightBreakMin = existing?.night_break_minutes ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'night_break_minutes')) {
      nightBreakMin = incoming.night_break_minutes == null ? null : Number(incoming.night_break_minutes);
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'nightBreakMinutes')) {
      nightBreakMin = incoming.nightBreakMinutes == null ? null : Number(incoming.nightBreakMinutes);
    }

    let furikaeHolidayDate = existing?.furikae_holiday_date ?? null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'furikae_holiday_date')) {
      const fv = String(incoming.furikae_holiday_date || '').slice(0, 10);
      furikaeHolidayDate = /^\d{4}-\d{2}-\d{2}$/.test(fv) ? fv : null;
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'furikaeHolidayDate')) {
      const fv = String(incoming.furikaeHolidayDate || '').slice(0, 10);
      furikaeHolidayDate = /^\d{4}-\d{2}-\d{2}$/.test(fv) ? fv : null;
    }

    const sameValue = (a, b) => {
      if (a == null && b == null) return true;
      return String(a ?? '') === String(b ?? '');
    };
    if (existing) {
      const unchanged =
        sameValue(existing.kubun, kubun) &&
        Number(existing.kubun_confirmed || 0) === Number(kubunConfirmed || 0) &&
        sameValue(existing.work_type, workType) &&
        sameValue(existing.location, location) &&
        sameValue(existing.reason, reason) &&
        sameValue(existing.memo, memo) &&
        sameValue(existing.notes, notes) &&
        String(existing.late_minutes ?? '') === String(late_minutes ?? '') &&
        String(existing.early_minutes ?? '') === String(early_minutes ?? '') &&
        String(existing.break_minutes ?? '') === String(breakMin ?? '') &&
        String(existing.night_break_minutes ?? '') === String(nightBreakMin ?? '');
      if (unchanged) return { ok: true, affectedRows: 0 };
    }
    const [res] = await db.query(
      `
        INSERT INTO attendance_daily (userId, date, kubun, kubun_confirmed, work_type, location, reason, memo, notes, late_minutes, early_minutes, break_minutes, night_break_minutes, furikae_holiday_date, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          furikae_holiday_date = VALUES(furikae_holiday_date)
      `,
      [
        userId,
        date,
        kubun,
        kubunConfirmed,
        workType,
        location,
        reason,
        memo,
        notes,
        late_minutes,
        early_minutes,
        Number.isFinite(breakMin) ? breakMin : null,
        Number.isFinite(nightBreakMin) ? nightBreakMin : null,
        furikaeHolidayDate,
        tid
      ]
    );
    return { ok: true, affectedRows: Number(res?.affectedRows || 0) };
  },
  async getDaily(userId, dateStr, { tenantId = null } = {}) {
    await ensureAttendanceDailySchema();
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'date = ?'];
    const params = [userId, String(dateStr).slice(0, 10)];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `SELECT * FROM attendance_daily WHERE ${where.join(' AND ')} LIMIT 1`,
      params
    );
    return rows && rows[0] ? rows[0] : null;
  },
  async listDailyBetween(userId, fromDate, toDate, { tenantId = null } = {}) {
    await ensureAttendanceDailySchema();
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'date >= ?', 'date <= ?'];
    const params = [userId, String(fromDate).slice(0, 10), String(toDate).slice(0, 10)];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      SELECT *
      FROM attendance_daily
      WHERE ${where.join(' AND ')}
      ORDER BY date ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  // listDailyBetween の複数ユーザー版 (N+1 回避用)。
  async listDailyBetweenForUsers(userIds, fromDate, toDate, { tenantId = null } = {}) {
    if (!Array.isArray(userIds) || !userIds.length) return [];
    await ensureAttendanceDailySchema();
    const tid = _tid(tenantId);
    const where = ['userId IN (?)', 'date >= ?', 'date <= ?'];
    const params = [userIds, String(fromDate).slice(0, 10), String(toDate).slice(0, 10)];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      SELECT *
      FROM attendance_daily
      WHERE ${where.join(' AND ')}
      ORDER BY userId ASC, date ASC
    `;
    const [rows] = await db.query(sql, params);
    return rows;
  },
  async setWorkTypeForUserDate(userId, dateStr, workType, { tenantId = null } = {}) {
    const set = await getAttendanceColumnSet();
    if (!set.has('work_type')) return { updated: 0 };
    const tid = _tid(tenantId);
    const where = ['userId = ?', 'DATE(checkIn) = ?'];
    const params = [workType || null, userId, String(dateStr).slice(0, 10)];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const sql = `
      UPDATE attendance
      SET work_type = ?
      WHERE ${where.join(' AND ')}
      ORDER BY checkIn DESC
      LIMIT 1
    `;
    const [res] = await db.query(sql, params);
    return { updated: Number(res?.affectedRows || 0) };
  },
  async setWorkTypeById(attendanceId, workType, { tenantId = null } = {}) {
    const set = await getAttendanceColumnSet();
    if (!set.has('work_type')) return { updated: 0 };
    const tid = _tid(tenantId);
    const where = ['id = ?'];
    const params = [workType || null, attendanceId];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [res] = await db.query(`UPDATE attendance SET work_type = ? WHERE ${where.join(' AND ')}`, params);
    return { updated: Number(res?.affectedRows || 0) };
  },
  async getMonthSummary(userId, year, month, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const uid = parseInt(String(userId), 10);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!uid || !y || !m) return null;
    const where = ['userId = ?', 'year = ?', 'month = ?'];
    const params = [uid, y, m];
    if (tid != null) { where.push('tenant_id = ?'); params.push(tid); }
    const [rows] = await db.query(
      `SELECT * FROM attendance_month_summary WHERE ${where.join(' AND ')} LIMIT 1`,
      params
    );
    return rows && rows[0] ? rows[0] : null;
  },
  async upsertMonthSummary(userId, year, month, summaryAll, summaryInhouse, actorId, { tenantId = null } = {}) {
    const tid = _tid(tenantId);
    const uid = parseInt(String(userId), 10);
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!uid || !y || !m) return { ok: false };
    const allStr = summaryAll == null ? null : JSON.stringify(summaryAll);
    const ihStr = summaryInhouse == null ? null : JSON.stringify(summaryInhouse);
    const actor = actorId != null ? parseInt(String(actorId), 10) : null;
    const [res] = await db.query(
      `
        INSERT INTO attendance_month_summary (userId, year, month, summary_all, summary_inhouse, updated_by, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          summary_all = VALUES(summary_all),
          summary_inhouse = VALUES(summary_inhouse),
          updated_by = VALUES(updated_by)
      `,
      [uid, y, m, allStr, ihStr, actor, tid]
    );
    return { ok: true, affectedRows: Number(res?.affectedRows || 0) };
  }
};
