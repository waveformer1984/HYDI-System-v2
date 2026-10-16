'use strict';

/**
 * Drift audit verdicts. PM2 and git are not invoked — every input is a fixture.
 * The shapes below are the three incidents: a daemon on an old SHA, an
 * undeclared autopilot tick, and a max_restarts mismatch.
 */

const os = require('os');
const { auditDrift, degradesApiHealth, runtimeHealthCheck } = require('../../lib/runtime/drift-audit');
const { collectRuntimeAudit, normalizePm2List } = require('../../lib/runtime/collect');

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function declared(name, extra = {}) {
  return {
    name,
    script: extra.script || `scripts/${name}.js`,
    args: extra.args != null ? extra.args : '',
    cwd: extra.cwd || '/repo',
    max_restarts: extra.max_restarts != null ? extra.max_restarts : 10,
    exp_backoff_restart_delay: extra.exp_backoff_restart_delay != null ? extra.exp_backoff_restart_delay : 1000,
    kill_timeout: extra.kill_timeout != null ? extra.kill_timeout : 10000,
  };
}

function running(name, extra = {}) {
  const base = declared(name, extra);
  return {
    ...base,
    status: extra.status || 'online',
    script: extra.script || `/repo/scripts/${name}.js`,
  };
}

function audit(overrides = {}) {
  return auditDrift({
    pm2Readable: true,
    repoHead: HEAD,
    declared: [declared('hydi-daemon', { script: 'scripts/heidi-daemon-launcher.js', args: '--no-stabilization', kill_timeout: 50000 })],
    running: [running('hydi-daemon', { script: '/repo/scripts/heidi-daemon-launcher.js', args: '--no-stabilization', kill_timeout: 50000 })],
    provenance: { 'hydi-daemon': { gitSha: HEAD, gitDirty: false } },
    ...overrides,
  });
}

