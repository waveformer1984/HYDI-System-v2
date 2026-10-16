'use strict';

/**
 * `npm run runtime:audit` exit codes. The fixture env skips pm2 and git.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../scripts/runtime-audit.js');
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function daemonInput(overrides = {}) {
  return {
    pm2Readable: true,
    repoHead: HEAD,
    declared: [{
      name: 'hydi-daemon',
      script: 'scripts/heidi-daemon-launcher.js',
      args: '--no-stabilization',
      cwd: '/repo',
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 50000,
    }],
    running: [{
      name: 'hydi-daemon',
      status: 'online',
      script: '/repo/scripts/heidi-daemon-launcher.js',
      args: '--no-stabilization',
      cwd: '/repo',
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 50000,
    }],
    provenance: { 'hydi-daemon': { gitSha: HEAD, gitDirty: false } },
    ...overrides,
  };
}

function run(input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-audit-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify(input));
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      HYDI_RUNTIME_AUDIT_FIXTURE: fixture,
    },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

describe('runtime:audit exit codes', () => {
  it('exits 0 only when every row is OK', () => {
    const result = run(daemonInput());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('overall\tOK');
    expect(result.stdout).toContain('hydi-daemon\tOK');
  });

  it.each([
    ['STALE_CODE', daemonInput({ provenance: { 'hydi-daemon': { gitSha: OLD, gitDirty: false } } })],
    ['UNDECLARED', {
      pm2Readable: true,
      repoHead: HEAD,
      declared: [],
      running: [{ name: 'hydi-revenue-autopilot-tick', status: 'online', script: 'x', args: '', cwd: '/repo' }],
      provenance: {},
    }],
    ['CONFIG_DRIFT', daemonInput({
      running: [{
        name: 'hydi-daemon',
        status: 'online',
        script: '/repo/scripts/heidi-daemon-launcher.js',
        args: '--no-stabilization',
        cwd: '/repo',
        max_restarts: 99999,
        exp_backoff_restart_delay: 1000,
        kill_timeout: 50000,
      }],
    })],
    ['UNKNOWN', { pm2Readable: false }],
    ['UNKNOWN_CODE', daemonInput({ provenance: {} })],
    ['MISSING', daemonInput({ running: [] })],
  ])('exits 1 on %s', (_label, input) => {
    const result = run(input);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('overall\tOK');
  });
});
