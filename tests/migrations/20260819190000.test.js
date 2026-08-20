'use strict';
const { readMigration } = require('./helpers');

describe('20260819190000_revenue_engine_schema', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260819190000_revenue_engine_schema.sql').toLowerCase(); });

  test('creates revenue_offers table', () => {
    expect(sql).toContain('revenue_offers');
    expect(sql).toContain('create table');
  });

  test('creates revenue_prospects table', () => {
    expect(sql).toContain('revenue_prospects');
  });

  test('creates revenue_opportunities table', () => {
    expect(sql).toContain('revenue_opportunities');
  });

  test('creates revenue_ledger table', () => {
    expect(sql).toContain('revenue_ledger');
  });

  test('creates customer_services table', () => {
    expect(sql).toContain('customer_services');
  });

  test('creates revenue_events table', () => {
    expect(sql).toContain('revenue_events');
  });

  test('creates revenue_icp_config table', () => {
    expect(sql).toContain('revenue_icp_config');
  });

  test('creates revenue_suppression_list table', () => {
    expect(sql).toContain('revenue_suppression_list');
  });

  test('seeds 6 offers', () => {
    expect(sql).toContain('ai_operations_setup');
    expect(sql).toContain('ai_operations_monthly');
    expect(sql).toContain('ai_website_setup');
    expect(sql).toContain('ai_website_monthly');
    expect(sql).toContain('lead_gen_setup');
    expect(sql).toContain('lead_gen_monthly');
  });

  test('seeds ICP configuration', () => {
    expect(sql).toContain('revenue_icp_config');
    expect(sql).toContain('icp_configuration');
  });

  test('revenue_ledger has idempotency via unique stripe_event_id', () => {
    expect(sql).toContain('stripe_event_id');
    expect(sql).toContain('unique');
  });

  test('revenue_ledger has verified flag', () => {
    expect(sql).toContain('verified');
  });

  test('revenue_prospects has ICP scoring fields', () => {
    expect(sql).toContain('icp_score');
    expect(sql).toContain('icp_factors');
  });

  test('revenue_prospects has compliance fields', () => {
    expect(sql).toContain('opted_out');
    expect(sql).toContain('suppression_list');
  });

  test('revenue_prospects has CRM state fields', () => {
    expect(sql).toContain('contact_count');
    expect(sql).toContain('last_contacted_at');
    expect(sql).toContain('next_contact_at');
  });

  test('customer_services has fulfillment steps', () => {
    expect(sql).toContain('fulfillment_steps');
  });

  test('customer_services has health check fields', () => {
    expect(sql).toContain('health_check_url');
    expect(sql).toContain('last_health_check_at');
    expect(sql).toContain('last_health_status');
  });

  test('enables RLS on all tables', () => {
    expect(sql).toContain('enable row level security');
  });

  test('creates indexes for performance', () => {
    expect(sql).toContain('create index');
    expect(sql).toContain('idx_revenue_ledger_customer');
    expect(sql).toContain('idx_revenue_prospects_status');
  });

  test('revenue_ledger event_type check constraint covers all event types', () => {
    expect(sql).toContain('payment_received');
    expect(sql).toContain('payment_failed');
    expect(sql).toContain('refund_issued');
    expect(sql).toContain('subscription_started');
    expect(sql).toContain('subscription_cancelled');
    expect(sql).toContain('setup_fee_collected');
  });

  test('revenue_offers has correct pricing in cents', () => {
    expect(sql).toContain('50000');  // $500 setup
    expect(sql).toContain('29900');  // $299/mo
    expect(sql).toContain('19900');  // $199/mo
    expect(sql).toContain('49900');  // $499/mo
    expect(sql).toContain('150000'); // $1,500 setup
    expect(sql).toContain('75000');  // $750 setup
  });

  test('revenue_suppression_list has unique constraint on identifier', () => {
    expect(sql).toContain('identifier');
    expect(sql).toContain('identifier_type');
  });
});
