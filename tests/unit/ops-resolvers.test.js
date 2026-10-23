'use strict';

/**
 * Ops resolvers — the governed implementation of the human-action backlog:
 *   runtime.reconcile       PM2 restart-class fixes only; human actions for
 *                           everything a resolver must not touch
 *   cost.audit              daily strict $0 guard; failures mint per-key
 *                           human actions (names only)
 *   phone.phantom_killer_off adb settings write + read-back
 *   phone.thin_client        adb push + R3 Termux handoff
 *
 * Every resolver is exercised through its injected deps seams — no real
 * pm2, adb, node child process, or durable store is touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { HumanActionService } = require('../../lib/human-actions/service');
const { getResolver } = require('../../lib/human-actions/resolvers');
const { classifyAction } = require('../../lib/human-actions/resolver-policy');
const { runVerifier } = require('../../lib/human-actions/verifiers');

let dir;
let storeFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-resolvers-'));
  storeFile = path.join(dir, 'human-actions.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = storeFile;
});

afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
});

const mkEnv = (vals = {}) => ({
  envNamePresent: (n) => vals[n] !== undefined && vals[n] !== '',
  envValue: (n) => vals[n] ?? null,
});

const actionFor = (blockerKey) => ({ id: 'ha_test', blockerKey });
const policyFor = (blockerKey) => ({ resolverId: blockerKey, scope: classifyAction({ blockerKey }).scope || {} });

// ─── runtime.reconcile ──────────────────────────────────────────────────

describe('runtime.reconcile', () => {
  const resolver = getResolver('runtime.reconcile');
  const policy = { resolverId: 'runtime.reconcile', scope: { allowedVerdicts: ['STALE_CODE', 'CONFIG_DRIFT'], maxPerAttempt: 3 } };

  const auditWith = (rows, overall) => ({
    overall: overall || 'DRIFT',
    counts: {},
    rows: rows.map(([name, verdict]) => ({ name, verdict, verdicts: [verdict] })),
  });

  test('dry-run reports the plan and calls no pm2', async () => {
    const calls = [];
    const r = await resolver({
      action: actionFor('runtime:drift'), policy, env: mkEnv(),
      deps: {
        dryRun: true,
        collectAudit: async () => auditWith([['a', 'STALE_CODE'], ['b', 'UNDECLARED']]),
        runPm2: async (args) => { calls.push(args); return { ok: true }; },
        service: new HumanActionService(),
      },
    });
    expect(r.outcome).toBe('partial');
    expect(calls).toHaveLength(0);
    expect(r.evidence.wouldApply).toEqual(['a']);
  });

  test('audit UNKNOWN touches nothing and reports failed', async () => {
    const calls = [];
    const r = await resolver({
      action: actionFor('runtime:drift'), policy, env: mkEnv(),
      deps: { collectAudit: async () => ({ overall: 'UNKNOWN', rows: [] }), runPm2: async (a) => { calls.push(a); return { ok: true }; } },
    });
    expect(r.outcome).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('STALE_CODE restarts; CONFIG_DRIFT re-materializes; UNDECLARED becomes a human action and is never touched', async () => {
    const calls = [];
    const svc = new HumanActionService();
    const r = await resolver({
      action: actionFor('runtime:drift'), policy, env: mkEnv(),
      deps: {
        collectAudit: jest.fn()
          .mockResolvedValueOnce(auditWith([['stale', 'STALE_CODE'], ['drifted', 'CONFIG_DRIFT'], ['rogue', 'UNDECLARED']]))
          .mockResolvedValueOnce({ overall: 'OK', counts: {}, rows: [] }),
        runPm2: async (args) => { calls.push(args); return { ok: true }; },
        service: svc,
      },
    });
    expect(calls).toEqual([
      ['restart', 'stale'],
      ['delete', 'drifted'],
      ['start', 'ecosystem.config.js', '--only', 'drifted'],
    ]);
    expect(r.outcome).toBe('completed');
    const raised = svc.list({ includeTerminal: true }).filter((a) => a.blockerKey === 'runtime:undeclared:rogue');
    expect(raised).toHaveLength(1);
    expect(raised[0].verifier.name).toBe('runtime-row-absent');
  });

  test('MISSING rows raise human actions — a resolver never starts a deliberately-stopped app', async () => {
    const calls = [];
    const svc = new HumanActionService();
    await resolver({
      action: actionFor('runtime:drift'), policy, env: mkEnv(),
      deps: {
        collectAudit: async () => auditWith([['hydi-local-ci', 'MISSING']]),
        runPm2: async (args) => { calls.push(args); return { ok: true }; },
        service: svc,
      },
    });
    expect(calls).toHaveLength(0);
    expect(svc.list({ includeTerminal: true }).some((a) => a.blockerKey === 'runtime:missing:hydi-local-ci')).toBe(true);
  });

  test('bounds each attempt to maxPerAttempt processes', async () => {
    const calls = [];
    const many = Array.from({ length: 5 }, (_, i) => [`proc${i}`, 'STALE_CODE']);
    await resolver({
      action: actionFor('runtime:drift'), policy, env: mkEnv(),
      deps: {
        collectAudit: async () => auditWith(many),
        runPm2: async (args) => { calls.push(args); return { ok: true }; },
        service: new HumanActionService(),
      },
    });
    expect(calls).toHaveLength(3);
  });
});

// ─── cost.audit ─────────────────────────────────────────────────────────

describe('cost.audit', () => {
  const resolver = getResolver('cost.audit');
  const policy = { resolverId: 'cost.audit', scope: { statePath: null } };
  const statePath = () => path.join(dir, 'cost-state.json');

  test('fresh state defers — no daily re-run inside the interval', async () => {
    fs.writeFileSync(statePath(), JSON.stringify({ ranAt: new Date().toISOString(), ok: true }));
    const runs = [];
    const r = await resolver({
      action: actionFor('cost:daily-guard'),
      policy: { resolverId: 'cost.audit', scope: { statePath: statePath() } },
      env: mkEnv(),
      deps: { runCommand: async () => { runs.push(1); return { code: 0, stdout: '' }; } },
    });
    expect(r.outcome).toBe('deferred');
    expect(runs).toHaveLength(0);
  });

  test('clean strict run completes and writes state', async () => {
    const r = await resolver({
      action: actionFor('cost:daily-guard'),
      policy: { resolverId: 'cost.audit', scope: { statePath: statePath() } },
      env: mkEnv(),
      deps: { runCommand: async () => ({ code: 0, stdout: 'all clear\n' }) },
    });
    expect(r.outcome).toBe('completed');
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    expect(state.ok).toBe(true);
  });

  test('strict failure raises per-key human actions naming keys and sources only', async () => {
    const svc = new HumanActionService();
    const stdout = [
      'Paid-provider keys set (each one turns on billable fallbacks):',
      '  OPENAI_API_KEY         OpenAI      in .env.local',
      '',
      'STRICT FAIL: HYDI_ALLOW_PAID_LLM=true — paid model spend is enabled.',
    ].join('\n');
    const r = await resolver({
      action: actionFor('cost:daily-guard'),
      policy: { resolverId: 'cost.audit', scope: { statePath: statePath() } },
      env: mkEnv(),
      deps: { runCommand: async () => ({ code: 1, stdout }), service: svc },
    });
    expect(r.outcome).toBe('failed');
    const keys = svc.list({ includeTerminal: true }).map((a) => a.blockerKey).sort();
    expect(keys).toContain('cost:paid-key:OPENAI_API_KEY');
    expect(keys).toContain('cost:paid-key:HYDI_ALLOW_PAID_LLM');
    const openAi = svc.list({ includeTerminal: true }).find((a) => a.blockerKey === 'cost:paid-key:OPENAI_API_KEY');
    expect(openAi.description).toContain('.env.local');
    expect(JSON.stringify(openAi)).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

// ─── phone.phantom_killer_off ───────────────────────────────────────────

describe('phone.phantom_killer_off', () => {
  const resolver = getResolver('phone.phantom_killer_off');
  const policy = { resolverId: 'phone.phantom_killer_off', scope: { setting: 'settings_enable_monitor_phantom_procs', value: 'false' } };
  const NO_DEVICE = { ok: true, code: 0, stdout: 'List of devices attached\n\n' };
  const ONE_DEVICE = { ok: true, code: 0, stdout: 'List of devices attached\nemulator-5554\tdevice\n' };

  test('no device defers and raises the physical usb-debugging action', async () => {
    const svc = new HumanActionService();
    const calls = [];
    const r = await resolver({
      action: actionFor('phone:phantom-killer'), policy, env: mkEnv(),
      deps: {
        adbExec: async (args) => { calls.push(args); return NO_DEVICE; },
        service: svc,
      },
    });
    expect(r.outcome).toBe('deferred');
    expect(calls).toEqual([['devices']]);
    expect(svc.list({ includeTerminal: true }).some((a) => a.blockerKey === 'phone:usb-debugging')).toBe(true);
  });

  test('device present: writes the flag, verifies read-back, completes', async () => {
    const seen = [];
    const r = await resolver({
      action: actionFor('phone:phantom-killer'), policy, env: mkEnv(),
      deps: {
        adbExec: async (args) => {
          seen.push(args[1] === 'devices' ? 'devices' : args.slice(1, 5).join(' '));
          if (args[0] === 'devices') return ONE_DEVICE;
          if (args[2] === 'get') return { ok: true, code: 0, stdout: 'false\n' };
          return { ok: true, code: 0, stdout: '' };
        },
        service: new HumanActionService(),
      },
    });
    expect(r.outcome).toBe('completed');
    expect(r.evidence.value).toBe('false');
  });

  test('read-back mismatch fails honestly', async () => {
    const r = await resolver({
      action: actionFor('phone:phantom-killer'), policy, env: mkEnv(),
      deps: {
        adbExec: async (args) => {
          if (args[0] === 'devices') return ONE_DEVICE;
          if (args[2] === 'get') return { ok: true, code: 0, stdout: 'true\n' };
          return { ok: true, code: 0, stdout: '' };
        },
        service: new HumanActionService(),
      },
    });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toContain('true');
  });
});

// ─── phone.thin_client ──────────────────────────────────────────────────

describe('phone.thin_client', () => {
  const resolver = getResolver('phone.thin_client');
  const srcDir = () => dir;

  function policyForPush() {
    fs.mkdirSync(path.join(dir, 'termux'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'termux', 'setup-thin-client.sh'), '#!/bin/sh\necho ok\n');
    return { resolverId: 'phone.thin_client', scope: { src: 'termux/setup-thin-client.sh', dst: '/sdcard/Download/' } };
  }

  test('dry-run pushes nothing', async () => {
    policyForPush();
    const calls = [];
    const r = await resolver({
      action: actionFor('phone:thin-client'),
      policy: { resolverId: 'phone.thin_client', scope: { src: 'termux/setup-thin-client.sh' } },
      env: mkEnv(),
      deps: { dryRun: true, root: srcDir(), adbExec: async (a) => { calls.push(a); return { ok: true, stdout: '' }; } },
    });
    expect(r.outcome).toBe('partial');
    expect(calls).toHaveLength(0);
  });

  test('missing script fails closed', async () => {
    const r = await resolver({
      action: actionFor('phone:thin-client'),
      policy: { resolverId: 'phone.thin_client', scope: { src: 'termux/nope.sh' } },
      env: mkEnv(), deps: { root: dir },
    });
    expect(r.outcome).toBe('failed');
  });

  test('attached device: pushes and raises the R3 Termux action', async () => {
    policyForPush();
    const svc = new HumanActionService();
    const calls = [];
    const r = await resolver({
      action: actionFor('phone:thin-client'),
      policy: { resolverId: 'phone.thin_client', scope: { src: 'termux/setup-thin-client.sh', dst: '/sdcard/Download/' } },
      env: mkEnv(),
      deps: {
        root: dir,
        adbExec: async (args) => {
          calls.push(args);
          if (args[0] === 'devices') return { ok: true, code: 0, stdout: 'List of devices attached\nabc\tdevice\n' };
          return { ok: true, code: 0, stdout: 'x' };
        },
        service: svc,
      },
    });
    expect(r.outcome).toBe('partial');
    expect(calls[1][0]).toBe('push');
    expect(svc.list({ includeTerminal: true }).some((a) => a.blockerKey === 'phone:run-thin-client-setup')).toBe(true);
  });
});

// ─── verifiers ──────────────────────────────────────────────────────────

describe('ops verifiers', () => {
  test('runtime-audit-clean passes only on overall OK', async () => {
    const bad = await runVerifier('runtime-audit-clean', {}, { collectAudit: async () => ({ overall: 'DRIFT', rows: [{ name: 'x', verdict: 'STALE_CODE' }], counts: {} }) });
    expect(bad.passed).toBe(false);
    const good = await runVerifier('runtime-audit-clean', {}, { collectAudit: async () => ({ overall: 'OK', rows: [], counts: {} }) });
    expect(good.passed).toBe(true);
  });

  test('runtime-row-absent passes when the named row is gone or OK', async () => {
    const r = await runVerifier('runtime-row-absent', { name: 'gone' }, { collectAudit: async () => ({ overall: 'OK', rows: [] }) });
    expect(r.passed).toBe(true);
    const still = await runVerifier('runtime-row-absent', { name: 'rogue' }, { collectAudit: async () => ({ overall: 'DRIFT', rows: [{ name: 'rogue', verdict: 'UNDECLARED' }] }) });
    expect(still.passed).toBe(false);
  });

  test('cost-audit-clean maps exit code to pass/fail', async () => {
    const pass = await runVerifier('cost-audit-clean', {}, { runCommand: async () => ({ code: 0, stdout: '' }) });
    expect(pass.passed).toBe(true);
    const fail = await runVerifier('cost-audit-clean', {}, { runCommand: async () => ({ code: 1, stdout: 'STRICT FAIL' }) });
    expect(fail.passed).toBe(false);
  });

  test('phone-adb-attached requires an authorized device', async () => {
    const none = await runVerifier('phone-adb-attached', {}, { adbExec: async () => ({ ok: true, stdout: 'List of devices attached\n\n' }) });
    expect(none.passed).toBe(false);
    const one = await runVerifier('phone-adb-attached', {}, { adbExec: async () => ({ ok: true, stdout: 'List of devices attached\np1\tdevice\n' }) });
    expect(one.passed).toBe(true);
  });

  test('phone-phantom-off reads the setting back', async () => {
    const off = await runVerifier('phone-phantom-off', {}, {
      adbExec: async (args) => args[0] === 'devices'
        ? { ok: true, stdout: 'List of devices attached\np1\tdevice\n' }
        : { ok: true, stdout: 'false\n' },
    });
    expect(off.passed).toBe(true);
    const noDevice = await runVerifier('phone-phantom-off', {}, { adbExec: async () => ({ ok: true, stdout: 'List of devices attached\n\n' }) });
    expect(noDevice.passed).toBe(false);
  });

  test('phone-thin-client wants :8080 dead and phone traffic in the ollama log', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-log-'));
    const logPath = path.join(logDir, 'server.log');
    fs.writeFileSync(logPath, 'listening\nreq from 100.87.215.90 ok\n');
    const deps = {
      envValue: (n) => (n === 'PHONE_TAILNET_HOST' ? '100.87.215.90' : null),
      fetch: async () => { const e = new Error('ECONNREFUSED'); throw e; },
      fs,
    };
    const r = await runVerifier('phone-thin-client', { ollamaLogPath: logPath }, deps);
    expect(r.passed).toBe(true);

    const stillServing = await runVerifier('phone-thin-client', { ollamaLogPath: logPath }, { ...deps, fetch: async () => ({ status: 200 }) });
    expect(stillServing.passed).toBe(false);
  });

  test('phone-thin-client without a configured host fails honestly', async () => {
    const r = await runVerifier('phone-thin-client', {}, { envValue: () => null, fetch: async () => ({ status: 200 }), fs });
    expect(r.passed).toBe(false);
    expect(r.failureReason).toContain('PHONE_TAILNET_HOST');
  });

  test('pm2-resurrect-observed requires a real reboot, not just a green audit', async () => {
    const armedAt = '2026-10-23T04:00:00.000Z';
    const armedMs = Date.parse(armedAt);
    const okAudit = { collectAudit: async () => ({ overall: 'OK', rows: [], counts: {} }) };
    // No reboot yet: uptime (7200s) exceeds elapsed since arming (3600s),
    // so lastBoot < armedAt → PENDING, not a pass.
    const noReboot = await runVerifier('pm2-resurrect-observed', { armedAt }, {
      ...okAudit, now: () => armedMs + 3600e3, osUptime: () => 7200,
    });
    expect(noReboot.passed).toBe(false);
    expect(noReboot.status).toBe('PENDING');
    // Rebooted since arming + audit OK → VERIFIED.
    const passed = await runVerifier('pm2-resurrect-observed', { armedAt }, {
      ...okAudit, now: () => armedMs + 7200e3, osUptime: () => 1800,
    });
    expect(passed.passed).toBe(true);
    // Rebooted but services didn't come back → FAILED.
    const drift = await runVerifier('pm2-resurrect-observed', { armedAt }, {
      collectAudit: async () => ({ overall: 'DRIFT', rows: [], counts: {} }),
      now: () => armedMs + 7200e3, osUptime: () => 1800,
    });
    expect(drift.passed).toBe(false);
    expect(drift.status).toBe('FAILED');
    // Missing armedAt → fails honestly.
    const unarmed = await runVerifier('pm2-resurrect-observed', {}, okAudit);
    expect(unarmed.passed).toBe(false);
  });
});
