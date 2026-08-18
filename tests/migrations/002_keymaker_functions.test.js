'use strict';
const { readMigration } = require('./helpers');

describe('20260101000001_keymaker_functions', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260101000001_keymaker_functions.sql').toLowerCase(); });

  test('creates update_updated_at_column trigger function', () => {
    expect(sql).toContain('update_updated_at_column');
  });

  test('creates keymaker_issue_key function', () => {
    expect(sql).toContain('keymaker_issue_key');
  });

  test('creates keymaker_validate_and_route function', () => {
    expect(sql).toContain('keymaker_validate_and_route');
  });

  test('creates oracle_calculate_behavior_score function', () => {
    expect(sql).toContain('oracle_calculate_behavior_score');
  });

  test('creates oracle_predict_next_action function', () => {
    expect(sql).toContain('oracle_predict_next_action');
  });

  test('creates agent_create_job function', () => {
    expect(sql).toContain('agent_create_job');
  });

  test('creates agent_claim_job function', () => {
    expect(sql).toContain('agent_claim_job');
  });

  test('creates agent_complete_job function', () => {
    expect(sql).toContain('agent_complete_job');
  });

  test('creates neo_kill_switch function', () => {
    expect(sql).toContain('neo_kill_switch');
  });

  test('creates neo_break_glass_access function', () => {
    expect(sql).toContain('neo_break_glass_access');
  });

  test('creates v_keymaker_status view', () => {
    expect(sql).toContain('v_keymaker_status');
  });

  test('creates v_keymaker_audit view', () => {
    expect(sql).toContain('v_keymaker_audit');
  });

  test('creates v_oracle_user_patterns view', () => {
    expect(sql).toContain('v_oracle_user_patterns');
  });

  test('validates system_health field in access log', () => {
    expect(sql).toContain('system_health');
  });
});
