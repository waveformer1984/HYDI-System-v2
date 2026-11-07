'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const {
  gateProbePasses,
  probeOutOfBoundsGate,
} = require(path.join(ROOT, 'lib/governance/hydi-verify-gate-probe'));

describe('hydi-verify governance gate probe', () => {
  it('blocks unregistered rm_rf_everything (never AUTO-APPROVE)', () => {
    const r = probeOutOfBoundsGate(ROOT);
    expect(r.verdict).not.toBe('AUTO-APPROVE');
    expect(r.gate).toBe('action_registry');
    expect(gateProbePasses(ROOT)).toBe(true);
  });

  it('hydi-verify --quick prints PASS gate:oob-blocked without live services', () => {
    const script = path.join(ROOT, 'scripts/hydi-verify.js');
    const r = spawnSync(process.execPath, [script, '--quick'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, CI: '1' },
    });
    expect(r.stderr || '').not.toMatch(/node-fetch|ERR_REQUIRE_ESM/i);
    expect(r.stdout).toMatch(/PASS\s+gate:oob-blocked/);
    expect(r.status).not.toBeNull();
  });
});
