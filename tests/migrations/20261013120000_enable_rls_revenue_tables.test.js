// tests/migrations/20261013120000_enable_rls_revenue_tables.test.js
// Static checks for the revenue-table RLS hardening migration (no database).

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20261013120000_enable_rls_revenue_tables.sql'
);
const sql = fs.readFileSync(MIGRATION, 'utf8');

describe('20261013120000_enable_rls_revenue_tables — static checks (no database)', () => {
  it('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('covers the three unprotected revenue tables plus the legacy ledger name', () => {
    for (const t of ['clients', 'payouts', 'financial_ledger', 'ledger']) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  it('enables ROW LEVEL SECURITY', () => {
    expect(sql).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('creates a service_role-only policy per table', () => {
    expect(sql).toMatch(/TO\s+service_role\s+USING\s*\(true\)\s+WITH\s+CHECK\s*\(true\)/i);
  });

  it('is additive-only — no drops, deletes, or truncates of data objects', () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/i);
  });

  it('only alters real base tables — guards on to_regclass and relkind = r', () => {
    expect(sql).toContain('to_regclass');
    expect(sql).toContain("relkind = 'r'");
  });

  it('converges on re-run — drops each policy before recreating it', () => {
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS/i);
    expect(sql).not.toMatch(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
  });

  it('introduces no state-machine enum or transition changes', () => {
    expect(sql).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(sql).not.toMatch(/hydi_allowed_transitions|hydi_phase|hydi_status/i);
  });
});
