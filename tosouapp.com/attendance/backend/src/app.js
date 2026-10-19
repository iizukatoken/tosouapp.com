// File này cấu hình toàn bộ ứng dụng Express (Middleware, Routes, Security, File tĩnh)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
require('./config/loadEnv'); // Tải các biến môi trường từ file .env
const express = require('express');

// Khởi chạy Background Workers (Chỉ chạy chung process khi ở môi trường Development để tiện test)
// Trên Production, nên set DISABLE_EMBEDDED_WORKER=true và chạy src/workers/index.js bằng lệnh riêng.
if (process.env.NODE_ENV !== 'production' && String(process.env.DISABLE_EMBEDDED_WORKER || '').toLowerCase() !== 'true') {
  require('./workers/index');
}

const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { cors } = require('./core/middleware/cors'); // Cấu hình CORS (Cho phép domain nào được truy cập)
const cookieParser = require('cookie-parser');
const security = require('./core/middleware/security'); // Cấu hình bảo mật

const app = express();

// Hàm lấy ID của bản build hiện tại (dùng để quản lý version cache)
function resolveBuildId() {
  const explicit = String(process.env.BUILD_ID || process.env.APP_BUILD_ID || process.env.GIT_COMMIT || '').trim();
  if (explicit) return explicit;
  try {
    const sha = String(execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
    if (sha) return `git-${sha}`;
  } catch (e) { /* silently ignored */ }
  return `runtime-${Date.now()}`;
}
const BUILD_ID = resolveBuildId();
const STARTED_AT = Date.now();
process.env.BUILD_ID = BUILD_ID;
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));
app.use(express.json());
app.use(cookieParser());
app.use(cors());

// Input sanitization — strip XSS from all request bodies/queries
const { sanitizeInput } = require('./core/middleware/sanitize');
app.use(sanitizeInput());

security(app);

// Global rate limiting — 100 requests per minute per IP for API
// Individual endpoints have stricter limits (login: 20/min, forgot-password: 10/min)
const { rateLimit } = require('./core/middleware/rateLimit');
app.use('/api', rateLimit({ 
  windowMs: 60_000, 
  max: 100, 
  keyBy: 'ip',
  message: 'Quá nhiều request, vui lòng thử lại sau.' 
}));

// Phản hồi ảnh favicon mặc định (hoặc icon SVG tự sinh) để tránh lỗi 404
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1e3a8a"/><text x="50" y="65" font-family="Arial" font-size="50" font-weight="bold" fill="white" text-anchor="middle">T</text></svg>');
});

app.use((req, res, next) => {
  try {
    const forceDisableCanonical = ['1', 'true', 'yes', 'on'].includes(String(process.env.DISABLE_CANONICAL_HOST || '').toLowerCase());
    if (forceDisableCanonical) return next();
    const enforceCanonical = String(process.env.ENFORCE_CANONICAL_HOST || 'true').toLowerCase() === 'true';
    const inProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (!enforceCanonical || !inProd) return next();

    const canonicalHost = String(process.env.CANONICAL_HOST || 'tosouapp.com').trim().toLowerCase();
    if (!canonicalHost) return next();

    const directHostRaw = String(req.headers.host || '').split(',')[0].trim();
    const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const directHost = directHostRaw.split(':')[0].toLowerCase();
    const forwardedHost = forwardedHostRaw.split(':')[0].toLowerCase();
    // On local development, some tools/extensions may inject x-forwarded-host.
    // Prefer direct Host header when it points to localhost.
    const host = (directHost === 'localhost' || directHost === '127.0.0.1' || directHost === '::1' || directHost.endsWith('.local'))
      ? directHost
      : (forwardedHost || directHost);
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
    if (isLocalHost) return next();
    if (!host || host === canonicalHost) return next();

    // Keep health checks and APIs unaffected.
    if (req.path === '/ping' || req.path === '/healthz' || String(req.path || '').startsWith('/api/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const target = `https://${canonicalHost}${req.originalUrl || req.url || '/'}`;
    try {
      console.warn(`[canonical] redirect host=${host} direct=${directHost} forwarded=${forwardedHost} enforce=${enforceCanonical} inProd=${inProd} -> ${target}`);
    } catch (e) { /* silently ignored */ }
    return res.redirect(308, target);
  } catch (e) { /* silently ignored */ }
  return next();
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'static', 'html'));

// Inject tenant info into every page render (logo, name, color)
// Falls back to 飯塚塗研 defaults when ENABLE_MULTI_TENANT=false
const { injectTenantLocals } = require('./core/middleware/tenantMiddleware');
app.use(injectTenantLocals);

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  // Generate CSP nonce for inline scripts
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('X-Request-ID', req.id);
  res.setHeader('X-Build-Id', BUILD_ID);
  res.setHeader('X-Started-At', String(STARTED_AT));
  res.setHeader('X-Process-Id', String(process.pid));
  res.locals.appVersion = BUILD_ID;
  next();
});