describe('auditDrift verdicts', () => {
  it('OK only when the SHA matches and the config matches', () => {
    const result = audit();
    expect(result.overall).toBe('OK');
    expect(result.ok).toBe(true);
    expect(result.rows[0].verdict).toBe('OK');
    expect(result.rows[0].suggestion).toBeNull();
    expect(result.degradesHealth).toBe(false);
    expect(degradesApiHealth(result)).toBe(false);
  });

  it('daemon on an old SHA is STALE_CODE', () => {
    const result = audit({
      provenance: { 'hydi-daemon': { gitSha: OLD, gitDirty: false } },
    });
    expect(result.overall).toBe('DRIFT');
    expect(result.ok).toBe(false);
    expect(result.rows[0].verdict).toBe('STALE_CODE');
    expect(result.rows[0].suggestion).toContain('pm2 delete hydi-daemon');
    expect(result.rows[0].suggestion).toContain('pm2 start ecosystem.config.js --only hydi-daemon');
    expect(result.degradesHealth).toBe(true);
    expect(result.counts.STALE_CODE).toBe(1);
  });

  it('a dirty tree is STALE_CODE even when the SHA matches HEAD', () => {
    const result = audit({
      provenance: { 'hydi-daemon': { gitSha: HEAD, gitDirty: true } },
    });
    expect(result.rows[0].verdict).toBe('STALE_CODE');
    expect(result.overall).toBe('DRIFT');
  });

  it('an autopilot tick running but undeclared is UNDECLARED', () => {
    const result = auditDrift({
      pm2Readable: true,
      repoHead: HEAD,
      declared: [declared('hydi-boot', { script: 'scripts/boot-agent.js' })],
      running: [
        running('hydi-boot', { script: '/repo/scripts/boot-agent.js' }),
        running('hydi-revenue-autopilot-tick', {
          script: '/repo/node_modules/tsx/dist/cli.mjs',
          args: 'scripts/revenue-autopilot-tick.ts',
        }),
      ],
      provenance: {
        'hydi-boot': { gitSha: HEAD, gitDirty: false },
        'hydi-revenue-autopilot-tick': { gitSha: OLD, gitDirty: false },
      },
    });
    const tick = result.rows.find((row) => row.name === 'hydi-revenue-autopilot-tick');
    expect(tick.verdict).toBe('UNDECLARED');
    expect(tick.suggestion).toContain('pm2 delete hydi-revenue-autopilot-tick');
    expect(tick.suggestion).toContain('do not restart');
    expect(result.overall).toBe('DRIFT');
    expect(result.degradesHealth).toBe(true);
    expect(result.rows.find((row) => row.name === 'hydi-boot').verdict).toBe('OK');
  });

  it('max_restarts mismatch is CONFIG_DRIFT and does not by itself degrade /api/health', () => {
    const result = audit({
      running: [running('hydi-daemon', {
        script: '/repo/scripts/heidi-daemon-launcher.js',
        args: '--no-stabilization',
        kill_timeout: 50000,
        max_restarts: 99999,
      })],
    });
    expect(result.rows[0].verdict).toBe('CONFIG_DRIFT');
    expect(result.rows[0].configDiffs).toEqual(['max_restarts']);
    expect(result.rows[0].suggestion).toContain('pm2 delete hydi-daemon');
    expect(result.rows[0].suggestion).toContain('--only hydi-daemon');
    expect(result.overall).toBe('DRIFT');
    expect(result.ok).toBe(false);
    expect(degradesApiHealth(result)).toBe(false);
  });

  it('a declared process that is not online is MISSING', () => {
    const result = audit({ running: [] });
    expect(result.rows.map((row) => row.verdict)).toEqual(['MISSING']);
    expect(result.overall).toBe('DRIFT');
    expect(degradesApiHealth(result)).toBe(false);
    expect(result.rows[0].suggestion).toContain('pm2 start ecosystem.config.js --only hydi-daemon');
  });

  it('a stopped PM2 row is not treated as running', () => {
    const result = audit({
      running: [running('hydi-daemon', {
        status: 'stopped',
        script: '/repo/scripts/heidi-daemon-launcher.js',
        args: '--no-stabilization',
        kill_timeout: 50000,
      })],
    });
    expect(result.rows[0].verdict).toBe('MISSING');
  });

  it('missing provenance is UNKNOWN_CODE, and UNKNOWN is not OK', () => {
    const result = audit({ provenance: {} });
    expect(result.rows[0].verdict).toBe('UNKNOWN_CODE');
    expect(result.overall).toBe('UNKNOWN');
    expect(result.ok).toBe(false);
    expect(degradesApiHealth(result)).toBe(true);
  });

  it('a null gitSha is UNKNOWN_CODE', () => {
    const result = audit({ provenance: { 'hydi-daemon': { gitSha: null, gitDirty: null } } });
    expect(result.rows[0].verdict).toBe('UNKNOWN_CODE');
    expect(result.overall).toBe('UNKNOWN');
  });

  it('a null repo HEAD cannot be called STALE_CODE', () => {
    const result = audit({
      repoHead: null,
      provenance: { 'hydi-daemon': { gitSha: OLD, gitDirty: false } },
    });
    expect(result.rows[0].verdict).toBe('UNKNOWN_CODE');
    expect(result.overall).toBe('UNKNOWN');
    expect(result.ok).toBe(false);
  });

  it('PM2 unreadable is UNKNOWN overall, with no rows and not OK', () => {
    const result = auditDrift({ pm2Readable: false, declared: [declared('hydi-daemon')], running: [running('hydi-daemon')], repoHead: HEAD });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.degradesHealth).toBe(true);
    expect(result.suggestion).toMatch(/not OK/);
    expect(result.suggestion).toMatch(/No process was restarted/);
  });

  it('null sha plus a config mismatch stays visible as DRIFT', () => {
    const result = audit({
      provenance: {},
      running: [running('hydi-daemon', {
        script: '/repo/scripts/heidi-daemon-launcher.js',
        args: '--no-stabilization',
        kill_timeout: 50000,
        max_restarts: 1,
      })],
    });
    expect(result.rows[0].verdicts).toEqual(expect.arrayContaining(['UNKNOWN_CODE', 'CONFIG_DRIFT']));
    expect(result.overall).toBe('DRIFT');
  });

  it('embeds an unhealthy heidi-health check for any non-OK audit', () => {
    const stale = runtimeHealthCheck(audit({ provenance: { 'hydi-daemon': { gitSha: OLD, gitDirty: false } } }));
    expect(stale.healthy).toBe(false);
    expect(stale.state).toBe('DRIFT');
    expect(stale.details.rows[0].verdict).toBe('STALE_CODE');
    const ok = runtimeHealthCheck(audit());
    expect(ok.healthy).toBe(true);
    expect(ok.state).toBe('OK');
    const unknown = runtimeHealthCheck(null);
    expect(unknown.healthy).toBe(false);
    expect(unknown.state).toBe('UNKNOWN');
  });
});

