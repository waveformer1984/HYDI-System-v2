'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getExecutionFabricSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

module.exports = { getExecutionFabricSupabase };
