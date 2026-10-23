#!/usr/bin/env node
/**
 * Controlled auto-mode test for the persistence factory.
 *
 * Uses the real local Supabase endpoint as a "cloud" stand-in for the
 * local-down/cloud-up scenario. This proves routing/fallback behaviour
 * without touching the real cloud Supabase project.
 */

const { resetSupabaseClient, getPersistenceSource } = require('../src/persistence/supabase-client');

const REAL_LOCAL_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const REAL_LOCAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_test';
const DOWN_URL = 'http://127.0.0.1:59998';
const DOWN_KEY = 'fake-local-key';

function runCase(name, env, expectSource) {
  resetSupabaseClient();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const actual = getPersistenceSource();
  const ok = actual === expectSource;
  console.log(`[auto-test] ${name}: source=${actual} expected=${expectSource} ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

function main() {
  // Preserve real env values so we can restore them later.
  const saved = {
    HYDI_PERSISTENCE_MODE: process.env.HYDI_PERSISTENCE_MODE,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL_CLOUD: process.env.SUPABASE_URL_CLOUD,
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: process.env.SUPABASE_SERVICE_ROLE_KEY_CLOUD,
  };

  // 1. Local UP / Cloud UP -> LOCAL wins
  runCase('local_up_cloud_up', {
    HYDI_PERSISTENCE_MODE: 'auto',
    SUPABASE_URL: REAL_LOCAL_URL,
    SUPABASE_SERVICE_ROLE_KEY: REAL_LOCAL_KEY,
    SUPABASE_URL_CLOUD: REAL_LOCAL_URL,
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: REAL_LOCAL_KEY,
  }, 'local');

  // 2. Local UP / Cloud DOWN -> LOCAL
  runCase('local_up_cloud_down', {
    HYDI_PERSISTENCE_MODE: 'auto',
    SUPABASE_URL: REAL_LOCAL_URL,
    SUPABASE_SERVICE_ROLE_KEY: REAL_LOCAL_KEY,
    SUPABASE_URL_CLOUD: 'http://127.0.0.1:59999',
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: DOWN_KEY,
  }, 'local');

  // 3. Local DOWN / Cloud UP -> CLOUD fallback (cloud stand-in is real local)
  runCase('local_down_cloud_up', {
    HYDI_PERSISTENCE_MODE: 'auto',
    SUPABASE_URL: DOWN_URL,
    SUPABASE_SERVICE_ROLE_KEY: DOWN_KEY,
    SUPABASE_URL_CLOUD: REAL_LOCAL_URL,
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: REAL_LOCAL_KEY,
  }, 'cloud');

  // 4. Local DOWN / Cloud DOWN -> truthfully fail on local
  runCase('local_down_cloud_down', {
    HYDI_PERSISTENCE_MODE: 'auto',
    SUPABASE_URL: DOWN_URL,
    SUPABASE_SERVICE_ROLE_KEY: DOWN_KEY,
    SUPABASE_URL_CLOUD: 'http://127.0.0.1:59997',
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: DOWN_KEY,
  }, 'local');

  // Restore environment
  resetSupabaseClient();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

main();