// Structured logger middleware
const log = require('./core/logger');
const { trackRequest, trackError } = require('./core/alerting');
app.use(log.middleware());
// Mọi response 5xx (kể cả route tự bắt lỗi rồi trả 500) → báo cho quản trị qua errorReporter
app.use(require('./core/middleware/reportServerErrors'));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    trackRequest(req, res, start);
    if (ms > 500) {
      log.warn('Slow request', { request_id: req.id, method: req.method, path: req.path, duration_ms: Math.round(ms), status: res.statusCode });
    }
  });
  next();
});
app.use((req, res, next) => {
  // Security headers (single source of truth — security.js only handles CSRF)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (String(req.path || '').startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    const p = String(req.path || '');
    const accept = String(req.headers.accept || '');
    const wantsHtml = accept.includes('text/html') || accept.includes('*/*');
    const isHtmlRoute = p === '/' || p.startsWith('/admin') || p.startsWith('/ui') || p.endsWith('.html');
    if (req.method === 'GET' && wantsHtml && isHtmlRoute) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
  // Cấu hình CSP để cho phép CDN bên ngoài (ví dụ lunar.js)
  const nonce = res.locals.cspNonce || '';
  const cspItems = [
    process.env.CSP_DEFAULT_SRC || "default-src 'self'",
    process.env.CSP_IMG_SRC || "img-src 'self' data: https:",
    process.env.CSP_STYLE_SRC || "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    // SECURITY: 'unsafe-eval' removed — it weakens CSP XSS protection.
    // If a library requires eval(), use a nonce or hash, or replace the library.
    // Set CSP_SCRIPT_SRC env variable to override if absolutely needed.
    process.env.CSP_SCRIPT_SRC || `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    process.env.CSP_FONT_SRC || "font-src 'self' https://fonts.gstatic.com data:",
    process.env.CSP_OBJECT_SRC || "object-src 'none'",
    process.env.CSP_FRAME_ANCESTORS || "frame-ancestors 'self'",
    process.env.CSP_CONNECT_SRC || "connect-src 'self' https://*",
    process.env.CSP_BASE_URI || "base-uri 'self'",
    process.env.CSP_FORM_ACTION || "form-action 'self'",
    process.env.CSP_FRAME_SRC || "frame-src 'self'"
  ];
  const csp = cspItems.join('; ');
  const cspHeader = String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === 'true'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  res.setHeader(cspHeader, csp);
  const isHttps = req.secure || (req.headers['x-forwarded-proto'] || '').includes('https');
  // SECURITY: HSTS is ON by default when the connection is HTTPS.
  // Set DISABLE_HSTS=true to opt out (e.g. for local dev behind HTTP proxy).
  const disableHsts = String(process.env.DISABLE_HSTS || '').toLowerCase() === 'true';
  if (isHttps && !disableHsts) {
    res.setHeader('Strict-Transport-Security', process.env.HSTS_VALUE || 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'iizuka.it.com Attendance API',
    version: '1.0.0',
    description: 'API documentation for the Attendance System',
  },
  servers: [
    {
      url: 'https://tosouapp.com',
      description: 'Production server',
    },
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: ['./src/swagger-docs.js', './src/routes/*.js', './src/modules/**/*.routes.js'],
};

const swaggerSpec = swaggerJsdoc(options);
if (process.env.NODE_ENV !== 'production') {
  const devCsp = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://*",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self'"
  ].join('; ');
  const devCspHeader = String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === 'true'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  app.use('/api-docs', (req, res, next) => { res.setHeader(devCspHeader, devCsp); next(); }, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

const routes = require('./routes');
routes(app);
const uiRoutes = require('./routes/ui.routes');
app.use('/', uiRoutes);
const { registerHealthRoutes } = require('./core/health');
const db = require('./core/database/mysql');
const redis = require('./core/database/redis');
registerHealthRoutes(app, { db, redis });
const { authenticate, authorize } = require('./core/middleware/authMiddleware');

// SECURITY: version info (buildId, pid) is restricted to authenticated admins only.
app.get('/api/version', authenticate, authorize('admin'), (req, res) => {
  res.status(200).json({ buildId: BUILD_ID, startedAt: STARTED_AT, pid: process.pid });
});
app.get('/version', authenticate, authorize('admin'), (req, res) => {
  res.status(200).json({ buildId: BUILD_ID, startedAt: STARTED_AT, pid: process.pid });
});
app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true });
});

// SECURITY: DB pool stats expose internal metrics — admin only.
app.get('/health/db', authenticate, authorize('admin'), (req, res) => {
  try {
    const db = require('./core/database/mysql');
    const stats = db.getPoolStats();
    const healthy = stats.queuedRequests < 10 && stats.activeConnections < stats.connectionLimit * 0.8;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'warning',
      ...stats,
      utilization: Math.round((stats.activeConnections / stats.connectionLimit) * 100) + '%'
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// Log mounted routes at startup to verify availability
try {
  const stack = (app._router?.stack || []);
  const list = [];
  for (const layer of stack) {
    if (layer.route) {
      list.push({ path: layer.route.path, methods: Object.keys(layer.route.methods || {}) });
    } else if (layer?.name === 'router' && layer?.handle?.stack) {
      const base = layer?.regexp?.fast_star ? '' : (layer?.regexp?.source || '').replace('^\\', '').replace('\\/?(?=\\/|$)', '');
      for (const l2 of layer.handle.stack) {
        if (l2.route) {
          list.push({ path: (base || '') + l2.route.path, methods: Object.keys(l2.route.methods || {}) });
        }
      }
    }
  }
  console.log(JSON.stringify({ mounted_routes: list }, null, 2));
} catch (e) {
  console.warn('Route listing failed: ' + (e?.message || String(e)));
}
// Block ALL public access to /uploads (payslips, DB backups, employee documents,
// avatars/profile photos, expense receipts, ...). Filenames under this directory
// are either predictable (tosouapp_backup_<timestamp>.sql) or only obscured by a
// timestamp+random suffix (see core/middleware/upload.js) — obscurity is not real
// access control. Anyone who ever sees a link (screenshot, log, shared URL) could
// otherwise fetch it forever with no login and no tenant check. Every file type
// under /uploads has its own authenticated, tenant-scoped download route instead:
//   - payslips            → secureUrl endpoints
//   - documents           → GET /api/employee/documents/:id/download
//   - avatars             → GET /api/admin/employees/:id/avatar/download
//   - employee photos     → GET /api/admin|manager/employees/photos/:photoId/download
//   - expense receipts    → GET /api/expenses/files/:fileId/download
app.use('/uploads', (req, res) => {
  res.status(403).json({ message: 'Use the authenticated download endpoints instead of static /uploads' });
});

// PDF.js ビューア専用の CSP 上書き（このサブツリー限定で緩和）。
// PDF.js は Web Worker / WASM を使用するため、worker-src(blob) と wasm-unsafe-eval を許可する。
// 影響範囲は /static/vendor/pdfjs/ 配下のみで、アプリ全体の CSP は厳格なまま維持する。
app.use('/static/vendor/pdfjs', (req, res, next) => {
  const nonce = res.locals.cspNonce || '';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'"
  ].join('; '));
  next();
});

app.use('/static', express.static(path.join(__dirname, 'static'), {
  setHeaders: (res, p) => {
    const ext = String(p || '').toLowerCase();
    const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
    const isScriptOrStyle = ext.endsWith('.js') || ext.endsWith('.css');
    const isImageAsset = ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.gif') || ext.endsWith('.webp') || ext.endsWith('.svg') || ext.endsWith('.ico');
    const isFont = ext.endsWith('.woff') || ext.endsWith('.woff2') || ext.endsWith('.ttf');
    if (isScriptOrStyle) {
      if (isDev) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      }
    } else if (isImageAsset || isFont) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));
app.get('/static/css/base.css', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'css', 'base.css')); });
app.get('/static/js/pages/login.page.js', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'js', 'pages', 'login.page.js')); });
app.get('/static/js/api/auth.api.js', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'js', 'api', 'auth.api.js')); });
app.get('/static/css/login.css', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'css', 'login.css')); });
app.get('/static/js/pages/dashboard.page.js', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'js', 'pages', 'dashboard.page.js')); });
app.get('/static/css/portal.css', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'css', 'portal.css')); });
app.get('/static/js/pages/portal.page.js', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'js', 'pages', 'portal.page.js')); });
app.get('/static/js/pages/portal.debug.js', (req, res) => { res.sendFile(path.join(__dirname, 'static', 'js', 'pages', 'portal.debug.js')); });
app.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Sitemap: https://tosouapp.com/sitemap.xml'
    ].join('\n')
  );
});
app.get('/sitemap.xml', (req, res) => {
  const now = new Date().toISOString();
  const urls = [
    'https://tosouapp.com/',
    'https://tosouapp.com/ui/login',
    'https://tosouapp.com/ui/portal'
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => [
      '<url>',
      `<loc>${u}</loc>`,
      `<lastmod>${now}</lastmod>`,
      '<changefreq>daily</changefreq>',
      '<priority>0.8</priority>',
      '</url>'
    ].join('')),
    '</urlset>'
  ].join('');
  res.type('application/xml; charset=utf-8');
  res.send(xml);
});
app.get('/api/metrics', authenticate, authorize('admin'), (req, res) => {
  try {
    const m = require('./core/metrics').snapshot();
    res.status(200).json(m);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const notFound = require('./core/middleware/notFoundHandler');
app.use(notFound);

const errorHandler = require('./core/middleware/errorHandler');
app.use(errorHandler);

module.exports = app;

