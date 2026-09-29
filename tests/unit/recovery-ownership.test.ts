/**
 * RecoveryEngine.restartProcess ownership tests (Phase 2A).
 *
 * Defect (measured 2026-09-18, HYDI_BASELINE.json):
 *   restartProcess() spawned replacements `{shell:true, detached:true}` +
 *   `unref()`. The recovered process was therefore not a child of boot-agent,
 *   so boot-agent could not watch it for `exit` and the supervisor could not
 *   stop it. Observed result: protoforge-core and heidi-web were ORPHAN with
 *   DEAD ancestry; heidi-mobile-chat was owned only because it had never been
 *   recovered. Every recovery converted a supervised module into an orphan.
 *
 * Fix under test: when a boot authority is alive, the *spawn* is delegated to
 * it through scripts/boot-control, so ownership is preserved. RecoveryEngine
 * keeps the policy decision (SUPERVISION_MODEL.md's division is unchanged);
 * only the mechanism moves. When no boot authority is running — the standalone
 * `hydi:recover` CLI case — the detached spawn remains, but must be explicitly
 * labelled unowned rather than reported as a clean restart.
 *
 * child_process is mocked for the whole file: restartProcess() really calls
 * execSync('netstat -ano') and spawn(), and this suite must never touch the
 * live process tree (a real heidi-web may be listening on port 3000).
 */

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock('../../scripts/boot-control', () => ({
  isBootAuthorityAlive: jest.fn(),
  requestRestart: jest.fn(),
  waitForAck: jest.fn(),
  clearRequest: jest.fn(),
  isPidAlive: jest.fn(),
}));

jest.mock('../../scripts/recovery-lease', () => ({
  record: jest.fn(),
}));

import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import { HealthProvenanceChecker } from '../../lib/operational/HealthProvenanceChecker';
import { CapabilityAuthorizer } from '../../lib/operational/CapabilityAuthorizer';
import { RecoveryEngine } from '../../lib/operational/RecoveryEngine';
import { AutonomyPolicyModel } from '../../lib/operational/AutonomyPolicyModel';
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';
import { RecoveryLockManager } from '../../lib/operational/RecoveryLock';
import { PolicyDecisionRecordStore } from '../../lib/operational/PolicyDecisionRecord';
import { EscalationManager } from '../../lib/operational/EscalationManager';

const bootControl = require('../../scripts/boot-control');
const recoveryLease = require('../../scripts/recovery-lease');

const mockSpawn = spawn as jest.Mock;
const mockExecSync = execSync as jest.Mock;

function fakeChild(pid = 4242) {
  return { pid, unref: jest.fn(), kill: jest.fn(), on: jest.fn() };
}

