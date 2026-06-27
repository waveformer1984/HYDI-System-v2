'use strict';
const { readMigration } = require('./helpers');

describe('20260617000005_heidi_orchestrator_schema', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260617000005_heidi_orchestrator_schema.sql').toLowerCase();
  });

  // G÷¦G÷¦ offers (HeidiRevenueEngine persistence) G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦
  test('creates the offers table idempotently', () => {
    expect(sql).toContain('create table if not exists public.offers');
  });

  test('offers has a unique offer_id and jsonb offer_data', () => {
    expect(sql).toMatch(/offer_id\s+text\s+not null\s+unique/);
    expect(sql).toMatch(/offer_data\s+jsonb/);
  });

  test('offers defaults status to active', () => {
    expect(sql).toMatch(/status\s+text\s+not null\s+default\s+'active'/);
  });

  test('offers indexes status and offer_id', () => {
    expect(sql).toContain('idx_offers_status');
    expect(sql).toContain('idx_offers_offer_id');
  });

  test('offers enables RLS with select + service-role write policies', () => {
    expect(sql).toMatch(/alter table public\.offers enable row level security/);
    expect(sql).toMatch(/create policy\s+"offers_select"\s+on\s+public\.offers/);
    expect(sql).toMatch(/create policy\s+"offers_insert_service"\s+on\s+public\.offers/);
    expect(sql).toMatch(/create policy\s+"offers_update_service"\s+on\s+public\.offers/);
  });

  // G÷¦G÷¦ heidi_reflection_snapshots (HeidiMemorySystem blob snapshots) G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦
  test('creates the heidi_reflection_snapshots table idempotently', () => {
    expect(sql).toContain('create table if not exists public.heidi_reflection_snapshots');
  });

  test('snapshot table has reflection_id, reflection_data jsonb, and timestamp columns', () => {
    expect(sql).toMatch(/reflection_id\s+text/);
    expect(sql).toMatch(/reflection_data\s+jsonb/);
    expect(sql).toMatch(/"timestamp"\s+timestamptz/);
  });

  test('snapshot table indexes reflection_id and timestamp', () => {
    expect(sql).toContain('idx_heidi_reflection_snapshots_reflection_id');
    expect(sql).toContain('idx_heidi_reflection_snapshots_timestamp');
  });

  test('snapshot table enables RLS with select + service-role insert policies', () => {
    expect(sql).toMatch(/alter table public\.heidi_reflection_snapshots enable row level security/);
    expect(sql).toMatch(/create policy\s+"heidi_reflection_snapshots_select"\s+on\s+public\.heidi_reflection_snapshots/);
    expect(sql).toMatch(/create policy\s+"heidi_reflection_snapshots_insert_service"\s+on\s+public\.heidi_reflection_snapshots/);
  });

  // G÷¦G÷¦ guard: public.reflections is a VIEW and must never be altered G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦G÷¦
  test('does NOT alter the reflections view (the bug that rolled back the apply)', () => {
    expect(sql).not.toMatch(/alter table\s+public\.reflections\b/);
  });
});
