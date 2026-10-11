/**
 * Migration test: billing_revenue_streams_module (Revenue Streams Module, slice 1).
 * Static assertions against the migration SQL — no database connection.
 * Behavioural coverage of the SQL functions against real Postgres lives in
 * tests/unit/billing/acceptance.pg.test.js (Tier 2).
 */
'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261011120000_billing_revenue_streams_module.sql');
// Code only: comments are prose and may legitimately mention words like "money".
const CODE = SQL.replace(/--[^\n]*/g, '');

const TABLES = [
  'billing_revenue_streams', 'billing_tenants', 'billing_products', 'billing_plans', 'billing_price_versions',
  'billing_checkout_intents', 'billing_subscriptions', 'billing_entitlements', 'billing_usage_events',
  'billing_provider_cost_records', 'billing_payments', 'billing_refunds', 'billing_webhook_events', 'billing_audit_events',
];

describe('billing_revenue_streams_module migration — static checks (no database)', () => {
  it('is transactional and only creates billing_* tables, idempotently', () => {
    expect(SQL).toMatch(/^BEGIN;/m);
    expect(SQL).toMatch(/^COMMIT;/m);
    for (const t of TABLES) expect(SQL).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
    const created = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1]);
    expect(created.every((t) => t.startsWith('billing_'))).toBe(true);
  });

  it('never alters or deletes existing objects or rows', () => {
    expect(SQL).not.toMatch(/DROP TABLE/i);
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/ALTER TABLE (?!public\.%I ENABLE ROW LEVEL SECURITY)/i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
    expect(SQL).not.toMatch(/TRUNCATE/i);
    expect(SQL).not.toMatch(/UPDATE public\.(?!billing_)/i);
  });

  it('stores money as integers, never float/numeric', () => {
    expect(CODE).not.toMatch(/\b(real|double precision|float\d?|numeric|money)\b/i);
    expect(SQL).toMatch(/unit_amount_minor\s+bigint NOT NULL/);
    expect(SQL).toMatch(/amount_minor\s+bigint NOT NULL/);
    expect(SQL).toMatch(/cost_micros\s+bigint/);
  });

  it('enforces the uniqueness that idempotency depends on', () => {
    expect(SQL).toMatch(/UNIQUE \(provider, provider_event_id\)/);
    expect(SQL).toMatch(/UNIQUE \(tenant_id, idempotency_key\)/);
    expect(SQL).toMatch(/UNIQUE \(provider, provider_subscription_id\)/);
    expect(SQL).toMatch(/UNIQUE \(provider, provider_invoice_id\)/);
    expect(SQL).toMatch(/UNIQUE \(provider, provider_refund_id\)/);
    expect(SQL).toMatch(/UNIQUE \(tenant_id, feature_key, source_type, source_id\)/);
  });

  it('locks the entitlement row before checking quota', () => {
    const fn = SQL.slice(SQL.indexOf('FUNCTION public.billing_reserve_usage'), SQL.indexOf('FUNCTION public.billing_finalize_usage'));
    expect(fn).toMatch(/FROM public\.billing_entitlements e[\s\S]*?FOR UPDATE;/);
    expect(fn.indexOf('FOR UPDATE')).toBeLessThan(fn.indexOf('quota_exceeded'));
  });

  it('makes published prices immutable and the audit log append-only', () => {
    expect(SQL).toMatch(/CREATE TRIGGER billing_price_version_guard\s+BEFORE UPDATE ON public\.billing_price_versions/);
    expect(SQL).toMatch(/CREATE TRIGGER billing_audit_append_only\s+BEFORE UPDATE OR DELETE ON public\.billing_audit_events/);
  });

  it('enables RLS on every table and restricts function execution', () => {
    for (const t of TABLES) expect(SQL).toContain(`'${t}'`);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role USING \(true\) WITH CHECK \(true\)/);
    for (const f of ['billing_reserve_usage', 'billing_finalize_usage', 'billing_release_usage', 'billing_claim_webhook_event']) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC;`));
    }
  });

  it('pins search_path on the plpgsql functions that take locks', () => {
    const count = (SQL.match(/SET search_path = public, pg_temp/g) || []).length;
    expect(count).toBe(4);
  });

  it('declares no state-machine enum changes to existing tables', () => {
    expect(SQL).not.toMatch(/CREATE TYPE|ALTER TYPE/i);
  });
});
