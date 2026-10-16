'use strict';

const fs = require('fs');
const path = require('path');

describe('migration 20261015180000_execution_fabric_tenant_binding', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/20261015180000_execution_fabric_tenant_binding.sql'),
    'utf8',
  );

  it('adds tenant_id and created_by without a default tenant', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id text/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS created_by text/);
    expect(sql).not.toMatch(/DEFAULT\s+'[^']+'/);
  });

  it('locks ownership and refuses claiming NULL tenant rows', () => {
    expect(sql).toMatch(/execution_fabric_ownership_immutable/);
    expect(sql).toMatch(/execution_fabric_unowned_not_claimable/);
    expect(sql).toMatch(/SET search_path = public/);
  });

  it('does not weaken service_role policies', () => {
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/TO anon/);
  });
});
