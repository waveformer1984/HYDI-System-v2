'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261120120000_makeready_bot.sql');

describe('Migration 20261120120000 — makeready_bot', () => {
  it('creates makeready_requests with RLS', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.makeready_requests/);
    expect(SQL).toMatch(/request_id TEXT NOT NULL/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role/);
  });

  it('indexes request_id and slug timeline', () => {
    expect(SQL).toMatch(/makeready_requests_request_id_idx/);
    expect(SQL).toMatch(/makeready_requests_slug_created_idx/);
  });
});