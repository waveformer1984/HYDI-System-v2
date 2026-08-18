const { createConfig } = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(config) {
  const cfg = config || createConfig();
  const minLevel = LEVELS[cfg.logLevel] ?? LEVELS.info;

  function log(level, component, event, message, meta = {}) {
    const levelNum = LEVELS[level] ?? LEVELS.info;
    if (levelNum < minLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      event,
      message,
      ...meta
    };
    if (cfg.requestId) entry.requestId = cfg.requestId;
    // Node stdout; could be swapped for file or external stream later
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  return {
    debug: (component, event, message, meta) => log('debug', component, event, message, meta),
    info: (component, event, message, meta) => log('info', component, event, message, meta),
    warn: (component, event, message, meta) => log('warn', component, event, message, meta),
    error: (component, event, message, meta) => log('error', component, event, message, meta)
  };
}

module.exports = { createLogger };