describe('RecoveryEngine.restartProcess — process ownership', () => {
  const root = path.resolve(__dirname, '..', '..');

  function createEngine() {
    const graph = new DependencyGraphBuilder(root).build();
    const model = new SystemStateModel();
    for (const [id, node] of graph.nodes) model.registerComponent(id, node.category);
    const healthChecker = new HealthProvenanceChecker(root, model, graph);
    const authorizer = new CapabilityAuthorizer(model);
    const policyModel = new AutonomyPolicyModel();
    const budgetManager = new RecoveryBudgetManager(model);
    const lockManager = new RecoveryLockManager(model);
    const decisionStore = new PolicyDecisionRecordStore(
      fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-ownership-test-'))
    );
    const escalationManager = new EscalationManager(model, decisionStore);
    const recoveryEngine = new RecoveryEngine(
      root, model, graph, healthChecker, authorizer,
      policyModel, budgetManager, lockManager, escalationManager, decisionStore,
    );
    return { model, recoveryEngine };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecSync.mockReturnValue('');
    mockSpawn.mockReturnValue(fakeChild());
    // The ack-verification seam: default to a trustworthy-looking ack so the
    // success tests pass; individual tests override to model a fabricated one.
    bootControl.isPidAlive.mockReturnValue(true);
  });

  // A delegated restart now verifies the ack (live pid + boot-agent ownership +
  // port listening) before recording owned:true. Stub portListening so the
  // success cases don't depend on a real listener existing in the test env.
  function trustVerification(recoveryEngine: any) {
    jest.spyOn(recoveryEngine as any, 'portListening').mockResolvedValue(true);
  }

  test('O1: with a live boot authority the spawn is DELEGATED, never done locally', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(true);
    bootControl.requestRestart.mockReturnValue({ id: 'req-1', component: 'protoforge-core' });
    bootControl.waitForAck.mockResolvedValue({ id: 'req-1', status: 'completed', pid: 777, ownedBy: 'boot-agent' });

    const { recoveryEngine } = createEngine();
    trustVerification(recoveryEngine);
    await (recoveryEngine as any).restartProcess('protoforge-core');

    expect(bootControl.requestRestart).toHaveBeenCalledWith(
      'protoforge-core',
      expect.objectContaining({ requestedBy: expect.stringContaining('RecoveryEngine') })
    );
    // The orphan-making path must not run at all.
    expect(mockSpawn).not.toHaveBeenCalled();
    // boot-agent owns it now, so no recovery lease is needed to explain a stray.
    expect(recoveryLease.record).not.toHaveBeenCalled();
  });

  test('O2: a delegated restart is logged as owned, with the owning pid', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(true);
    bootControl.requestRestart.mockReturnValue({ id: 'req-2', component: 'heidi-web' });
    bootControl.waitForAck.mockResolvedValue({ id: 'req-2', status: 'completed', pid: 888, ownedBy: 'boot-agent' });

    const { model, recoveryEngine } = createEngine();
    trustVerification(recoveryEngine);
    await (recoveryEngine as any).restartProcess('heidi-web');

    const events = model.getEventLog().filter((e: any) => e.component === 'heidi-web');
    const delegated = events.find((e: any) => e.action === 'process_restart_delegated');
    expect(delegated).toBeDefined();
    expect(delegated!.actionResult).toBe('success');
    expect((delegated!.detail as any).pid).toBe(888);
    expect((delegated!.detail as any).ownedBy).toBe('boot-agent');
  });

  test('O3: a delegated restart that FAILS throws and does not fall back to an orphan spawn', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(true);
    bootControl.requestRestart.mockReturnValue({ id: 'req-3', component: 'protoforge-core' });
    bootControl.waitForAck.mockResolvedValue({ id: 'req-3', status: 'failed', error: 'port still held' });

    const { recoveryEngine } = createEngine();
    await expect((recoveryEngine as any).restartProcess('protoforge-core')).rejects.toThrow(/port still held|failed/i);

    // Falling back to a detached spawn here would "succeed" by recreating the
    // exact defect this change exists to remove. It must not happen.
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('O4: a delegated restart that TIMES OUT throws — silence is not success', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(true);
    bootControl.requestRestart.mockReturnValue({ id: 'req-4', component: 'heidi-web' });
    bootControl.waitForAck.mockResolvedValue({ id: 'req-4', status: 'timeout' });

    const { recoveryEngine } = createEngine();
    await expect((recoveryEngine as any).restartProcess('heidi-web')).rejects.toThrow(/timeout|did not acknowledge/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('O4b: a FABRICATED "completed" ack (dead pid) is rejected, not recorded as owned', async () => {
    // Red-team 2026-09-18: the control dir is same-user writable, so a planted
    // {status:'completed', pid:<nonexistent>} ack must not be trusted. The
    // delegated path now verifies the claimed pid is actually alive.
    bootControl.isBootAuthorityAlive.mockReturnValue(true);
    bootControl.requestRestart.mockReturnValue({ id: 'req-x', component: 'protoforge-core' });
    bootControl.waitForAck.mockResolvedValue({ id: 'req-x', status: 'completed', pid: 424242, ownedBy: 'boot-agent' });
    bootControl.isPidAlive.mockReturnValue(false); // the claimed pid does not exist

    const { model, recoveryEngine } = createEngine();
    jest.spyOn(recoveryEngine as any, 'portListening').mockResolvedValue(false); // hermetic: no real connect
    await expect((recoveryEngine as any).restartProcess('protoforge-core')).rejects.toThrow(/did not verify|dead|mismatched/i);

    const events = model.getEventLog().filter((e: any) => e.component === 'protoforge-core');
    const success = events.find((e: any) => e.action === 'process_restart_delegated' && e.actionResult === 'success');
    expect(success).toBeUndefined(); // never logged as an owned success
    expect(mockSpawn).not.toHaveBeenCalled(); // and no orphan fallback either
  });

  test('O5: with NO boot authority the detached spawn still happens (standalone CLI recovery)', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(false);

    const { recoveryEngine } = createEngine();
    await (recoveryEngine as any).restartProcess('protoforge-core');

    expect(bootControl.requestRestart).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalled();
    // The lease is what lets boot-agent later classify it as 'recovered'
    // rather than an unidentified stray.
    expect(recoveryLease.record).toHaveBeenCalled();
  });

  test('O6: the detached fallback is labelled UNOWNED, not reported as a clean restart', async () => {
    bootControl.isBootAuthorityAlive.mockReturnValue(false);

    const { model, recoveryEngine } = createEngine();
    await (recoveryEngine as any).restartProcess('protoforge-core');

    const events = model.getEventLog().filter((e: any) => e.component === 'protoforge-core');
    const spawned = events.find((e: any) => e.action === 'process_spawned_unowned');
    expect(spawned).toBeDefined();
    expect((spawned!.detail as any).owned).toBe(false);
    expect((spawned!.detail as any).ownershipWarning).toMatch(/not a child of the boot authority/i);
  });
});
