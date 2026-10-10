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
process.env.PAO_AUDIT_LOG = process.env.PAO_AUDIT_LOG || 'false';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
// database.js throws if SUPABASE_SERVICE_ROLE_KEY is missing — provide a stub for tests
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

// lib/embeddings.ts's default (15s) is deliberately tight for production, sized
// for a single caller. Several *-qualification.test.ts suites make real calls
// to a single local Ollama instance; when Jest's parallel workers run several
// of those files at once, requests queue and a lone caller's 15s budget isn't
// enough. Widen it for the test environment only -- production is unaffected.
process.env.EMBEDDING_TIMEOUT_MS = process.env.EMBEDDING_TIMEOUT_MS || '45000';

// Point the boot-control channel and the boot lease at throwaway paths.
//
// RecoveryEngine.restartProcess() now asks the running boot authority to
// perform the spawn (so recovered processes stay supervised -- see
// scripts/boot-control.js). It decides whether to delegate by reading
// .hydi-boot.lock. Without these seams, any test exercising restartProcess
// would read the DEVELOPER'S REAL lease and behave differently depending on
// whether a production boot-agent happened to be running on that machine --
// and could write real restart requests into the live control directory.
// Both must be impossible from a test.
const os = require('os');
const path = require('path');
const testRuntimeDir = path.join(os.tmpdir(), `hydi-jest-runtime-${process.pid}`);
process.env.HYDI_BOOT_LEASE_PATH = process.env.HYDI_BOOT_LEASE_PATH || path.join(testRuntimeDir, '.hydi-boot.lock');
process.env.BOOT_CONTROL_DIR = process.env.BOOT_CONTROL_DIR || path.join(testRuntimeDir, 'boot-control');
process.env.RECOVERY_LEASE_DIR = process.env.RECOVERY_LEASE_DIR || path.join(testRuntimeDir, 'recovery-leases');
