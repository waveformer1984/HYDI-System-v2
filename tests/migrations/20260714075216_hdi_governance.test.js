'use strict';
const { readMigration } = require('./helpers');

describe('20260714075216_hdi_governance', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260714075216_hdi_governance.sql').toLowerCase();
  });

  test('creates hydi state machine tables', () => {
    for (const t of ['hydi_runs', 'hydi_events']) {
      expect(sql).toContain(`create table if not exists ${t}`);
    }
  });

  test('creates role-scoped tables', () => {
    for (const t of ['hydi_findings', 'hydi_tasks', 'hydi_verifications', 'hydi_certifications']) {
      expect(sql).toContain(`create table if not exists ${t}`);
    }
  });

  test('creates test helper RPCs', () => {
    for (const fn of ['create_test_run', 'seed_run_phase', 'delete_test_run', 'seed_many_events', 'hydi_reconstruct_run', 'hydi_transition']) {
      expect(sql).toContain(`function ${fn}`);
    }
  });

  test('enables role guard triggers on restricted tables', () => {
    for (const t of ['hydi_findings', 'hydi_tasks', 'hydi_verifications', 'hydi_certifications']) {
      expect(sql).toContain(`trigger ${t}_role_guard`);
    }
  });

  test('enables RLS on all new tables', () => {
    for (const t of ['hydi_runs', 'hydi_events', 'hydi_findings', 'hydi_tasks', 'hydi_verifications', 'hydi_certifications']) {
      expect(sql).toContain(`alter table ${t} enable row level security`);
    }
  });
});
