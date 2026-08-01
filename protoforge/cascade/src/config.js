const path = require('path');

function loadConfig(env = process.env) {
  return {
    port: parseInt(env.PORT, 10) || 4001,
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    table: env.LEDGER_TABLE || 'raw_event_ledger',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
    processorVersion: env.PROCESSOR_VERSION || '1.0'
  };
}

module.exports = { loadConfig };
