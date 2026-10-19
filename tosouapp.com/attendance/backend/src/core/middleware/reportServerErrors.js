// Báo lỗi cho quản trị mỗi khi API trả về 5xx.
// Hầu hết route tự bắt lỗi rồi trả `res.status(500).json({ message })` (~390 chỗ) mà không đi qua
// errorHandler, nên trước đây người dùng thấy lỗi nhưng không ai được báo. Middleware này bọc res.json
// một lần cho mọi route, gửi qua errorReporter (log + webhook, chống spam 5 phút / cùng lỗi).
const { report } = require('../errorReporter');

function reportServerErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode >= 500 && !res.locals.errorReported) {
        res.locals.errorReported = true;
        const message = String((body && (body.message || body.error)) || `HTTP ${res.statusCode}`);
        // Mỗi (đường dẫn, nội dung lỗi) là một lỗi riêng để chống spam theo từng chỗ.
        const err = new Error(`${req.method} ${req.baseUrl || ''}${req.path} → ${res.statusCode}: ${message}`);
        err.stack = `${err.message}\n    at ${req.method} ${req.baseUrl || ''}${req.path}`;
        report(err, {
          type: 'http_5xx',
          status: res.statusCode,
          method: req.method,
          path: `${req.baseUrl || ''}${req.path}`,
          user_id: req.user?.id,
          tenant_id: req.tenantId,
          request_id: req.id,
        });
      }
    } catch (e) { /* báo lỗi không được làm hỏng response */ }
    return originalJson(body);
  };
  next();
}

module.exports = reportServerErrors;
