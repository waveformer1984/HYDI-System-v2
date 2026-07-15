'use strict';
const { readMigration } = require('./helpers');

describe('20260715120000_agent_control_commands', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260715120000_agent_control_commands.sql').toLowerCase();
  });

  test('creates agent_control_commands idempotently', () => {
    expect(sql).toContain('create table if not exists public.agent_control_commands');
  });

  test('uses built-in gen_random_uuid()', () => {
    expect(sql).toContain('gen_random_uuid()');
  });

  test('restricts command to the least-privilege set (start/stop/restart only)', () => {
    expect(sql).toContain("check (command in ('start', 'stop', 'restart'))");
  });

  test('restricts status to the expected lifecycle', () => {
    expect(sql).toContain("check (status in ('pending', 'acknowledged', 'completed', 'failed'))");
  });

  test('requires requested_by (no anonymous commands)', () => {
    expect(sql).toContain('requested_by   text not null');
  });

  test('enables RLS and scopes the table to service_role only', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('create policy "service_role_all" on public.agent_control_commands');
  });

  test('indexes status and worker_type for orchestrator polling', () => {
    expect(sql).toContain('idx_agent_control_commands_status');
    expect(sql).toContain('idx_agent_control_commands_worker_type');
  });
});
