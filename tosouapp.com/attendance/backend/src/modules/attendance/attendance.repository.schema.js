'use strict';
const db = require('../../core/database/mysql');

async function ensureAttendanceSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        checkIn DATETIME NULL,
        checkOut DATETIME NULL,
        work_type VARCHAR(24) NULL,
        labels VARCHAR(255) NULL,
        shiftId BIGINT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_checkin (userId, checkIn),
        INDEX idx_user_checkout (userId, checkOut),
        INDEX idx_checkin (checkIn),
        INDEX idx_shift (shiftId),
        CONSTRAINT fk_attendance_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'attendance'
    `);
    const set = new Set((cols || []).map(c => String(c.name)));
    const alters = [];
    if (!set.has('in_latitude')) alters.push(`ADD COLUMN in_latitude DECIMAL(9,6) NULL`);
    if (!set.has('in_longitude')) alters.push(`ADD COLUMN in_longitude DECIMAL(9,6) NULL`);
    if (!set.has('in_accuracy')) alters.push(`ADD COLUMN in_accuracy INT NULL`);
    if (!set.has('in_locationSource')) alters.push(`ADD COLUMN in_locationSource ENUM('gps','ip') NULL`);
    if (!set.has('in_countryCode')) alters.push(`ADD COLUMN in_countryCode CHAR(2) NULL`);
    if (!set.has('in_note')) alters.push(`ADD COLUMN in_note VARCHAR(255) NULL`);
    if (!set.has('in_deviceId')) alters.push(`ADD COLUMN in_deviceId VARCHAR(64) NULL`);
    if (!set.has('in_tzOffset')) alters.push(`ADD COLUMN in_tzOffset INT NULL`);
    if (!set.has('out_latitude')) alters.push(`ADD COLUMN out_latitude DECIMAL(9,6) NULL`);
    if (!set.has('out_longitude')) alters.push(`ADD COLUMN out_longitude DECIMAL(9,6) NULL`);
    if (!set.has('out_accuracy')) alters.push(`ADD COLUMN out_accuracy INT NULL`);
    if (!set.has('out_locationSource')) alters.push(`ADD COLUMN out_locationSource ENUM('gps','ip') NULL`);
    if (!set.has('out_countryCode')) alters.push(`ADD COLUMN out_countryCode CHAR(2) NULL`);
    if (!set.has('out_note')) alters.push(`ADD COLUMN out_note VARCHAR(255) NULL`);
    if (!set.has('out_deviceId')) alters.push(`ADD COLUMN out_deviceId VARCHAR(64) NULL`);
    if (!set.has('out_tzOffset')) alters.push(`ADD COLUMN out_tzOffset INT NULL`);
    if (!set.has('labels')) alters.push(`ADD COLUMN labels VARCHAR(255) NULL`);
    if (!set.has('work_type')) alters.push(`ADD COLUMN work_type VARCHAR(24) NULL`);
    if (!set.has('is_anomaly')) alters.push(`ADD COLUMN is_anomaly TINYINT(1) NOT NULL DEFAULT 0`);
    if (!set.has('anomaly_type')) alters.push(`ADD COLUMN anomaly_type VARCHAR(64) NULL`);
    if (!set.has('location')) alters.push(`ADD COLUMN location VARCHAR(255) NULL`);
    if (!set.has('memo')) alters.push(`ADD COLUMN memo TEXT NULL`);
    if (!set.has('notes')) alters.push(`ADD COLUMN notes TEXT NULL`);
    
    if (alters.length) {
      await db.query(`ALTER TABLE attendance ${alters.join(', ')}`);
    }

    // Nới memo/notes/location sang TEXT nếu bảng cũ đang là VARCHAR (tránh
    // lỗi "Data too long for column 'memo'" khi 作業内容 dài).
    try {
      const [dtCols] = await db.query(`
        SELECT COLUMN_NAME AS name, DATA_TYPE AS dtype
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'attendance'
          AND COLUMN_NAME IN ('memo','notes','location')
      `);
      for (const c of (dtCols || [])) {
        if (String(c.dtype).toLowerCase() !== 'text') {
          try { await db.query(`ALTER TABLE attendance MODIFY COLUMN ${c.name} TEXT NULL`); } catch {}
        }
      }
    } catch {}

    // UNIQUE INDEX (userId, checkIn) - chặn double submit
    const [indexes] = await db.query(`SHOW INDEX FROM attendance WHERE Key_name = 'unique_user_checkin'`);
    if (!indexes.length) {
      try {
        await db.query(`ALTER TABLE attendance ADD CONSTRAINT unique_user_checkin UNIQUE (userId, checkIn)`);
      } catch (err) {
        try {
          console.warn('⚠️ Could not add unique constraint, maybe duplicates already exist:', err.message);
          // Dọn trùng: giữ lại id nhỏ nhất cho mỗi cặp (userId, checkIn)
          await db.query(`
            DELETE a FROM attendance a
            JOIN (
              SELECT userId, checkIn, MIN(id) AS keep_id, COUNT(*) AS cnt
              FROM attendance
              WHERE checkIn IS NOT NULL
              GROUP BY userId, checkIn
              HAVING cnt > 1
            ) d
              ON d.userId = a.userId AND d.checkIn = a.checkIn AND a.id <> d.keep_id
          `);
          await db.query(`ALTER TABLE attendance ADD CONSTRAINT unique_user_checkin UNIQUE (userId, checkIn)`);
          console.warn('[repair] duplicate attendance rows cleaned and unique index added');
        } catch (e2) {
          console.warn('⚠️ Unique constraint still not added:', e2.message);
        }
      }
    }
    const [idx] = await db.query(`
      SELECT index_name 
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'attendance'
    `);
    const idxSet = new Set((idx || []).map(i => String(i.index_name)));
    if (!idxSet.has('idx_user_checkin')) {
      try { await db.query(`ALTER TABLE attendance ADD INDEX idx_user_checkin (userId, checkIn)`); } catch {}
    }
    if (!idxSet.has('idx_user_checkout')) {
      try { await db.query(`ALTER TABLE attendance ADD INDEX idx_user_checkout (userId, checkOut)`); } catch {}
    }
    if (!idxSet.has('idx_checkin')) {
      try { await db.query(`ALTER TABLE attendance ADD INDEX idx_checkin (checkIn)`); } catch {}
    }
    try {
      const [cols2] = await db.query(`
        SELECT COLUMN_NAME AS name 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'attendance'
      `);
      const set2 = new Set((cols2 || []).map(c => String(c.name)));
      if (!set2.has('shiftId')) {
        await db.query(`ALTER TABLE attendance ADD COLUMN shiftId BIGINT UNSIGNED NULL`);
        try { await db.query(`ALTER TABLE attendance ADD INDEX idx_shift (shiftId)`); } catch {}
      }
    } catch {}
  } catch {}
}

async function ensureAttendanceDailySchema() {
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
    if (!set.has('furikae_holiday_date')) alters.push(`ADD COLUMN furikae_holiday_date DATE NULL`);
    if (!set.has('created_at')) alters.push(`ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    if (!set.has('updated_at')) alters.push(`ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    if (alters.length) {
      try { await db.query(`ALTER TABLE attendance_daily ${alters.join(', ')}`); } catch {}
    }
    // Đảm bảo giá trị 遅刻 có trong ENUM status (phòng khi cột đã tạo trước khi thêm giá trị này)
    if (set.has('status')) {
      try {
        const [typeCols] = await db.query(`SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attendance_daily' AND COLUMN_NAME = 'status'`);
        const colType = typeCols && typeCols[0] ? String(typeCols[0].COLUMN_TYPE) : '';
        if (colType && !colType.includes('遅刻')) {
          await db.query(`ALTER TABLE attendance_daily MODIFY COLUMN status ENUM('未入力','未承認','遅刻','承認待ち','承認済み') NULL DEFAULT '未入力'`);
        }
      } catch {}
    }
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

async function ensureAttendanceMonthStatusSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_month_status (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      year INT NOT NULL,
      month INT NOT NULL,
      status ENUM('draft','submitted','approved','unlocked') NOT NULL DEFAULT 'draft',
      submitted_at DATETIME NULL,
      submitted_by BIGINT UNSIGNED NULL,
      approved_at DATETIME NULL,
      approved_by BIGINT UNSIGNED NULL,
      unlocked_at DATETIME NULL,
      unlocked_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_year_month (userId, year, month),
      INDEX idx_year_month (year, month),
      INDEX idx_status (status),
      CONSTRAINT fk_ams_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureWorkDetailsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_work_details (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NULL,
      company_name VARCHAR(120) NULL,
      work_place_address VARCHAR(255) NULL,
      work_content VARCHAR(255) NULL,
      role_title VARCHAR(80) NULL,
      responsibility_level VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_date (userId, start_date, end_date),
      CONSTRAINT fk_uwd_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 重複行を削除してから UNIQUE INDEX を追加する（既存の重複データを保護するため）
  try {
    await db.query(`
      DELETE d1 FROM user_work_details d1
      INNER JOIN user_work_details d2
        ON d1.userId = d2.userId
        AND d1.start_date = d2.start_date
        AND d1.id > d2.id
    `);
  } catch (e) { /* 重複なし、または削除済み */ }
  try {
    await db.query(`ALTER TABLE user_work_details ADD UNIQUE KEY uniq_uwd_user_start (userId, start_date)`);
  } catch (e) { /* 既に存在する場合は無視 */ }
}

async function ensureAttendanceMonthSummarySchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_month_summary (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      year INT NOT NULL,
      month INT NOT NULL,
      summary_all TEXT NULL,
      summary_inhouse TEXT NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_year_month (userId, year, month),
      INDEX idx_year_month (year, month),
      CONSTRAINT fk_amsum_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureAttendanceGoOutSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_go_out (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      date DATE NOT NULL,
      go_out_time DATETIME NOT NULL,
      return_time DATETIME NULL,
      type VARCHAR(24) NOT NULL,
      reason VARCHAR(255) NULL,
      tenant_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_date (userId, date),
      INDEX idx_ago_tid (tenant_id),
      CONSTRAINT fk_attendance_go_out_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    await db.query(`ALTER TABLE attendance_go_out ADD COLUMN status VARCHAR(20) DEFAULT '外出中'`);
  } catch (e) {
    // bỏ qua lỗi cột đã tồn tại
  }
  try {
    await db.query(`ALTER TABLE attendance_go_out ADD COLUMN admin_note VARCHAR(500) NULL`);
  } catch (e) {
    // bỏ qua lỗi cột đã tồn tại
  }
  try {
    await db.query(`ALTER TABLE attendance_go_out ADD COLUMN tenant_id BIGINT UNSIGNED NULL`);
  } catch (e) { /* cột có thể đã tồn tại */ }
  try {
    await db.query(`ALTER TABLE attendance_go_out ADD INDEX idx_ago_tid (tenant_id)`);
  } catch (e) { /* index có thể đã tồn tại */ }
}

async function ensureShiftTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS shift_definitions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      start_time CHAR(5) NOT NULL,
      end_time CHAR(5) NOT NULL,
      break_minutes INT NOT NULL DEFAULT 0,
      standard_minutes INT NOT NULL,
      working_days VARCHAR(255) NULL,
      tenant_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sd_tid (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  
  // Thêm cột working_days nếu chưa có
  try {
    const [cols] = await db.query(`SHOW COLUMNS FROM shift_definitions`);
    const set = new Set((cols || []).map(c => String(c.Field)));
    if (!set.has('working_days')) {
      await db.query(`ALTER TABLE shift_definitions ADD COLUMN working_days VARCHAR(255) NULL`);
    }
    if (!set.has('tenant_id')) {
      try { await db.query(`ALTER TABLE shift_definitions ADD COLUMN tenant_id BIGINT UNSIGNED NULL`); } catch {}
    }
  } catch {}
  try {
    await db.query(`ALTER TABLE shift_definitions ADD INDEX idx_sd_tid (tenant_id)`);
  } catch (e) { /* index có thể đã tồn tại */ }
  // FIX: `name` từng là UNIQUE toàn cục (không theo tenant) — 2 công ty khác nhau đặt
  // trùng tên ca (VD "day_8_17" là tên mặc định được seed sẵn) sẽ khiến INSERT...ON
  // DUPLICATE KEY của công ty sau GHI ĐÈ giờ giấc ca của công ty trước đó một cách âm
  // thầm. Chuyển sang UNIQUE theo (tenant_id, name) để mỗi công ty có ca riêng biệt.
  try {
    await db.query(`UPDATE shift_definitions SET tenant_id = 0 WHERE tenant_id IS NULL`);
  } catch (e) { /* bỏ qua nếu lỗi */ }
  try {
    await db.query(`ALTER TABLE shift_definitions MODIFY tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0`);
  } catch (e) { /* bỏ qua nếu lỗi */ }
  try {
    await db.query(`ALTER TABLE shift_definitions DROP INDEX name`);
  } catch (e) { /* đã xóa hoặc không tồn tại */ }
  try {
    await db.query(`ALTER TABLE shift_definitions ADD UNIQUE KEY uniq_sd_tenant_name (tenant_id, name)`);
  } catch (e) { /* đã tồn tại */ }
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_shift_assignments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      shiftId BIGINT UNSIGNED NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NULL,
      tenant_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_date (userId, start_date, end_date),
      INDEX idx_shift (shiftId),
      INDEX idx_usa_tid (tenant_id),
      CONSTRAINT fk_usa_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_usa_shift FOREIGN KEY (shiftId) REFERENCES shift_definitions(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'user_shift_assignments'
    `);
    const set = new Set((cols || []).map(c => String(c.name)));
    const alters = [];
    if (!set.has('userId')) alters.push(`ADD COLUMN userId BIGINT UNSIGNED NOT NULL`);
    if (!set.has('shiftId')) alters.push(`ADD COLUMN shiftId BIGINT UNSIGNED NOT NULL`);
    if (!set.has('start_date') && !set.has('date')) alters.push(`ADD COLUMN start_date DATE NOT NULL`);
    if (!set.has('end_date')) alters.push(`ADD COLUMN end_date DATE NULL`);
    if (!set.has('tenant_id')) alters.push(`ADD COLUMN tenant_id BIGINT UNSIGNED NULL`);
    if (alters.length) {
      await db.query(`ALTER TABLE user_shift_assignments ${alters.join(', ')}`);
    }
    const [idx] = await db.query(`
      SELECT index_name 
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'user_shift_assignments'
    `);
    const idxSet = new Set((idx || []).map(i => String(i.index_name)));
    if (!idxSet.has('idx_user_date')) {
      const startCol = set.has('date') ? 'date' : 'start_date';
      try { await db.query(`ALTER TABLE user_shift_assignments ADD INDEX idx_user_date (userId, ${startCol}, end_date)`); } catch {}
    }
    if (!idxSet.has('idx_shift')) {
      try { await db.query(`ALTER TABLE user_shift_assignments ADD INDEX idx_shift (shiftId)`); } catch {}
    }
    if (!idxSet.has('idx_usa_tid')) {
      try { await db.query(`ALTER TABLE user_shift_assignments ADD INDEX idx_usa_tid (tenant_id)`); } catch {}
    }
    try {
      const [fkUser] = await db.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_shift_assignments' AND COLUMN_NAME = 'userId' AND REFERENCED_TABLE_NAME IS NOT NULL
      `);
      if (!fkUser || !fkUser.length) {
        try { await db.query(`ALTER TABLE user_shift_assignments ADD CONSTRAINT fk_usa_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`); } catch {}
      }
      const [fkShift] = await db.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_shift_assignments' AND COLUMN_NAME = 'shiftId' AND REFERENCED_TABLE_NAME IS NOT NULL
      `);
      if (!fkShift || !fkShift.length) {
        try { await db.query(`ALTER TABLE user_shift_assignments ADD CONSTRAINT fk_usa_shift FOREIGN KEY (shiftId) REFERENCES shift_definitions(id) ON DELETE RESTRICT`); } catch {}
      }
    } catch {}
  } catch {}
  const [rows] = await db.query(`SELECT COUNT(*) AS c FROM shift_definitions`);
  const c = rows && rows[0] ? Number(rows[0].c) : 0;
  if (c === 0) {
    const defs = [
      { name: 'day_8_17', s: '08:00', e: '17:00', b: 60, w: 'mon-fri-sat' },
      { name: 'day_9_17', s: '09:00', e: '17:00', b: 60, w: 'mon-fri' },
      { name: 'baito_flex', s: '09:00', e: '14:00', b: 0, w: 'flexible' }
    ];
    for (const d of defs) {
      const start = d.s.split(':').map(Number);
      const end = d.e.split(':').map(Number);
      const std = Math.max(0, (end[0]*60+end[1]) - (start[0]*60+start[1]) - d.b);
      await db.query(`
        INSERT INTO shift_definitions (name, start_time, end_time, break_minutes, standard_minutes, working_days)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [d.name, d.s, d.e, d.b, std, d.w]);
    }
  }
}

