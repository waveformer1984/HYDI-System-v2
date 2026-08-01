const path = require('path');

function loadConfig(env = process.env) {
  if (!env.HYDI_SERVICE_KEY || typeof env.HYDI_SERVICE_KEY !== 'string') {
    throw new Error('HYDI_SERVICE_KEY is required');
  }

  const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  const ledgerFile = env.LEDGER_FILE || 'events.json';

  return {
    port: parseInt(env.PORT, 10) || 4000,
    serviceKey: env.HYDI_SERVICE_KEY,
    dataDir,
    ledgerFile,
    ledgerPath: path.join(dataDir, ledgerFile)
  };
}

module.exports = { loadConfig };
