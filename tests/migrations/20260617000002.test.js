'use strict';
const { readMigration } = require('./helpers');

describe('20260617000002_system_telemetry_table', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260617000002_system_telemetry_table.sql').toLowerCase();
  });

  test('creates the system_telemetry table idempotently', () => {
    expect(sql).toContain('create table if not exists public.system_telemetry');
  });

  // Every column written by logTelemetry() in modules/universal-agent-bus.js.
  const columns = [
    'event_type', 'message_id', 'origin', 'target', 'action',
    'customer_id', 'subscription_id', 'tier', 'priority', 'ttl',
    'elapsed_ms', 'error_message', 'metadata', 'sampled', 'created_at',
  ];
  test.each(columns)('defines column %s', (col) => {
    expect(sql).toContain(col);
  });

  test('priority is integer and ttl/elapsed_ms are bigint (match bus value types)', () => {
    expect(sql).toMatch(/priority\s+integer/);
    expect(sql).toMatch(/ttl\s+bigint/);
    expect(sql).toMatch(/elapsed_ms\s+bigint/);
  });

  // Regex (whitespace/quoting-tolerant) rather than exact string matching.
  test('enables RLS and scopes writes to the service_role', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/create policy\s+"service_role_all"\s+on\s+public\.system_telemetry/);
    expect(sql).toMatch(/for all\s+to\s+service_role/);
  });

  test('exposes an authenticated read policy (dashboard reads)', () => {
    expect(sql).toMatch(/create policy\s+"system_telemetry_select"\s+on\s+public\.system_telemetry/);
    expect(sql).toMatch(/for select\s+to\s+authenticated/);
  });

  test('sets the documented column defaults', () => {
    expect(sql).toMatch(/metadata\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/);
    expect(sql).toMatch(/sampled\s+boolean\s+not null\s+default\s+true/);
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/);
  });

  test('indexes created_at for time-range / retention queries', () => {
    expect(sql).toContain('idx_system_telemetry_created_at');
  });
});
