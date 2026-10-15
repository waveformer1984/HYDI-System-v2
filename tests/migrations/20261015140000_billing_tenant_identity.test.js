'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261015140000_billing_tenant_identity.sql');

describe('billing_tenant_identity migration — static checks', () => {
  it('creates membership and walkie binding tables idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_tenant_members/i);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_walkie_tenant_bindings/i);
  });

  it('restricts roles and enables RLS', () => {
    expect(SQL).toMatch(/role IN \('owner', 'billing_admin', 'member'\)/i);
    expect(SQL).toMatch(/billing_tenant_members_service_role/i);
    expect(SQL).toMatch(/billing_walkie_tenant_bindings_service_role/i);
  });

  it('does not mutate unrelated tables', () => {
    expect(SQL).not.toMatch(/DROP TABLE public\./i);
    expect(SQL).not.toMatch(/DELETE FROM/i);
  });
});
