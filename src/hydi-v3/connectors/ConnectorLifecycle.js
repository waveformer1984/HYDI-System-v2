'use strict';

async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelayMs = options.baseDelayMs || 1000;
  const maxDelayMs = options.maxDelayMs || 30000;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function run(connector, startFn, options = {}) {
  connector.state = 'starting';
  try {
    await withRetry(startFn, options);
    if (connector.state !== 'not_configured' && connector.state !== 'configured' && connector.state !== 'error') {
      connector.state = 'running';
      connector.lastError = null;
    }
  } catch (error) {
    connector._setError(error);
  }
}

module.exports = { withRetry, run };
