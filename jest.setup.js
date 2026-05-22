'use strict';

/**
 * Jest global setup — runs once per test FILE (setupFilesAfterFramework).
 *
 * 1. Forces the in-memory broker so tests never need a running Redis.
 * 2. Suppresses dotenv console noise during test runs.
 */

// Use in-memory broker unless the caller explicitly set a different transport.
// This eliminates ECONNREFUSED errors and removes the need to mock ioredis.
if (!process.env.BROKER_TRANSPORT) {
  process.env.BROKER_TRANSPORT = 'memory';
}

// Silence dotenvx tips in test output.
process.env.DOTENV_QUIET = 'true';

// Reasonable defaults so services that read these vars don't crash during tests.
process.env.NODE_ENV       = process.env.NODE_ENV       || 'test';
process.env.SUPABASE_URL   = process.env.SUPABASE_URL   || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
