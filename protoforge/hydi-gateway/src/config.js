function loadConfig(env = process.env) {
  if (!env.HYDI_SERVICE_KEY || typeof env.HYDI_SERVICE_KEY !== 'string') {
    throw new Error('HYDI_SERVICE_KEY is required');
  }

  return {
    port: parseInt(env.PORT, 10) || 4000,
    serviceKey: env.HYDI_SERVICE_KEY,
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined
  };
}

module.exports = { loadConfig };
