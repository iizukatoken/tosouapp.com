function parseOrigins(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Default allowed origins. localhost は開発用なので本番（NODE_ENV=production）では許可しない
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000'
];
const DEFAULT_ORIGINS = [
  'https://tosouapp.com',
  'https://www.tosouapp.com',
  ...(process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS)
];

function cors() {
  const envOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);
  const allowed = new Set([...DEFAULT_ORIGINS, ...envOrigins]);

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (origin) {
      // Unknown origin — do NOT set Access-Control-Allow-Origin
      // Browser will block the request automatically
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Request-ID');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight 24h

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

module.exports = { cors };
