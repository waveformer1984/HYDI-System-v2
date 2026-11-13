'use strict';

/**
 * Governance gate test for migration 20261115000000_notifications_job_lead.sql
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20261115000000_notifications_job_lead.sql';

describe('Migration 20261115000000 – notifications job_lead category', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('adds job_lead to the category check constraint', () => {
    expect(sql).toMatch(/job_lead/);
    expect(sql).toMatch(/check\s*\(category in/i);
  });

  it('keeps every pre-existing category in the constraint', () => {
    [
      'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
      'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
      'approval_required', 'destructive_action_confirmation',
    ].forEach((c) => expect(sql).toMatch(new RegExp(`'${c}'`)));
  });

  it('drops the old constraint before re-adding (idempotent re-run safe)', () => {
    expect(sql).toMatch(/drop constraint if exists notifications_category_check/i);
    expect(sql).toMatch(/add constraint notifications_category_check/i);
  });
});
