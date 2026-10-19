/**
 * Error Reporter
 * Lightweight error monitoring without external dependencies.
 * 
 * Features:
 * - Captures unhandled errors and rejections
 * - Deduplicates errors (same error won't spam)
 * - Sends to webhook URL if configured (Discord/Slack compatible)
 * - Falls back to structured logging if no webhook
 * 
 * Setup:
 *   Set env: ERROR_WEBHOOK_URL=https://discord.com/api/webhooks/... (optional)
 *   Call: require('./core/errorReporter').init()
 */

const log = require('./logger');
const { trackError } = require('./alerting');

const WEBHOOK_URL = process.env.ERROR_WEBHOOK_URL || '';
const APP_NAME = process.env.COMPANY_NAME || 'tosouapp';
const ENV = process.env.NODE_ENV || 'development';

// Dedup: track recent errors to avoid spam
const recentErrors = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function errorFingerprint(err) {
  const msg = String(err?.message || err || '').slice(0, 100);
  const stack = String(err?.stack || '').split('\n')[1] || '';
  return `${msg}::${stack.trim()}`;
}

function isDuplicate(fingerprint) {
  const now = Date.now();
  const last = recentErrors.get(fingerprint);
  if (last && (now - last) < DEDUP_WINDOW_MS) return true;
  recentErrors.set(fingerprint, now);
  // Cleanup old entries
  if (recentErrors.size > 200) {
    for (const [k, v] of recentErrors) {
      if (now - v > DEDUP_WINDOW_MS) recentErrors.delete(k);
    }
  }
  return false;
}

// Giới hạn tổng số tin gửi webhook (khi có sự cố lớn, nhiều lỗi khác nhau cùng lúc → không spam)
const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 30;
let sendWindowStart = 0;
let sendsInWindow = 0;
let droppedInWindow = 0;

function allowSend() {
  const now = Date.now();
  if (now - sendWindowStart > SEND_WINDOW_MS) {
    if (droppedInWindow > 0) log.warn('Error webhook: alerts dropped by rate limit', { dropped: droppedInWindow });
    sendWindowStart = now;
    sendsInWindow = 0;
    droppedInWindow = 0;
  }
  if (sendsInWindow >= MAX_SENDS_PER_WINDOW) {
    droppedInWindow++;
    return false;
  }
  sendsInWindow++;
  return true;
}

async function sendWebhook(payload) {
  if (!WEBHOOK_URL) return;
  if (!allowSend()) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Don't let webhook failure crash the app
    log.warn('Error webhook send failed', { error_message: e.message });
  }
}

function formatForWebhook(level, message, meta = {}) {
  const emoji = level === 'fatal' ? '🔴' : level === 'error' ? '🟠' : '⚠️';
  const content = [
    `${emoji} **[${APP_NAME}] [${ENV}] ${level.toUpperCase()}**`,
    `**Message:** ${String(message).slice(0, 500)}`,
    meta.path ? `**Path:** ${meta.method || 'GET'} ${meta.path}` : '',
    meta.user_id ? `**User:** ${meta.user_id}` : '',
    meta.request_id ? `**Request:** ${meta.request_id}` : '',
    meta.stack ? `\`\`\`\n${String(meta.stack).slice(0, 800)}\n\`\`\`` : '',
    `**Time:** ${new Date().toISOString()}`
  ].filter(Boolean).join('\n');

  // Discord webhook format
  return { content: content.slice(0, 1900) };
}

function report(err, meta = {}) {
  const fingerprint = errorFingerprint(err);
  if (isDuplicate(fingerprint)) return;

  const errorMeta = {
    error_message: err?.message || String(err),
    stack: err?.stack,
    ...meta
  };

  try {
    trackError(meta.type || 'error_reporter', err || errorMeta);
  } catch (e) {
    // swallow
  }

  log.error('REPORTED: ' + (err?.message || String(err)), errorMeta);

  if (WEBHOOK_URL) {
    sendWebhook(formatForWebhook('error', err?.message || String(err), errorMeta));
  }
}

function init() {
  // Catch unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    report(err, { type: 'unhandled_rejection' });
  });

  // Catch uncaught exceptions (log but don't crash immediately)
  process.on('uncaughtException', (err) => {
    report(err, { type: 'uncaught_exception' });
    // Give time to send webhook before exit
    setTimeout(() => process.exit(1), 3000);
  });

  log.info('Error reporter initialized', { webhook: WEBHOOK_URL ? 'configured' : 'disabled', env: ENV });
}

/**
 * Dùng thay cho `catch (e) { /* silently ignored *\/ }` ở các chỗ quan trọng (ghi chấm công, duyệt đơn,
 * lương, gửi mail/thông báo): xử lý chính vẫn chạy tiếp như cũ, nhưng lỗi được ghi log + báo cho quản trị.
 * @param {string} context  vị trí / việc đang làm, vd 'adjust.approve.markDirty'
 * @param {unknown} err
 * @param {object} [meta]
 */
function reportSwallowed(context, err, meta = {}) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    report(e, { type: 'swallowed', context, ...meta });
  } catch (e2) { /* báo lỗi không được làm hỏng xử lý chính */ }
}

module.exports = { init, report, reportSwallowed };
