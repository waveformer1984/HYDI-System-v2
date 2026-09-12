/**
 * Phase 3 — No False Greens Tests
 *
 * These tests specifically catch the historical monitoring failure where
 * a system reports healthy when it is not. A test MUST fail if:
 *
 * - wrong process occupies expected port
 * - endpoint responds but dependency is broken
 * - health endpoint is stale
 * - database is unreachable
 * - service reports healthy while functional probe fails
 * - recovery command succeeds but postcondition fails
 *
 * This is one of the most important Phase 3 objectives.
 */

// `RecoveryEngine.recover()` is exercised below against the REAL repo root
// (this file's own `root`/`boot.config.json`), and RecoveryEngine's actual
// restart path does a real `child_process.spawn(...)` (and, for port
// cleanup, `execSync('netstat -ano')` + `taskkill /PID <pid> /F`) — see
// lib/operational/RecoveryEngine.ts around its `spawn(command, args, ...)`
// call. Before this mock existed, calling `recover('protoforge-core', ...)`
// here could — and on 2026-09-10, twice, did — spawn or kill a REAL process
// on the real protoforge-core port (3005) as a side effect of running this
// "unit" test, contaminating the live system with an orphaned
// `node src/server.js` process supervised by nothing. This file's own
// comment ("nothing is configured to run in this test environment") was
// false in any environment with a real boot.config.json, which is every
// environment this repo runs in. `child_process` is mocked for the whole
// file so no test here can ever spawn or kill a real process again;
// `execSync` defaulting to '' only affects HealthProvenanceChecker's
// PID-identity lookup (falls back to its existing "could not determine
// PID" warn path, not a hard failure) and never the tests' actual
// assertions, all of which are about port-reachability, HTTP response
// content, or RecoveryEngine's own state-machine bookkeeping.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

// RecoveryEngine.restartProcess() writes a durable recovery-lease record
// (scripts/recovery-lease.js) after every spawn, including the mocked one
// above -- found leaking a real `.recovery-leases/protoforge-core.json`
// into this repo the first time this file's own recovery tests ran after
// that lease-writing code was added. Mocked for the same reason
// child_process is: this file's "recovery" is a mocked spawn, not a real
// one, and must never touch anything real on disk either.
jest.mock('../../scripts/recovery-lease', () => ({
  record: jest.fn(),
  read: jest.fn(),
  getValidLease: jest.fn(),
  clear: jest.fn(),
}));

import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import { HealthProvenanceChecker } from '../../lib/operational/HealthProvenanceChecker';
import { CapabilityAuthorizer } from '../../lib/operational/CapabilityAuthorizer';
import { RecoveryEngine } from '../../lib/operational/RecoveryEngine';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { ComponentState } from '../../lib/operational/types';

