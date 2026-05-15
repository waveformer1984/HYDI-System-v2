'use strict';
const { readMigration } = require('./helpers');

describe('002_keymaker_functions', () => {
  let sql;
  beforeAll(() => { sql = readMigration('002_keymaker_functions.sql').toLowerCase(); });

  const fns = [
    'keymaker_issue_key', 'keymaker_validate_and_route',
    'oracle_calculate_behavior_score', 'oracle_predict_next_action',
    'agent_create_job', 'agent_claim_job', 'agent_complete_job', 'agent_retry_failed_jobs',
    'neo_kill_switch', 'neo_break_glass_access',
  ];
  test.each(fns)('creates function %s', (fn) => {
    expect(sql).toContain(fn);
  });

  const views = ['v_keymaker_status', 'v_keymaker_audit', 'v_oracle_user_patterns'];
  test.each(views)('creates view %s', (v) => {
    expect(sql).toContain(v);
  });

  test('functions use SECURITY DEFINER', () => {
    expect(sql).toContain('security definer');
  });

  test('update_updated_at_column trigger applied to keymaker_services', () => {
    expect(sql).toContain('update_updated_at_column');
    expect(sql).toContain('keymaker_services');
  });
});
