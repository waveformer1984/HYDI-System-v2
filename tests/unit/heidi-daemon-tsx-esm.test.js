'use strict';

/**
 * hydi-daemon runs scripts/heidi-daemon-launcher.js under PM2. The launcher
 * registers `require('tsx/cjs')`, which hooks require() but NOT import() -
 * every `await import('../lib/<module>')` of an extensionless .ts file then
 * fails ERR_MODULE_NOT_FOUND at runtime (CredentialRunbookRegistry,
 * ExternalCapabilityAcquisitionEngine, lib/delegated-operator, and the
 * CognitiveCore lazy imports) - see logs/pm2-hydi-daemon.err.log.
 *
 * The fix lives inside the launcher: `require('tsx/esm/api').register()`
 * hooks the ESM loader in-process, so no node_args are needed. PM2's
 * cached process definition had been silently dropping `node_args`
 * anyway, which is why the CLI-level flag never activated.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'tsx-esm-launcher');

function runLauncher(nodeArgs, script = 'launcher.js') {
  return execFileSync(process.execPath, [...nodeArgs, script], {
    cwd: FIXTURE,
    encoding: 'utf8',
    timeout: 45000,
    // Clear NODE_OPTIONS so jest/worker flags cannot reach the child.
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

describe('hydi-daemon tsx ESM interop', () => {
  it('the launcher run with NO node args resolves an extensionless .ts via import()', () => {
    const out = runLauncher([]);
    expect(out).toContain('IMPORT_OK:tsx-esm-ok');
  }, 60000);

  it("require('tsx/cjs') alone cannot resolve an extensionless .ts via import()", () => {
    const out = runLauncher([], 'launcher-cjs-only.js');
    expect(out).toContain('IMPORT_FAIL:ERR_MODULE_NOT_FOUND');
  }, 60000);

  it('ecosystem.config.js runs hydi-daemon through the launcher with no node_args', () => {
    const entry = require('../../ecosystem.config.js').apps.find((a) => a.name === 'hydi-daemon');
    expect(entry).toBeDefined();
    expect(entry.script).toBe('scripts/heidi-daemon-launcher.js');
    expect(String(entry.node_args || '')).not.toContain('--import tsx');
  });
});
