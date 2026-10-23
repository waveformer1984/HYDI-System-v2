/**
 * Canonical server-side Supabase client factory.
 *
 * HYDI_PERSISTENCE_MODE:
 *   local  -> use local Supabase (default)
 *   cloud  -> use the configured cloud Supabase
 *   auto   -> try local first, then cloud
 *
 * Local and cloud credentials are supplied via distinct environment keys so that
 * .env.local does not need to overwrite the base values. Fallback sets ensure
 * legacy `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` continue to work.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Node < 22 has no global WebSocket; supabase-js realtime requires one.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

function loadEnvFiles() {
  const root = path.join(__dirname, '..', '..');
  for (const dotenv of [path.join(root, '.env.local'), path.join(root, '.env')]) {
    if (fs.existsSync(dotenv)) {
      const lines = fs.readFileSync(dotenv, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('#') || !line.includes('=')) continue;
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFiles();

const PERSISTENCE_MODES = new Set(['local']);

function getPersistenceMode() {
  const mode = (process.env.HYDI_PERSISTENCE_MODE || 'local').toLowerCase();
  if (mode !== 'local') {
    console.warn(`[persistence] HYDI_PERSISTENCE_MODE="${mode}" is not allowed in local-first mode; forcing local`);
  }
  return 'local';
}

function selectConfig() {
  const localUrl = process.env.SUPABASE_URL_LOCAL ||
                   process.env.SUPABASE_URL;
  const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL ||
                   process.env.SUPABASE_SERVICE_ROLE_KEY;

  return { url: localUrl, key: localKey, source: 'local' };
}

function validateConfig(config) {
  if (!config.url || !config.key) {
    throw new Error(
      `Missing Supabase configuration for persistence source "${config.source}". ` +
      `Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or the _LOCAL variants).`
    );
  }
  if (config.url.includes('supabase.co')) {
    throw new Error(
      `Hosted Supabase URL detected in local-first mode: ${config.url}. ` +
      `Set SUPABASE_URL to your local self-hosted Supabase endpoint (e.g., http://127.0.0.1:54321).`
    );
  }
}

function createSupabaseClient() {
  const mode = getPersistenceMode();
  const config = selectConfig();
  validateConfig(config);
  console.log(`[persistence] HYDI_PERSISTENCE_MODE=${mode}; using Supabase source=${config.source} url=${config.url.substring(0, 20)}...`);
  return { client: createClient(config.url, config.key), source: config.source, mode };
}

// Singleton instance for the Node process
let cached = null;
function getSupabaseClient() {
  if (!cached) {
    cached = createSupabaseClient();
  }
  return cached.client;
}

function getPersistenceSource() {
  if (!cached) getSupabaseClient();
  return cached.source;
}

function resetSupabaseClient() {
  cached = null;
}

module.exports = {
  createSupabaseClient,
  getSupabaseClient,
  getPersistenceSource,
  resetSupabaseClient,
  loadEnvFiles,
};
