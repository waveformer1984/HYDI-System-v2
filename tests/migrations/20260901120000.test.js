'use strict';
const { readMigration } = require('./helpers');

describe('20260901120000_human_intervention_requests', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260901120000_human_intervention_requests.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('creates human_intervention_requests table', () => {
    expect(sql).toMatch(/create table.*human_intervention_requests/);
  });

  test('has required columns', () => {
    expect(sql).toContain('request_id');
    expect(sql).toContain('goal_id');
    expect(sql).toContain('session_id');
    expect(sql).toContain('user_id');
    expect(sql).toContain('identity_id');
    expect(sql).toContain('objective');
    expect(sql).toContain('blocker');
    expect(sql).toContain('required_action');
    expect(sql).toContain('why_required');
    expect(sql).toContain('expected_state');
    expect(sql).toContain('resume_condition');
    expect(sql).toContain('intervention_type');
    expect(sql).toContain('audit_id');
    expect(sql).toContain('status');
    expect(sql).toContain('resolution_note');
    expect(sql).toContain('created_at');
    expect(sql).toContain('expires_at');
    expect(sql).toContain('completed_at');
    expect(sql).toContain('updated_at');
  });

  test('status check constraint includes all valid states', () => {
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'resolved'");
    expect(sql).toContain("'expired'");
    expect(sql).toContain("'cancelled'");
  });

  test('enables row level security', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toContain('interventions_service_all');
  });

  test('has indexes on goal_id, status, session_id, expires_at', () => {
    expect(sql).toContain('idx_interventions_goal_id');
    expect(sql).toContain('idx_interventions_status');
    expect(sql).toContain('idx_interventions_session_id');
    expect(sql).toContain('idx_interventions_expires_at');
  });

  test('has updated_at trigger', () => {
    expect(sql).toContain('update_intervention_updated_at');
    expect(sql).toContain('trg_intervention_updated_at');
  });

  test('request_id is unique', () => {
    expect(sql).toMatch(/request_id\s+text\s+not\s+null\s+unique/i);
  });
});
