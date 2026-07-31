const path = require('path');

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function boolOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

const defaults = {
  port: 3001,
  dataDir: path.join(__dirname, '..', 'data'),
  dbFile: 'db.json',
  eventLogFile: 'events.json',
  exportDir: path.join(__dirname, '..', 'data', 'exports'),
  backupDir: path.join(__dirname, '..', 'data', 'backups'),
  logLevel: 'info',
  eventTransport: 'memory',
  enableHydiAdapter: false,
  hydiEndpoint: null,
  hydiCapability: 'switchboard.marketplace',
  hydiVersion: '1.0',
  rateLimitWindowMs: 60000,
  rateLimitMax: 100,
  rateLimitLoginMax: 10,
  rateLimitMessageMax: 60,
  rateLimitApplyMax: 30,
  rateLimitApproveMax: 20,
  rateLimitPaymentMax: 20
};

function createConfig(env = process.env) {
  const dataDir = env.SWITCHBOARD_DATA_DIR || defaults.dataDir;
  const dbPath = env.SWITCHBOARD_DB_PATH || path.join(dataDir, env.SWITCHBOARD_DB_FILE || defaults.dbFile);
  const eventLogPath = env.SWITCHBOARD_EVENT_LOG_PATH || path.join(dataDir, env.SWITCHBOARD_EVENT_LOG_FILE || defaults.eventLogFile);

  return {
    port: intOr(env.PORT, defaults.port),
    dataDir,
    dbPath,
    eventLogPath,
    exportDir: env.SWITCHBOARD_EXPORT_DIR || defaults.exportDir,
    backupDir: env.SWITCHBOARD_BACKUP_DIR || defaults.backupDir,
    logLevel: (env.SWITCHBOARD_LOG_LEVEL || defaults.logLevel).toLowerCase(),
    eventTransport: (env.EVENT_TRANSPORT || env.SWITCHBOARD_EVENT_TRANSPORT || defaults.eventTransport).toLowerCase(),
    enableHydiAdapter: boolOr(env.HYDI_ENABLED || env.SWITCHBOARD_ENABLE_HYDI, defaults.enableHydiAdapter),
    hydiEndpoint: (env.HYDI_ENDPOINT || env.SWITCHBOARD_HYDI_ENDPOINT || defaults.hydiEndpoint) || null,
    hydiCapability: env.HYDI_CAPABILITY || env.SWITCHBOARD_HYDI_CAPABILITY || defaults.hydiCapability,
    hydiVersion: env.HYDI_VERSION || env.SWITCHBOARD_HYDI_VERSION || defaults.hydiVersion,
    rateLimit: {
      windowMs: intOr(env.SWITCHBOARD_RATE_WINDOW_MS, defaults.rateLimitWindowMs),
      default: intOr(env.SWITCHBOARD_RATE_DEFAULT_MAX, defaults.rateLimitMax),
      login: intOr(env.SWITCHBOARD_RATE_LOGIN_MAX, defaults.rateLimitLoginMax),
      message: intOr(env.SWITCHBOARD_RATE_MESSAGE_MAX, defaults.rateLimitMessageMax),
      apply: intOr(env.SWITCHBOARD_RATE_APPLY_MAX, defaults.rateLimitApplyMax),
      parentApprove: intOr(env.SWITCHBOARD_RATE_APPROVE_MAX, defaults.rateLimitApproveMax),
      payment: intOr(env.SWITCHBOARD_RATE_PAYMENT_MAX, defaults.rateLimitPaymentMax)
    },
    featureFlags: {
      diagnostics: boolOr(env.SWITCHBOARD_ENABLE_DIAGNOSTICS, true),
      export: boolOr(env.SWITCHBOARD_ENABLE_EXPORT, true),
      sync: boolOr(env.SWITCHBOARD_ENABLE_SYNC, true)
    }
  };
}

module.exports = { createConfig, defaults };
