'use strict';

const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20261107000000_divisions.sql'),
  'utf8',
);

describe('migration 20261107000000_divisions', () => {
  it('creates the divisions table with slug uniqueness and status check', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.divisions/);
    expect(SQL).toMatch(/slug TEXT NOT NULL UNIQUE/);
    expect(SQL).toMatch(/status TEXT NOT NULL DEFAULT 'seeded'/);
    expect(SQL).toMatch(/CHECK \(status IN \('seeded', 'active', 'dormant', 'archived'\)\)/);
  });

  it('enables RLS and grants nothing to anon or authenticated', () => {
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/TO service_role/);
    expect(SQL).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(SQL).not.toMatch(/TO anon\b/);
    expect(SQL).not.toMatch(/TO authenticated\b/);
    expect(SQL).not.toMatch(/TO public\b/);
  });

  it('maintains updated_at via trigger', () => {
    expect(SQL).toMatch(/touch_divisions_updated_at/);
    expect(SQL).toMatch(/BEFORE UPDATE ON public\.divisions/);
  });
});