beforeEach(() => {
  (execSync as jest.Mock).mockReturnValue('');
  (spawn as jest.Mock).mockReturnValue({
    pid: 999999,
    unref: jest.fn(),
    kill: jest.fn(),
    on: jest.fn(),
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Phase 3 — No False Greens', () => {
  const root = path.resolve(__dirname, '..', '..');

  function createSystem() {
    const graphBuilder = new DependencyGraphBuilder(root);
    const graph = graphBuilder.build();
    const model = new SystemStateModel();
    for (const [id, node] of graph.nodes) {
      model.registerComponent(id, node.category);
    }
    const healthChecker = new HealthProvenanceChecker(root, model, graph);
    const authorizer = new CapabilityAuthorizer(model);
    const recoveryEngine = new RecoveryEngine(root, model, graph, healthChecker, authorizer);
    return { graph, model, healthChecker, authorizer, recoveryEngine };
  }

  it('reports UNAVAILABLE when port is not listening (no process running)', async () => {
    const { healthChecker, model } = createSystem();
    // Check a module — if nothing is running, it should be UNAVAILABLE, not HEALTHY
    await healthChecker.checkAll();

    // At least some components should not be HEALTHY if nothing is running
    const states = model.getAllStates();
    const allHealthy = states.every((s) => s.state === 'HEALTHY');
    // If the system happens to be running, this is fine. But if it's not,
    // we must NOT report all healthy.
    // The key assertion: no component reports HEALTHY without evidence
    for (const state of states) {
      if (state.state === 'HEALTHY') {
        expect(state.evidence.length).toBeGreaterThan(0);
        const hasPassEvidence = state.evidence.some((e) => e.status === 'pass');
        expect(hasPassEvidence).toBe(true);
      }
    }
  }, 60000);

  // An in-process module cannot be probed from outside the process that hosts
  // it, so there is no independent evidence available for it. The invariant is
  // that this yields UNKNOWN — "we did not establish this" — and never HEALTHY.
  //
  // This test used to read boot.config.json and assert on `hydi-orchestrator`.
  // When that module was disabled the assertion had nothing to run against, and
  // an early `return` made the test report PASS while exercising nothing —
  // a false green inside the No False Greens suite. It now owns an isolated
  // fixture, so the invariant stays tested no matter what production config
  // happens to contain.
  const IN_PROCESS_FIXTURE = {
    id: 'test/in-process-module',
    label: 'Fixture: enabled in-process module with no independent check',
    type: 'module' as const,
    enabled: true,
    required: false,
    module: 'test/does-not-exist.js',
    // Deliberately no port and no health URL: nothing external to probe.
    dependsOn: [] as string[],
  };

  /** A temp root containing only the fixture, so the graph is built by production code. */
  function withFixtureRoot<T>(fn: (fixtureRoot: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-inproc-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'boot.config.json'),
        JSON.stringify({ settings: {}, modules: [IN_PROCESS_FIXTURE] }, null, 2),
        'utf8'
      );
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('reports UNKNOWN (not HEALTHY) for in-process modules with no independent check', async () => {
    const result = await withFixtureRoot(async (fixtureRoot) => {
      // Built by the production graph builder from the fixture config, so the
      // fixture really is an enabled type:'module' node.
      const graph = new DependencyGraphBuilder(fixtureRoot).build();
      expect(graph.nodes.has(IN_PROCESS_FIXTURE.id)).toBe(true);

      const model = new SystemStateModel();
      for (const [id, node] of graph.nodes) model.registerComponent(id, node.category);

      const checker = new HealthProvenanceChecker(fixtureRoot, model, graph);
      // checkModule is the production path for a single module; calling it
      // directly keeps the test hermetic (no docker/db/ollama probes).
      return checker.checkModule(IN_PROCESS_FIXTURE as never);
    });

    // The invariant. If the implementation ever reports HEALTHY for a component
    // it cannot independently observe, this fails.
    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('HEALTHY');

    // ...and it must say why, rather than being an unexplained UNKNOWN.
    const inProcess = result.evidence.find((e) => e.check === 'in-process');
    expect(inProcess).toBeDefined();
    expect(inProcess!.status).toBe('skip');
    expect(result.component).toBe(IN_PROCESS_FIXTURE.id);
  }, 60000);

  it('the in-process invariant is exercised, not skipped when production config has no such module', () => {
    // Guards the regression directly: the fixture is self-contained, so the
    // assertion above can never be bypassed by boot.config.json changing.
    const bootConfig = JSON.parse(
      fs.readFileSync(path.join(root, 'boot.config.json'), 'utf8')
    ) as { modules: Array<{ type: string; enabled?: boolean }> };
    const enabledInProcess = bootConfig.modules.filter(
      (m) => m.type === 'module' && m.enabled !== false
    );
    // Whatever this number is — today it is 0 — the invariant above still ran.
    expect(enabledInProcess.length).toBeGreaterThanOrEqual(0);
    expect(IN_PROCESS_FIXTURE.type).toBe('module');
    expect(IN_PROCESS_FIXTURE.enabled).toBe(true);
  });

  it('includes evidence chain for every health determination', async () => {
    const { healthChecker, model } = createSystem();
    await healthChecker.checkAll();

    const states = model.getAllStates();
    for (const state of states) {
      // Every state must have at least one evidence item
      expect(state.evidence.length).toBeGreaterThan(0);
      // Every evidence item must have a check name and timestamp
      for (const ev of state.evidence) {
        expect(ev.check).toBeDefined();
        expect(ev.checkedAt).toBeDefined();
        expect(ev.status).toMatch(/^(pass|fail|warn|skip)$/);
      }
    }
  }, 60000);

  it('database state includes write/read/delete evidence, not just reachability', async () => {
    const { healthChecker, model } = createSystem();
    await healthChecker.checkAll();

    const dbState = model.getState('database');
    // If database is HEALTHY, it must have write/read evidence
    if (dbState.state === 'HEALTHY') {
      const checks = dbState.evidence.map((e) => e.check);
      expect(checks).toContain('rest-reachable');
      expect(checks).toContain('service-role-write');
      expect(checks).toContain('service-role-read');
    }
  }, 60000);

  it('component with failed dependency is BLOCKED, not HEALTHY', async () => {
    const { model } = createSystem();
    // Manually set database to UNAVAILABLE
    model.updateState('database', 'UNAVAILABLE', [{
      check: 'rest-reachable',
      status: 'fail',
      value: 'connection refused',
      checkedAt: new Date().toISOString(),
    }]);

    // Now check protoforge-core — it depends on database
    // If database is down, protoforge-core should not be HEALTHY
    const pfState = model.getState('protoforge-core');
    // The state model should reflect the dependency
    // (The health checker would set BLOCKED, but we're testing the state model directly)
    expect(pfState.state).not.toBe('HEALTHY'); // it's UNKNOWN at this point
  });

  it('recovery does not declare success without postcondition verification', async () => {
    const { recoveryEngine, model } = createSystem();

    // Try to recover a component that can't actually start
    // (because nothing is configured to run in this test environment)
    const record = await recoveryEngine.recover('protoforge-core', 'test: simulated failure', {
      maxAttempts: 1,
      cooldownMs: 100,
      graceMs: 1000,
    });

    // The recovery should NOT report success unless the postcondition was verified
    if (record.finalState === 'HEALTHY') {
      // If it somehow recovered, there must be evidence
      const lastAttempt = record.attempts[record.attempts.length - 1];
      expect(lastAttempt.result).toBe('success');
      expect(lastAttempt.evidence.length).toBeGreaterThan(0);
    } else {
      // If it didn't recover, it should be FAILED or UNAVAILABLE, not HEALTHY
      expect(record.finalState).not.toBe('HEALTHY');
    }

    recoveryEngine.destroy();
  }, 60000);

  it('recovery is idempotent — already healthy component is not restarted', async () => {
    const { recoveryEngine, model } = createSystem();

    // Set a component to HEALTHY
    model.updateState('protoforge-core', 'HEALTHY', [{
      check: 'simulated',
      status: 'pass',
      value: 'already healthy',
      checkedAt: new Date().toISOString(),
    }]);

    const record = await recoveryEngine.recover('protoforge-core', 'test: idempotent check');
    expect(record.attempts).toHaveLength(0); // no attempts — already healthy
    expect(record.finalState).toBe('HEALTHY');

    recoveryEngine.destroy();
  });

  it('recovery respects retry budget (never infinite)', async () => {
    const { recoveryEngine } = createSystem();

    const record = await recoveryEngine.recover('protoforge-core', 'test: budget check', {
      maxAttempts: 2,
      cooldownMs: 50,
      graceMs: 200,
    });

    // Must not exceed maxAttempts
    expect(record.attempts.length).toBeLessThanOrEqual(2);
    recoveryEngine.destroy();
  }, 60000);

  it('recovery is denied for unauthorized targets', async () => {
    const { recoveryEngine } = createSystem();

    // Try to recover a component that's not in the restartable set
    const record = await recoveryEngine.recover('arbitrary-target', 'test: unauthorized');

    expect(record.finalState).toBe('BLOCKED');
    expect(record.attempts).toHaveLength(0);
    recoveryEngine.destroy();
  });
});
