'use strict';

/**
 * Jest global setup — runs once per test FILE (setupFilesAfterEnv).
 *
 * 1. Forces the in-memory broker so tests never need a running Redis.
 * 2. Suppresses dotenv console noise during test runs.
 * 3. Stubs env vars consumed at module load time (database.js, supabase).
 */

// Node < 22 has no global WebSocket; supabase-js realtime requires one.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = require('ws');
}

// Use in-memory broker unless the caller explicitly set a different transport.
if (!process.env.BROKER_TRANSPORT) {
  process.env.BROKER_TRANSPORT = 'memory';
}

process.env.DOTENV_QUIET = 'true';
process.env.PAO_AUDIT_LOG             = process.env.PAO_AUDIT_LOG             || 'false';

process.env.NODE_ENV                  = process.env.NODE_ENV                  || 'test';
process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY         || 'test-anon-key';
// database.js throws if SUPABASE_SERVICE_ROLE_KEY is missing — provide a stub for tests
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
