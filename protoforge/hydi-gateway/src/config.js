const path = require('path');

function loadConfig(env = process.env) {
  if (!env.HYDI_SERVICE_KEY || typeof env.HYDI_SERVICE_KEY !== 'string') {
    throw new Error('HYDI_SERVICE_KEY is required');
  }

  return {
    port: parseInt(env.PORT, 10) || 4000,
    serviceKey: env.HYDI_SERVICE_KEY,
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    outboxDataDir: env.OUTBOX_DIR || path.join(process.cwd(), 'data', 'outbox'),
    retryIntervalMs: parseInt(env.RETRY_INTERVAL_MS, 10) || 5000
  };
}

module.exports = { loadConfig };
