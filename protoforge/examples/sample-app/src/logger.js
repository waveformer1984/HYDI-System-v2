function createLogger({ level = 'info' } = {}) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const min = levels[level] ?? 1;

  function log(sev, component, event, message, meta = {}) {
    if (levels[sev] < min) return;
    const line = {
      timestamp: new Date().toISOString(),
      level: sev,
      component,
      event,
      message,
      ...meta
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  }

  return {
    debug: (c, e, m, x) => log('debug', c, e, m, x),
    info: (c, e, m, x) => log('info', c, e, m, x),
    warn: (c, e, m, x) => log('warn', c, e, m, x),
    error: (c, e, m, x) => log('error', c, e, m, x)
  };
}

module.exports = { createLogger };
