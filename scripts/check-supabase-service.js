#!/usr/bin/env node
'use strict';
/**
 * Supabase service-level check helper.
 * Verifies the REST API responds through the Kong gateway.
 * Exits 0 on success, non-zero on failure.
 * Used by watchdog.js to avoid inline script escaping issues on Windows.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load env vars from .env.local if not in environment
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  try {
    const envLocal = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const urlMatch = envLocal.match(/^SUPABASE_URL\s*=\s*(.+)$/m);
    const keyMatch = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.+)$/m);
    if (urlMatch) supabaseUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
    if (keyMatch) supabaseKey = keyMatch[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* .env.local not found */ }
}

if (!supabaseUrl || !supabaseKey) {
  process.exit(3); // config missing
}

const url = new URL(`${supabaseUrl}/rest/v1/`);
const req = http.get({
  hostname: url.hostname,
  port: url.port,
  path: url.pathname,
  timeout: 5000,
  headers: { apikey: supabaseKey },
}, (res) => {
  res.on('data', () => {}); // drain
  res.on('end', () => {
    process.exit(res.statusCode >= 200 && res.statusCode < 500 ? 0 : 1);
  });
});
req.on('timeout', () => { req.destroy(); process.exit(2); });
req.on('error', () => { process.exit(1); });
