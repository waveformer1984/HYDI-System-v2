'use strict';

/**
 * Table metadata shared by both stores: primary keys, defaults and unique
 * constraints, mirroring supabase/migrations/20261011120000_billing_revenue_streams_module.sql.
 * The Postgres store only uses this to whitelist identifiers; the memory
 * store uses it to emulate defaults and constraint violations faithfully.
 */

const { randomUUID } = require('crypto');

const now = () => new Date();

const TABLES = {
  billing_revenue_streams: {
    pk: 'stream_key',
    defaults: { status: () => 'active', created_at: now },
    unique: [],
  },
  billing_tenants: {
    pk: 'tenant_id',
    defaults: { tenant_id: randomUUID, status: () => 'active', provider: () => 'stripe', provider_customer_id: () => null, customer_id: () => null, created_at: now, updated_at: now },
    unique: [['provider', 'provider_customer_id']],
  },
  billing_products: {
    pk: 'product_id',
    defaults: { product_id: randomUUID, description: () => '', status: () => 'draft', created_at: now, updated_at: now },
    unique: [['product_key']],
  },
  billing_plans: {
    pk: 'plan_id',
    defaults: { plan_id: randomUUID, description: () => '', features: () => [], limits: () => ({}), sort_order: () => 0, status: () => 'draft', created_at: now, updated_at: now },
    unique: [['plan_key']],
  },
  billing_price_versions: {
    pk: 'price_version_id',
    defaults: { price_version_id: randomUUID, interval_count: () => 1, trial_days: () => 0, provider: () => 'stripe', provider_price_id: () => null, status: () => 'draft', published_at: () => null, created_at: now },
    unique: [['plan_id', 'version'], ['provider', 'provider_price_id']],
  },
  billing_checkout_intents: {
    pk: 'intent_id',
    defaults: { intent_id: randomUUID, provider: () => 'stripe', provider_session_id: () => null, checkout_url: () => null, status: () => 'created', created_at: now, completed_at: () => null },
    unique: [['tenant_id', 'idempotency_key'], ['provider', 'provider_session_id']],
  },
  billing_subscriptions: {
    pk: 'subscription_id',
    defaults: {
      subscription_id: randomUUID, provider: () => 'stripe', cancel_at_period_end: () => false,
      current_period_start: () => null, current_period_end: () => null, trial_end: () => null,
      past_due_since: () => null, canceled_at: () => null, ended_at: () => null, access_hold: () => null,
      created_at: now, updated_at: now,
    },
    unique: [['provider', 'provider_subscription_id']],
  },
  billing_entitlements: {
    pk: 'entitlement_id',
    defaults: { entitlement_id: randomUUID, limit_units: () => null, access_until: () => null, updated_at: now },
    unique: [['tenant_id', 'feature_key', 'source_type', 'source_id']],
  },
  billing_usage_events: {
    pk: 'usage_id',
    defaults: { usage_id: randomUUID, units_committed: () => 0, finalized_at: () => null, attempts: () => 1 },
    unique: [['tenant_id', 'idempotency_key']],
  },
  billing_provider_cost_records: {
    pk: 'cost_id',
    defaults: { cost_id: randomUUID, usage_id: () => null, model: () => null, input_units: () => null, output_units: () => null, cost_currency: () => 'usd', cost_micros: () => null, rate_version: () => null, attempt: () => 1, created_at: now },
    unique: [],
  },
  billing_payments: {
    pk: 'payment_id',
    defaults: {
      payment_id: randomUUID, subscription_id: () => null, provider: () => 'stripe', provider_payment_intent: () => null,
      amount_refunded_minor: () => 0, amount_disputed_minor: () => 0, tax_minor: () => null, fee_minor: () => null,
      hosted_invoice_url: () => null, updated_at: now,
    },
    unique: [['provider', 'provider_invoice_id']],
  },
  billing_refunds: {
    pk: 'refund_id',
    defaults: { refund_id: randomUUID, provider: () => 'stripe' },
    unique: [['provider', 'provider_refund_id']],
  },
  billing_webhook_events: {
    pk: 'event_row_id',
    defaults: {
      event_row_id: randomUUID, status: () => 'received', attempts: () => 0, last_error: () => null,
      next_attempt_at: now, locked_until: () => null, received_at: now, processed_at: () => null,
    },
    unique: [['provider', 'provider_event_id']],
  },
  billing_audit_events: {
    pk: 'audit_id',
    defaults: { audit_id: randomUUID, tenant_id: () => null, reason: () => null, before: () => null, after: () => null, created_at: now },
    unique: [],
  },
};

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function assertTable(table) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) throw new Error(`unknown billing table: ${table}`);
  return TABLES[table];
}

function assertIdent(name) {
  if (!IDENT_RE.test(name)) throw new Error(`invalid identifier: ${name}`);
  return name;
}

module.exports = { TABLES, assertTable, assertIdent };