async function ensureAttendanceTables() {
  await ensureAttendanceSchema();
  await ensureAttendanceDailySchema();
  await ensureAttendanceMonthStatusSchema();
  await ensureWorkDetailsSchema();
  await ensureAttendanceMonthSummarySchema();
  await ensureAttendanceGoOutSchema();
  await ensureShiftTables();
  await ensureAttendancePlanSchema();
  return { ok: true };
}

async function ensureAttendancePlanSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_plan (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      date DATE NOT NULL,
      shiftId BIGINT UNSIGNED NULL,
      work_type VARCHAR(24) NULL,
      location VARCHAR(120) NULL,
      memo VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_date (userId, date),
      INDEX idx_user_date (userId, date),
      CONSTRAINT fk_attendance_plan_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureMonthStatusTable() {
  await ensureAttendanceMonthStatusSchema();
  return { ok: true };
}

async function ensureWorkDetailsSchemaPublic() {
  await ensureWorkDetailsSchema();
  return { ok: true };
}

async function listColumns() {
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'attendance'
    `);
    return (cols || []).map(c => String(c.name));
  } catch {
    return [];
  }
}

async function ensureAttendanceSchemaPublic() {
  await ensureAttendanceSchema();
  return listColumns();
}

module.exports = {
  ensureAttendanceTables,
  ensureAttendancePlanSchema,
  ensureMonthStatusTable,
  ensureWorkDetailsSchemaPublic,
  ensureAttendanceSchemaPublic,
  ensureShiftTables,
  ensureAttendanceDailySchema,
  listColumns
};