describe('collectRuntimeAudit adapter', () => {
  it('does not call git when pm2 jlist fails, and the audit is UNKNOWN', async () => {
    const execFile = jest.fn((cmd, _args, _opts, cb) => {
      process.nextTick(() => cb(new Error('spawn pm2 ENOENT')));
      return { on() {} };
    });
    const result = await collectRuntimeAudit({
      root: os.tmpdir(),
      execFile,
      requireImpl: () => ({
        apps: [declared('hydi-boot', { script: 'scripts/boot-agent.js', kill_timeout: 20000 })],
      }),
      fs: { readdirSync() { throw new Error('none'); }, readFileSync() { throw new Error('none'); } },
    });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.ok).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][0]).toBe('pm2');
    expect(execFile.mock.calls[0][1]).toEqual(['jlist']);
  });

  it('turns a jlist payload and git HEAD into a verdict without spawning', async () => {
    const fs = require('fs');
    const path = require('path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-ok-'));
    const { writeProvenance } = require('../../lib/runtime/provenance');
    writeProvenance(root, {
      name: 'hydi-boot',
      pid: 1,
      gitSha: HEAD,
      gitDirty: false,
      branch: 'clean-main',
      startedAt: '2026-10-16T00:00:00.000Z',
      node: 'v22.0.0',
      cwd: '/repo',
    });
    const execFile = jest.fn((cmd, _args, _opts, cb) => {
      process.nextTick(() => {
        if (cmd === 'pm2') {
          cb(null, JSON.stringify([{
            name: 'hydi-boot',
            pm2_env: {
              status: 'online',
              pm_exec_path: '/repo/scripts/boot-agent.js',
              args: '',
              pm_cwd: '/repo',
              max_restarts: 10,
              exp_backoff_restart_delay: 1000,
              kill_timeout: 20000,
            },
          }]));
          return;
        }
        if (cmd === 'git') {
          cb(null, `${HEAD}\n`);
          return;
        }
        cb(new Error(cmd));
      });
      return { on() {} };
    });
    const result = await collectRuntimeAudit({
      root,
      execFile,
      requireImpl: () => ({
        apps: [declared('hydi-boot', { script: 'scripts/boot-agent.js', kill_timeout: 20000 })],
      }),
    });
    fs.rmSync(root, { recursive: true, force: true });
    expect(result.overall).toBe('OK');
    expect(execFile.mock.calls.map((call) => call[0])).toEqual(['pm2', 'git']);
  });

  it('treats a non-JSON jlist as unreadable', async () => {
    const execFile = jest.fn((_cmd, _args, _opts, cb) => {
      process.nextTick(() => cb(null, 'not-json'));
      return { on() {} };
    });
    const result = await collectRuntimeAudit({
      root: os.tmpdir(),
      execFile,
      requireImpl: () => ({ apps: [] }),
    });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.ok).toBe(false);
  });

  it('normalizes a pm2 jlist record onto the declared script', () => {
    const runningProcs = normalizePm2List([{
      name: 'hydi-daemon',
      pm2_env: {
        status: 'online',
        pm_exec_path: 'C:\\repo\\scripts\\heidi-daemon-launcher.js',
        args: ['--no-stabilization'],
        pm_cwd: 'C:\\repo',
        max_restarts: 10,
        exp_backoff_restart_delay: 1000,
        kill_timeout: 50000,
      },
    }]);
    const result = auditDrift({
      pm2Readable: true,
      repoHead: HEAD,
      declared: [declared('hydi-daemon', {
        script: 'scripts/heidi-daemon-launcher.js',
        args: '--no-stabilization',
        cwd: 'C:\\repo',
        kill_timeout: 50000,
      })],
      running: runningProcs,
      provenance: { 'hydi-daemon': { gitSha: HEAD, gitDirty: false } },
    });
    expect(result.rows[0].verdict).toBe('OK');
  });
});

describe('ecosystem declarations for the long-running processes', () => {
  const apps = require('../../ecosystem.config.js').apps;
  const names = apps.map((app) => app.name);

  it('declares the commands that are unambiguous in git', () => {
    const tick = apps.find((app) => app.name === 'hydi-revenue-autopilot-tick');
    const stripe = apps.find((app) => app.name === 'hydi-stripe-webhook-listener');
    const localCi = apps.find((app) => app.name === 'hydi-local-ci');
    expect(tick.script).toBe('node_modules/tsx/dist/cli.mjs');
    expect(tick.args).toBe('scripts/revenue-autopilot-tick.ts');
    expect(stripe.script).toBe('scripts/stripe-webhook-listener.js');
    expect(String(localCi.args)).toContain('--watch --include-main --interval 10');
    for (const app of [tick, stripe, localCi]) {
      expect(app.exp_backoff_restart_delay).toBe(1000);
      expect(app.max_restarts).toBe(10);
      expect(app.autorestart).toBe(true);
    }
  });

  it('does not declare the public tunnel or processes whose command line is not in git', () => {
    expect(names).not.toContain('hydi-public-tunnel');
    expect(names).not.toContain('hydi-daily-loop');
    expect(names).not.toContain('rezonate-app');
    expect(names).not.toContain('job-executor-poller');
  });
});
