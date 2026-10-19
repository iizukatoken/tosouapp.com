// File khởi chạy máy chủ (Server Entry Point)
// Chứa cấu hình Port và các tính năng chạy ngầm (Cron Jobs)

// Initialize error monitoring
const errorReporter = require('./core/errorReporter');
errorReporter.init();

// Auto Database Backup Cron - Tự động sao lưu dữ liệu MySQL
const { initBackupCronJob } = require('./cron/dbBackupCron');

// Health Monitor - Built-in uptime check + Discord/Slack alert
const { initHealthMonitor } = require('./cron/healthMonitorCron');

const app = require('./app');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const disableSchedulers = String(process.env.DISABLE_SCHEDULERS || '').toLowerCase() === 'true';

// Hàm tự động cấp phép ngày nghỉ (Leave Grants) cho nhân viên
function initAutoGrantScheduler() {
  try {
    const userRepo = require('./modules/users/user.repository');
    const { ensureUserGrants } = require('./modules/leave/leave.controller');
    let lastRunDay = null;
    let running = false; // Chống chạy đồng thời nhiều lần

    // Trì hoãn khởi chạy lần đầu 60 giây sau khi server start,
    // để tránh gây spike DB ngay khi vừa boot lên.
    const STARTUP_DELAY_MS = 60 * 1000;
    // Độ trễ giữa mỗi user trong batch để tránh flood DB connection pool.
    const BETWEEN_USERS_DELAY_MS = 50;
    // Chỉ xử lý nhân viên active, tránh load toàn bộ bảng users.
    const AUTO_GRANT_BATCH_SIZE = Number(process.env.AUTO_GRANT_BATCH_SIZE || '0') || 0;

    async function run() {
      if (running) {
        console.log('[auto-grant] Đang chạy, bỏ qua lần trigger này.');
        return;
      }
      running = true;
      try {
        // Chỉ lấy nhân viên active thay vì SELECT * FROM users không giới hạn
        const { rows: users } = await userRepo.listUsersPaged({
          role: 'employee',
          employmentStatus: 'active',
          limit: AUTO_GRANT_BATCH_SIZE > 0 ? AUTO_GRANT_BATCH_SIZE : 5000,
        });
        let processed = 0;
        for (const u of users) {
          try { await ensureUserGrants(u.id); } catch (e) { /* silently ignored */ }
          processed++;
          // Yield giữa mỗi user để tránh chiếm hết connection pool
          if (BETWEEN_USERS_DELAY_MS > 0 && processed % 10 === 0) {
            await new Promise(r => setTimeout(r, BETWEEN_USERS_DELAY_MS));
          }
        }
        lastRunDay = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        console.log(`[auto-grant] completed for day ${lastRunDay} (${processed} users)`);
      } catch (err) {
        console.error('[auto-grant] error', err && err.message);
      } finally {
        running = false;
      }
    }

    // Trì hoãn lần chạy đầu tiên để tránh spike khi server vừa khởi động
    setTimeout(() => {
      run();
    }, STARTUP_DELAY_MS);

    setInterval(() => {
      const jst = new Date(Date.now() + 9 * 3600 * 1000);
      const day = jst.toISOString().slice(0, 10);
      const hour = jst.getUTCHours();
      if (lastRunDay !== day && hour >= 3 && hour < 4) {
        run();
      }
    }, 15 * 60 * 1000);
  } catch (e) {
    console.error('[auto-grant] init error', e && e.message);
  }
}

function initShiftReminders() {
  try {
    const shiftReminder = require('./services/shiftReminder.service');
    shiftReminder.init();

    const { initShiftSubmissionReminderCron } = require('./cron/shiftSubmissionReminderCron');
    initShiftSubmissionReminderCron();
  } catch (e) {
    console.error('[ShiftReminder] init error', e && e.message);
  }
}

async function start() {
  try {
    await require('./core/bootstrap').init();
    const server = app.listen(PORT, HOST, () => {
      const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
      console.log(`Server is running at http://${shownHost}:${PORT} (bind ${HOST})`);
    });
    if (!disableSchedulers) {
      initAutoGrantScheduler();
      initShiftReminders(); // Nhắc nộp lịch ca + nhắc quên chấm công (email, theo từng công ty)
    }

    // Initialize backup cron job - Tự động sao lưu Database (chỉ chạy trên Production)
    if (process.env.NODE_ENV === 'production') {
        initBackupCronJob();
    }

    // Kiểm tra dữ liệu trùng hằng tuần, gửi email khi có (chỉ đọc, chỉ production)
    if (process.env.NODE_ENV === 'production' && !disableSchedulers) {
      try {
        require('./cron/duplicateCheckCron').initDuplicateCheckCron();
      } catch (e) {
        console.error('[DuplicateCheck] init error', e && e.message);
      }
    }

    // Initialize health monitor (all environments except test)
    initHealthMonitor();

    // Plan expiry checker — suspend tenants with expired plans, send 7-day warnings
    try {
      const { initPlanExpiryCheckerCron } = require('./cron/planExpiryCheckerCron');
      initPlanExpiryCheckerCron();
    } catch (e) {
      console.error('[PlanExpiryCron] init error', e && e.message);
    }

    // Graceful shutdown — finish in-flight requests before stopping
    const shutdown = (signal) => {
      console.log(`${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        console.log('HTTP server closed.');
        try {
          const db = require('./core/database/mysql');
          await db.end();
          console.log('DB pool closed.');
        } catch (e) { /* silently ignored */ }
        process.exit(0);
      });
      // Force exit after 10s if connections won't close
      setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (e) {
    try { console.error('bootstrap_error', e && e.message ? e.message : e); } catch (e) { /* silently ignored */ }
    process.exit(1);
  }
}

void start();

