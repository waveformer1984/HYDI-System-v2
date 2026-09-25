'use strict';

/**
 * scripts/lint-migration-idempotency.js --ratchet, run the way
 * hdi-governance-gate.yml runs it. The baseline was generated on Windows
 * (backslash paths); these tests pin that its entries still match on the
 * Linux CI runner, and that a violation missing from the baseline still fails.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lint-migration-idempotency.js');

function ratchet(...files) {
  return spawnSync(process.execPath, [SCRIPT, '--ratchet', ...files], { cwd: ROOT, encoding: 'utf8' });
}

describe('lint-migration-idempotency --ratchet', () => {
  it('grandfathers baselined violations whatever the path separator', () => {
    const result = ratchet(
      'supabase/migrations/20260715123000_notifications.sql',
      'supabase/migrations/20260722000001_customer_identity_convergence.sql'
    );
    expect(result.stderr).not.toMatch(/NEW idempotency violation/);
    expect(result.stdout).toMatch(/ratchet passed: 0 new violations/);
    expect(result.status).toBe(0);
  });

  it('still fails on a violation that is not in the baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-ratchet-'));
    const file = path.join(dir, '20990101000000_unbaselined.sql');
    fs.writeFileSync(file, 'create policy "p" on public.t for all to service_role using (true);\n');
    try {
      const result = ratchet(file);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/1 NEW idempotency violation/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
