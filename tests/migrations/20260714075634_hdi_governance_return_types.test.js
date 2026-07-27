'use strict';
const { readMigration } = require('./helpers');

describe('20260714075634_hdi_governance_return_types', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260714075634_hdi_governance_return_types.sql').toLowerCase();
  });

  test('recreates create_test_run returning jsonb', () => {
    expect(sql).toContain('drop function if exists create_test_run');
    expect(sql).toContain('create or replace function create_test_run');
    expect(sql).toContain('returns jsonb');
  });

  test('recreates hydi_reconstruct_run returning jsonb', () => {
    expect(sql).toContain('drop function if exists hydi_reconstruct_run');
    expect(sql).toContain('create or replace function hydi_reconstruct_run');
    expect(sql).toContain('returns jsonb');
  });

  test('recreates hydi_transition returning jsonb', () => {
    expect(sql).toContain('drop function if exists hydi_transition');
    expect(sql).toContain('create or replace function hydi_transition');
    expect(sql).toContain('returns jsonb');
  });
});
