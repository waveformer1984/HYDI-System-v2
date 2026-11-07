'use strict';

const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20261107180000_agent_bus_rls_write_service_role.sql'),
  'utf8',
);

describe('migration 20261107180000_agent_bus_rls_write_service_role', () => {
  it('scopes INSERT and UPDATE to service_role only', () => {
    expect(SQL).toMatch(/agent_bus_service_role_insert/);
    expect(SQL).toMatch(/FOR INSERT TO service_role/);
    expect(SQL).toMatch(/agent_bus_service_role_update/);
    expect(SQL).toMatch(/FOR UPDATE TO service_role/);
  });

  it('does not grant write access to anon or authenticated', () => {
    expect(SQL).not.toMatch(/TO anon\b/);
    expect(SQL).not.toMatch(/TO authenticated\b/);
    expect(SQL).not.toMatch(/TO public\b/);
  });

  it('replaces the old FOR ALL policy', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS agent_bus_service_role/);
  });
});
