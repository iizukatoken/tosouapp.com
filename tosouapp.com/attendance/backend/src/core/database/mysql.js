const mysql = require('mysql2/promise');
require('../../config/loadEnv');
// Khởi tạo pool kết nối MySQL dùng mysql2 (promise)

const sslEnabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';
const sslStrict = String(process.env.DB_SSL_STRICT || '').toLowerCase() === 'true';
const _connLimit = parseInt(process.env.DB_CONN_LIMIT || '20', 10);
// Default queue limit to 2× connection limit — prevents unbounded memory growth
// from request bursts. Set DB_QUEUE_LIMIT=0 to disable (not recommended).
const _queueLimit = parseInt(process.env.DB_QUEUE_LIMIT || String(_connLimit * 2), 10);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: _connLimit,
  queueLimit: _queueLimit,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '10000', 10),
  dateStrings: true,
  charset: 'utf8mb4',
  timezone: '+09:00',
  ssl: sslEnabled ? (sslStrict ? { rejectUnauthorized: true } : {}) : undefined
});

// Kiểm tra kết nối DB khi khởi động server (bỏ qua khi NODE_ENV=test để tránh log async trong môi trường test)
if (String(process.env.NODE_ENV || '').toLowerCase() !== 'test') {
  (async () => {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      console.log('✅ Kết nối MySQL thành công!');
      connection.release();
    } catch (err) {
      console.error('❌ Kết nối MySQL thất bại:', err.message);
      console.error('Kiểm tra biến môi trường DB_HOST/DB_USER/DB_PASS/DB_NAME');
    }
  })();
  
  // Keep-alive mechanism to prevent ETIMEDOUT on idle connections
  setInterval(async () => {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
    } catch (err) {
      console.error('[MySQL Keep-alive] Ping failed:', err.message);
    }
  }, 60000); // Ping every 1 minute
}

const origPoolQuery = pool.query.bind(pool);
pool.query = async function(...args) {
  const t0 = Date.now();
  const res = await origPoolQuery(...args);
  const dur = Date.now() - t0;
  if (dur > 200) {
    try {
      console.warn(JSON.stringify({ level: 'warn', type: 'slow_query', duration_ms: dur }));
      try { require('../metrics').inc('slow_query_count', 1); } catch (e) { /* silently ignored */ }
    } catch (e) { /* silently ignored */ }
  }
  return res;
};
const origGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async function() {
  const conn = await origGetConnection();
  // Biến session (charset/collation/time_zone) tồn tại suốt đời kết nối vật lý, nên chỉ cần SET
  // lần đầu. Trước đây chạy 3 câu SET nối tiếp MỖI lần getConnection → thêm ~3 round-trip
  // (~0.3s vì DB ở xa) cho mỗi transaction (確定/保存...). Giờ gộp 1 câu và chỉ chạy 1 lần / kết nối.
  const core = conn.connection || conn;
  if (!core.__sessionInit) {
    try {
      await conn.query(`SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci, time_zone = '+09:00'`);
      core.__sessionInit = true;
    } catch (e) {
      // MySQL cũ không có utf8mb4_0900_ai_ci → chạy từng câu như trước
      try {
        await conn.query(`SET NAMES utf8mb4`);
        try { await conn.query(`SET collation_connection = utf8mb4_0900_ai_ci`); } catch (e2) { /* silently ignored */ }
        try { await conn.query(`SET time_zone = '+09:00'`); } catch (e2) { /* silently ignored */ }
        core.__sessionInit = true;
      } catch (e2) { /* silently ignored */ }
    }
  }
  const origConnQuery = conn.query.bind(conn);
  conn.query = async function(...args) {
    const t0 = Date.now();
    const res = await origConnQuery(...args);
    const dur = Date.now() - t0;
    if (dur > 200) {
      try {
        console.warn(JSON.stringify({ level: 'warn', type: 'slow_query', duration_ms: dur }));
        try { require('../metrics').inc('slow_query_count', 1); } catch (e) { /* silently ignored */ }
      } catch (e) { /* silently ignored */ }
    }
    return res;
  };
  return conn;
};

/**
 * Get pool stats for monitoring
 */
pool.getPoolStats = () => {
  const p = pool.pool;
  const queueLen = p?._connectionQueue?.length || 0;
  const stats = {
    totalConnections: p?._allConnections?.length || 0,
    freeConnections: p?._freeConnections?.length || 0,
    activeConnections: (p?._allConnections?.length || 0) - (p?._freeConnections?.length || 0),
    queuedRequests: queueLen,
    connectionLimit: _connLimit,
    queueLimit: _queueLimit,
  };
  // Warn when queue exceeds 50% of queue limit — noisy-neighbor early signal
  if (_queueLimit > 0 && queueLen > _queueLimit * 0.5) {
    console.warn(JSON.stringify({
      level: 'warn',
      type: 'db_pool_queue_high',
      queuedRequests: queueLen,
      queueLimit: _queueLimit,
      pct: Math.round((queueLen / _queueLimit) * 100),
    }));
  }
  return stats;
};

// Periodic pool health check — logs warning when connections are under pressure
if (String(process.env.NODE_ENV || '').toLowerCase() !== 'test') {
  setInterval(() => {
    pool.getPoolStats(); // triggers warn log if queue is high
  }, 30000);
}

module.exports = pool;
