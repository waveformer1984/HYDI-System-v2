'use strict';
const { readMigration } = require('./helpers');

describe('20260617000003_worker_queue_system', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260617000003_worker_queue_system.sql').toLowerCase();
  });

  const tables = ['worker_queues', 'worker_status', 'worker_events'];
  test.each(tables)('creates %s idempotently', (t) => {
    expect(sql).toContain('create table if not exists public.' + t);
  });

  const fns = ['enqueue_task', 'dequeue_task', 'complete_task', 'cleanup_old_tasks'];
  test.each(fns)('defines function %s', (fn) => {
    expect(sql).toContain('create or replace function public.' + fn);
  });

  test('is NOT partitioned (the partitioned PK bug is gone)', () => {
    expect(sql).not.toContain('partition by hash');
    expect(sql).not.toContain('partition of');
  });

  test('uses built-in gen_random_uuid(), not uuid_generate_v4()', () => {
    expect(sql).toContain('gen_random_uuid()');
    expect(sql).not.toContain('uuid_generate_v4()');
  });

  test('avoids the queue_name variable/column shadow in complete_task', () => {
    expect(sql).toContain('v_queue_name');
    expect(sql).not.toContain('select queue_name into queue_name');
  });

  test('enables RLS and scopes all three tables to service_role', () => {
    expect(sql).toContain('enable row level security');
    const policyCount = (sql.match(/create policy "service_role_all"/g) || []).length;
    expect(policyCount).toBe(3);
  });
});
