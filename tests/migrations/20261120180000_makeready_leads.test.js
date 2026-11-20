'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261120180000_makeready_leads.sql');

describe('Migration 20261120180000 — makeready_leads', () => {
  it('creates makeready_leads with RLS', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.makeready_leads/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role/);
    expect(SQL).toMatch(/DO \$\$ BEGIN[\s\S]*CREATE POLICY makeready_leads_service_role[\s\S]*EXCEPTION WHEN duplicate_object/);
  });

  it('indexes lead_id and created_at', () => {
    expect(SQL).toMatch(/makeready_leads_lead_id_idx/);
    expect(SQL).toMatch(/makeready_leads_created_idx/);
  });
});