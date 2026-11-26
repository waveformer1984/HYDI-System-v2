'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261126120000_heidi_leads.sql');

describe('Migration 20261126120000 — heidi_leads', () => {
  it('creates heidi_leads with status default new and RLS', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.heidi_leads/);
    expect(SQL).toMatch(/status.*DEFAULT 'new'/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/heidi_leads_service_role/);
  });

  it('dedupe index on source, url, title_hash', () => {
    expect(SQL).toMatch(/heidi_leads_source_url_title_hash_idx/);
    expect(SQL).toMatch(/\(source, url, title_hash\)/);
  });
});