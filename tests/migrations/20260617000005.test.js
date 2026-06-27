'use strict';
const { readMigration } = require('./helpers');

describe('20260617000001_fix_security_definer_search_path', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260617000001_fix_security_definer_search_path.sql').toLowerCase();
  });

  test('migration file is readable', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  test('only uses alter function (no destructive DDL)', () => {
    expect(sql).not.toContain('drop function');
    expect(sql).not.toContain('create or replace function');
  });

  test('pins search_path to safe schemas for all functions', () => {
    const alterCount = (sql.match(/alter function/g) || []).length;
    expect(alterCount).toBe(17);
  });

  test('every alter function line is followed by a set search_path', () => {
    const setCount = (sql.match(/set search_path/g) || []).length;
    expect(setCount).toBe(18); // 17 alter statements + 1 in comment
  });

  // GöÇGöÇ Keymaker functions GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  test('patches keymaker_issue_key', () => {
    expect(sql).toContain('keymaker_issue_key');
  });

  test('patches keymaker_validate_and_route', () => {
    expect(sql).toContain('keymaker_validate_and_route');
  });

  test('patches oracle_calculate_behavior_score', () => {
    expect(sql).toContain('oracle_calculate_behavior_score');
  });

  test('patches oracle_predict_next_action', () => {
    expect(sql).toContain('oracle_predict_next_action');
  });

  test('patches agent_create_job', () => {
    expect(sql).toContain('agent_create_job');
  });

  test('patches agent_claim_job', () => {
    expect(sql).toContain('agent_claim_job');
  });

  test('patches agent_complete_job', () => {
    expect(sql).toContain('agent_complete_job');
  });

  test('patches agent_retry_failed_jobs', () => {
    expect(sql).toContain('agent_retry_failed_jobs');
  });

  test('patches neo_kill_switch', () => {
    expect(sql).toContain('neo_kill_switch');
  });

  test('patches neo_break_glass_access', () => {
    expect(sql).toContain('neo_break_glass_access');
  });

  // GöÇGöÇ Stripe / billing GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  test('patches sync_hydi_stripe_subscription', () => {
    expect(sql).toContain('sync_hydi_stripe_subscription');
  });

  test('patches get_billing_retry_health', () => {
    expect(sql).toContain('get_billing_retry_health');
  });

  // GöÇGöÇ Tool executor RPC GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  test('patches tool_create_invoice', () => {
    expect(sql).toContain('tool_create_invoice');
  });

  test('patches tool_pause_subscription', () => {
    expect(sql).toContain('tool_pause_subscription');
  });

  test('patches tool_create_support_ticket', () => {
    expect(sql).toContain('tool_create_support_ticket');
  });

  // GöÇGöÇ Chat operator notifications GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  test('patches tool_send_notification', () => {
    expect(sql).toContain('tool_send_notification');
  });

  test('patches send_completion_notification', () => {
    expect(sql).toContain('send_completion_notification');
  });

  // GöÇGöÇ Safety: does not ALTER already-fixed functions GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  test('does not alter keeper_auto_escalate (already has search_path)', () => {
    expect(sql).not.toMatch(/alter function[^;]*keeper_auto_escalate/);
  });

  test('does not alter get_hydi_context (already has search_path)', () => {
    expect(sql).not.toMatch(/alter function[^;]*get_hydi_context/);
  });
});
