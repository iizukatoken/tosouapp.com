const log = require('../logger');
const { report } = require('../errorReporter');

function errorHandler(err, req, res, next) {
  log.error('Unhandled error', {
    request_id: req?.id,
    user_id: req?.user?.id,
    method: req?.method,
    path: req?.path,
    error: err
  });

  // Report to webhook (if configured)
  report(err, { request_id: req?.id, user_id: req?.user?.id, method: req?.method, path: req?.path });
  // reportServerErrors (bọc res.json) không báo lại lần nữa
  if (res.locals) res.locals.errorReported = true;

  const status = Number(err?.status || 500);
  const code = status >= 400 && status < 600 ? status : 500;
  res.status(code).json({ message: code === 500 ? 'Internal Server Error' : (err?.message || 'Error') });
}

module.exports = errorHandler;
