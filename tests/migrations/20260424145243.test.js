'use strict';
const { readMigration } = require('./helpers');

describe('20260424145243_hydi_monetization', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260424145243_hydi_monetization.sql').toLowerCase(); });

  test('creates hydi_subscriptions table', () => {
    expect(sql).toContain('hydi_subscriptions');
    expect(sql).toContain('create table');
  });

  test('creates hydi_client_health_runs table', () => {
    expect(sql).toContain('hydi_client_health_runs');
  });

  test('creates hydi_schedules table', () => {
    expect(sql).toContain('hydi_schedules');
  });

  test('hydi_subscriptions tier check covers starter/pro/enterprise', () => {
    expect(sql).toContain('starter');
    expect(sql).toContain('pro');
    expect(sql).toContain('enterprise');
  });

  test('creates hydi_mrr view', () => {
    expect(sql).toContain('hydi_mrr');
  });

  test('creates hydi_fleet_health view', () => {
    expect(sql).toContain('hydi_fleet_health');
  });

  test('enables RLS', () => {
    expect(sql).toContain('enable row level security');
  });
});
