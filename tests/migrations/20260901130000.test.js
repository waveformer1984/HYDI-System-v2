'use strict';
const { readMigration } = require('./helpers');

describe('20260901130000_goal_checkpoints', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260901130000_goal_checkpoints.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('creates goal_checkpoints table', () => {
    expect(sql).toMatch(/create table.*goal_checkpoints/);
  });

  test('has required columns', () => {
    expect(sql).toContain('checkpoint_id');
    expect(sql).toContain('goal_id');
    expect(sql).toContain('session_id');
    expect(sql).toContain('identity_id');
    expect(sql).toContain('goal_statement');
    expect(sql).toContain('plan_version');
    expect(sql).toContain('completed_objectives');
    expect(sql).toContain('failed_objectives');
    expect(sql).toContain('in_progress_objectives');
    expect(sql).toContain('pending_objectives');
    expect(sql).toContain('executed_actions');
    expect(sql).toContain('verified_state');
    expect(sql).toContain('status');
    expect(sql).toContain('resume_condition');
    expect(sql).toContain('executed_side_effects');
    expect(sql).toContain('summary');
    expect(sql).toContain('checksum');
    expect(sql).toContain('expires_at');
    expect(sql).toContain('created_at');
    expect(sql).toContain('updated_at');
  });

  test('status check constraint includes goal states', () => {
    expect(sql).toContain("'running'");
    expect(sql).toContain("'paused'");
    expect(sql).toContain("'waiting_for_human'");
    expect(sql).toContain("'waiting_for_provider'");
    expect(sql).toContain("'recovering'");
    expect(sql).toContain("'completed'");
    expect(sql).toContain("'partial'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'expired'");
  });

  test('enables row level security', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toContain('checkpoints_service_all');
  });

  test('has indexes', () => {
    expect(sql).toContain('idx_checkpoints_goal_id');
    expect(sql).toContain('idx_checkpoints_status');
    expect(sql).toContain('idx_checkpoints_session_id');
    expect(sql).toContain('idx_checkpoints_created_at');
  });

  test('has updated_at trigger', () => {
    expect(sql).toContain('update_checkpoint_updated_at');
    expect(sql).toContain('trg_checkpoint_updated_at');
  });

  test('checkpoint_id is unique', () => {
    expect(sql).toMatch(/checkpoint_id\s+text\s+not\s+null\s+unique/i);
  });
});
