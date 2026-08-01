const path = require('path');
const { boolOr, intOr } = require('./validation');

const defaults = {
  port: 3000,
  dataDir: path.join(__dirname, '..', 'data'),
  dbFile: 'db.json',
  eventLogFile: 'events.json',
  logLevel: 'info'
};

function createConfig(env = process.env) {
  const dataDir = env.DATA_DIR || defaults.dataDir;
  const dbPath = env.DB_PATH || path.join(dataDir, env.DB_FILE || defaults.dbFile);
  const eventLogPath = env.EVENT_LOG_PATH || path.join(dataDir, env.EVENT_LOG_FILE || defaults.eventLogFile);
  const hydiGatewayEndpoint = (env.HYDI_GATEWAY_ENDPOINT || '').replace(/\/$/, '');
  const eventTransport = env.EVENT_TRANSPORT || (hydiGatewayEndpoint ? 'external' : 'memory');

  return {
    port: intOr(env.PORT, defaults.port),
    dataDir,
    dbPath,
    eventLogPath,
    protoiyEndpoint: (env.PROTOIY_ENDPOINT || 'http://localhost:5000').replace(/\/$/, ''),
    hydiGatewayEndpoint,
    hydiServiceKey: env.HYDI_SERVICE_KEY,
    eventTransport,
    logLevel: (env.LOG_LEVEL || defaults.logLevel).toLowerCase(),
    featureFlags: {
      diagnostics: boolOr(env.ENABLE_DIAGNOSTICS, true),
      export: boolOr(env.ENABLE_EXPORT, true)
    }
  };
}

module.exports = { createConfig, defaults };
