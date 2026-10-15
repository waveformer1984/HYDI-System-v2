'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261014230000_execution_fabric_tasks.sql');

describe('execution_fabric_tasks migration — static checks', () => {
  it('creates tasks table idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.execution_fabric_tasks/i);
  });

  it('enforces idempotency uniqueness when key is set', () => {
    expect(SQL).toMatch(/execution_fabric_tasks_idempotency_idx/i);
    expect(SQL).toMatch(/idempotency_scope, idempotency_key/i);
  });

  it('enables RLS with service_role policy', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.execution_fabric_tasks ENABLE ROW LEVEL SECURITY/i);
    expect(SQL).toMatch(/execution_fabric_tasks_service_role/i);
  });

  it('does not mutate unrelated tables', () => {
    expect(SQL).not.toMatch(/UPDATE public\./i);
    expect(SQL).not.toMatch(/DROP TABLE public\./i);
  });
});
