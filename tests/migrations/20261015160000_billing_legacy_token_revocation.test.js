'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261015160000_billing_legacy_token_revocation.sql');

describe('billing_legacy_token_revocation migration — static checks', () => {
  it('creates revocation and policy tables', () => {
    expect(SQL).toMatch(/billing_legacy_token_revocations/i);
    expect(SQL).toMatch(/billing_tenant_legacy_policy/i);
    expect(SQL).toMatch(/UNIQUE \(tenant_id, token_nonce\)/i);
  });

  it('enables RLS with service_role policies', () => {
    expect(SQL).toMatch(/billing_legacy_token_revocations_service_role/i);
    expect(SQL).toMatch(/billing_tenant_legacy_policy_service_role/i);
  });
});
