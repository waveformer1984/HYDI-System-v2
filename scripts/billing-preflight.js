#!/usr/bin/env node
'use strict';

/**
 * Phase 1 preflight for Revenue Streams sandbox (test mode only).
 * Checks local Postgres billing schema and required env var *presence* (never prints values).
 *
 *   node scripts/billing-preflight.js
 *   node scripts/billing-preflight.js --require-stripe-env
 */

const { Pool } = require('pg');

const { BILLING_TABLES } = require('../lib/billing/sandbox-workflow');

function hasEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length >= 8 && !v.includes('your-') && !v.includes('...');
}

function pgConfig() {
  if (process.env.BILLING_DATABASE_URL) return { connectionString: process.env.BILLING_DATABASE_URL };
  return {
    host: process.env.PG_HOST || '127.0.0.1',
    port: Number(process.env.PG_PORT || 54322),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  };
}

async function main() {
  const requireStripe = process.argv.includes('--require-stripe-env');
  /** @type {{ id: string, ok: boolean, detail: string }[]} */
  const checks = [];

  const key = process.env.STRIPE_SECRET_KEY || '';
  const testKey =
    key.startsWith('sk_test_') || key.startsWith('rk_test_') || process.env.BILLING_PROVIDER === 'fake';
  checks.push({
    id: 'stripe_test_mode',
    ok: testKey && !key.startsWith('sk_live_'),
    detail: testKey
      ? process.env.BILLING_PROVIDER === 'fake'
        ? 'BILLING_PROVIDER=fake (demo only)'
        : 'STRIPE_SECRET_KEY is test-mode prefix'
      : 'Set sk_test_* or BILLING_PROVIDER=fake for local demos',
  });

  checks.push({
    id: 'billing_customer_token_secret',
    ok: hasEnv('BILLING_CUSTOMER_TOKEN_SECRET'),
    detail: 'BILLING_CUSTOMER_TOKEN_SECRET (>= 32 chars)',
  });
  checks.push({
    id: 'billing_webhook_secret',
    ok: hasEnv('BILLING_STRIPE_WEBHOOK_SECRET'),
    detail: 'BILLING_STRIPE_WEBHOOK_SECRET (from stripe listen)',
  });
  checks.push({
    id: 'hydi_service_secret',
    ok: hasEnv('HYDI_SERVICE_SECRET'),
    detail: 'HYDI_SERVICE_SECRET (operator admin routes)',
  });

  let pool;
  try {
    pool = new Pool(pgConfig());
    await pool.query('SELECT 1');
    checks.push({ id: 'postgres_connect', ok: true, detail: 'Postgres reachable' });

    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [BILLING_TABLES],
    );
    const found = new Set(rows.map((r) => r.table_name));
    const missing = BILLING_TABLES.filter((t) => !found.has(t));
    checks.push({
      id: 'billing_tables',
      ok: missing.length === 0,
      detail: missing.length === 0 ? `${BILLING_TABLES.length} billing_* tables present` : `missing: ${missing.join(', ')}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    checks.push({ id: 'postgres_connect', ok: false, detail: message });
    checks.push({ id: 'billing_tables', ok: false, detail: 'skipped (no database)' });
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}`);
  }

  if (requireStripe && failed.some((f) => f.id.startsWith('stripe') || f.id.includes('webhook') || f.id.includes('customer_token'))) {
    process.exit(1);
  }
  if (failed.some((f) => f.id === 'postgres_connect' || f.id === 'billing_tables')) {
    process.exit(1);
  }
  if (failed.length) process.exit(1);
  console.log('billing-preflight: ready for sandbox setup (test mode)');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'preflight failed');
  process.exit(1);
});
