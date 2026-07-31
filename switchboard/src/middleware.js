const crypto = require('crypto');
const { RateLimitError } = require('./errors');

function requestIdMiddleware(req, res, next) {
  req.requestId = req.get('X-Request-Id') || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function createRateLimiter(config) {
  const limits = new Map();
  const { windowMs } = config.rateLimit;

  function check(key, max) {
    const now = Date.now();
    const record = limits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count += 1;
    limits.set(key, record);
    return record.count <= max;
  }

  function limitForRoute(req) {
    const route = req.path;
    if (route === '/auth/login') return config.rateLimit.login;
    if (route.startsWith('/messages')) return config.rateLimit.message;
    if (route.includes('/apply')) return config.rateLimit.apply;
    if (route.includes('/parent-approve')) return config.rateLimit.parentApprove;
    if (route.startsWith('/payments')) return config.rateLimit.payment;
    return config.rateLimit.default;
  }

  return (req, res, next) => {
    const key = `${req.ip || 'global'}:${req.path}`;
    const max = limitForRoute(req);
    if (!check(key, max)) return next(new RateLimitError());
    next();
  };
}

function errorHandler(logger) {
  return (err, req, res, next) => {
    const status = err.status || 500;
    const code = err.code || 'InternalError';
    const message = status === 500 ? 'Internal server error' : err.message;
    const field = err.field || undefined;

    logger.error('api', 'request_failed', err.message, {
      requestId: req.requestId,
      path: req.path,
      status,
      code,
      stack: status === 500 ? err.stack : undefined
    });

    res.status(status).json({ error: code, message, field, requestId: req.requestId });
  };
}

module.exports = { requestIdMiddleware, createRateLimiter, errorHandler };
