'use strict';

/**
 * hydi-daemon runs scripts/heidi-daemon-launcher.js under PM2. The launcher
 * registers `require('tsx/cjs')`, which hooks require() but NOT import().
 * Every `await import('../lib/<module>')` of an extensionless .ts file then
 * fails ERR_MODULE_NOT_FOUND at runtime (CredentialRunbookRegistry,
 * ExternalCapabilityAcquisitionEngine, lib/delegated-operator, and the
 * CognitiveCore lazy imports) — see logs/pm2-hydi-daemon.err.log.
 *
 * The fix is `node_args: '--import tsx'` on the hydi-daemon ecosystem entry:
 * the tsx ESM loader hooks import() too. This test proves the mechanism
 * against a miniature of the real launcher.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'tsx-esm-launcher');

function runLauncher(nodeArgs) {
  return execFileSync(process.execPath, [...nodeArgs, 'launcher.js'], {
    cwd: FIXTURE,
    encoding: 'utf8',
    timeout: 45000,
    // Clear NODE_OPTIONS so jest/worker flags cannot reach the child.
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

describe('hydi-daemon tsx ESM interop', () => {
  it('ecosystem.config.js launches hydi-daemon with --import tsx', () => {
    const entry = require('../../ecosystem.config.js').apps.find((a) => a.name === 'hydi-daemon');
    expect(entry).toBeDefined();
    expect(entry.script).toBe('scripts/heidi-daemon-launcher.js');
    expect(String(entry.node_args || '')).toContain('--import tsx');
  });

  it("require('tsx/cjs') alone cannot resolve an extensionless .ts via import()", () => {
    const out = runLauncher([]);
    expect(out).toContain('IMPORT_FAIL:ERR_MODULE_NOT_FOUND');
  }, 60000);

  it('node --import tsx resolves an extensionless .ts via import() through the launcher', () => {
    const out = runLauncher(['--import', 'tsx']);
    expect(out).toContain('IMPORT_OK:tsx-esm-ok');
  }, 60000);
});
