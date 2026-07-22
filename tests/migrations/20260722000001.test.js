'use strict';
const { readMigration } = require('./helpers');

describe('20260722000001_customer_identity_convergence', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260722000001_customer_identity_convergence.sql').toLowerCase(); });

  test('creates customers table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('customers');
    expect(sql).toContain('customer_id');
    expect(sql).toContain('uuid');
    expect(sql).toContain('primary key');
  });

  test('customers has canonical identity columns', () => {
    expect(sql).toContain('name');
    expect(sql).toContain('email');
    expect(sql).toContain('stripe_customer_id');
    expect(sql).toContain('status');
    expect(sql).toContain('metadata');
  });

  test('email is unique and not null', () => {
    expect(sql).toContain('email');
    expect(sql).toContain('unique');
    expect(sql).toContain('not null');
  });

  test('status check covers active/inactive/suspended', () => {
    expect(sql).toContain('active');
    expect(sql).toContain('inactive');
    expect(sql).toContain('suspended');
  });

  test('seeds customers from existing clients', () => {
    expect(sql).toContain('insert into customers');
    expect(sql).toContain('from clients');
    expect(sql).toContain('on conflict (customer_id)');
  });

  test('adds customer_id to commercial tables', () => {
    expect(sql).toContain('alter table clients add column if not exists customer_id');
    expect(sql).toContain('alter table payouts add column if not exists customer_id');
    expect(sql).toContain('alter table hydi_subscriptions add column if not exists customer_id');
    expect(sql).toContain('alter table hydi_client_health_runs add column if not exists customer_id');
    expect(sql).toContain('alter table hydi_schedules add column if not exists customer_id');
    expect(sql).toContain('alter table ledger add column if not exists customer_id');
  });

  test('adds customer_id to project-motion tables when they exist', () => {
    expect(sql).toContain('to_regclass');
    expect(sql).toContain('public.leads');
    expect(sql).toContain('public.outreach');
    expect(sql).toContain('public.proposals');
    expect(sql).toContain('public.quotes');
    expect(sql).toContain('public.checkout_sessions');
  });

  test('creates foreign keys to customers', () => {
    expect(sql).toContain('fk_clients_customer');
    expect(sql).toContain('fk_payouts_customer');
    expect(sql).toContain('fk_hydi_subscriptions_customer');
    expect(sql).toContain('fk_hydi_health_customer');
    expect(sql).toContain('fk_hydi_schedules_customer');
  });

  test('enables rls and service_role policy', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('service_role_all');
    expect(sql).toContain('auth.role() = \'service_role\'');
  });
});
