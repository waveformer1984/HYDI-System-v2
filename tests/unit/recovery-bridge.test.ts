/**
 * Bridge recovery tests (RecoveryEngine.restartBridge)
 *
 * 'bridge' has no independent process: HealthProvenanceChecker.checkBridge()
 * probes heidi-web's own /api/chat endpoint (http://127.0.0.1:3000/api/chat)
 * directly -- heidi-web is the process that actually serves it. See
 * DependencyGraphBuilder.ts's bridge node and HealthProvenanceChecker.ts's
 * checkBridge() for the traced identity this implementation is built on.
 *
 * child_process is mocked in this entire file -- restartProcess() calls
 * execSync('netstat -ano', ...) and spawn(...) for real, and these tests
 * must never touch the actual OS process tree (this file may run against a
 * machine with a real heidi-web dev server listening on port 3000).
 */

// RecoveryEngine records a recovery lease (scripts/recovery-lease.js, required
// lazily at recovery time). Point it at a temp dir so the tests never leave a
// .recovery-leases/ directory in the repo.
const ORIGINAL_LEASE_DIR = process.env.RECOVERY_LEASE_DIR;
process.env.RECOVERY_LEASE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'hydi-bridge-leases-'));
afterAll(() => {
  if (ORIGINAL_LEASE_DIR === undefined) delete process.env.RECOVERY_LEASE_DIR;
  else process.env.RECOVERY_LEASE_DIR = ORIGINAL_LEASE_DIR;
});

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawn: jest.fn(),
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
import { ActionSelector } from '../../lib/operational/ActionSelector';
import { AutonomyPolicyModel } from '../../lib/operational/AutonomyPolicyModel';
import { riskClassifier } from '../../lib/operational/RiskClassifier';
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';
import { RecoveryLockManager } from '../../lib/operational/RecoveryLock';
import { PolicyDecisionRecordStore } from '../../lib/operational/PolicyDecisionRecord';
import { EscalationManager } from '../../lib/operational/EscalationManager';
import type { ComponentHealth, DependencyGraph } from '../../lib/operational/types';

const mockExecSync = execSync as jest.Mock;
const mockSpawn = spawn as jest.Mock;

function fakeChild(pid = 4242) {
  return {
    pid,
    unref: jest.fn(),
    kill: jest.fn(),
    on: jest.fn(),
  };
}

describe('RecoveryEngine bridge recovery', () => {
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
    const policyModel = new AutonomyPolicyModel();
    const budgetManager = new RecoveryBudgetManager(model);
    const lockManager = new RecoveryLockManager(model);
    const decisionStore = new PolicyDecisionRecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-bridge-test-')));
    const escalationManager = new EscalationManager(model, decisionStore);
    const actionSelector = new ActionSelector(policyModel, riskClassifier, authorizer, budgetManager, model);
    const recoveryEngine = new RecoveryEngine(
      root, model, graph, healthChecker, authorizer,
      policyModel, budgetManager, lockManager, escalationManager, decisionStore,
    );
    return { graph, model, healthChecker, authorizer, policyModel, budgetManager, lockManager, decisionStore, escalationManager, actionSelector, recoveryEngine };
  }

  function makeBridgeHealth(state: ComponentHealth['state'], dependencies?: Record<string, string>): ComponentHealth {
    return {
      component: 'bridge',
      category: 'bridge',
      state,
      // AutonomyPolicyModel's policy.recover.bridge requires evidence named
      // exactly 'health-endpoint' (its requiredEvidence field) to authorize.
      evidence: [{ check: 'health-endpoint', status: state === 'HEALTHY' ? 'pass' : 'fail', value: 'test', checkedAt: new Date().toISOString() }],
      dependencies: dependencies as any,
      checkedAt: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecSync.mockReturnValue(''); // netstat -ano finds nothing to kill
    mockSpawn.mockReturnValue(fakeChild());
  });

  // Test A — correct bridge identification: restarting bridge targets
  // exactly the heidi-web process module, never a fabricated 'bridge' one.
  test('Test A: restartBridge restarts heidi-web, the process that actually serves it', async () => {
    const { recoveryEngine, model } = createSystem();
    model.updateState('heidi-web', 'HEALTHY', []);

    await (recoveryEngine as any).restartBridge('bridge');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args, opts] = mockSpawn.mock.calls[0];
    // boot.config.json's heidi-web module: command "npm", args ["run","dev"]
    expect(command).toBe('npm');
    expect(args).toEqual(['run', 'dev']);
    expect(opts.env.PORT).toBe('3000');
  });

  // Test B — wrong process is rejected: there is no boot.config.json module
  // literally named 'bridge', so the original "look up id === component"
  // path must never silently restart an unrelated same-named process.
  test('Test B: a literal "bridge" boot.config.json module is never assumed to exist', () => {
    const { recoveryEngine } = createSystem();
    const bootConfig = (recoveryEngine as any).bootConfig;
    const literalBridgeModule = bootConfig.modules.find((m: any) => m.id === 'bridge');
    expect(literalBridgeModule).toBeUndefined();
  });

  // Test C — authorization enforced: bridge recovery only reaches
  // RecoveryEngine when AutonomyPolicyModel's policy.recover.bridge (R2,
  // policy_authorized) actually allows it -- unchanged, not touched by
  // this implementation.
  test('Test C: ActionSelector only authorizes bridge recovery via the existing R2 policy', () => {
    const { actionSelector, model } = createSystem();
    model.updateState('protoforge-core', 'HEALTHY', []);
    model.updateState('heidi-web', 'HEALTHY', []);

    const health = makeBridgeHealth('UNAVAILABLE', { 'protoforge-core': 'HEALTHY', 'heidi-web': 'HEALTHY' });
    const result = actionSelector.selectAction('bridge', health, {} as DependencyGraph, 'test-incident-bridge-c');

    expect(result.selected).not.toBeNull();
    expect(result.selected!.target).toBe('bridge');
    expect(result.policy.risk).toBe('R2');
    expect(result.authorization.authorized).toBe(true);
  });

  // Test D — duplicate recovery prevented: an active lease for 'bridge'
  // blocks a second concurrent acquire, exactly like every other
  // component (RecoveryLockManager, unchanged).
  test('Test D: an active recovery lease for bridge prevents a concurrent second one', () => {
    const { lockManager } = createSystem();
    const lease1 = lockManager.acquire('bridge');
    expect(lease1).not.toBeNull();

    const lease2 = lockManager.acquire('bridge');
    expect(lease2).toBeNull();

    lockManager.release('bridge', lease1!.holderId);
    const lease3 = lockManager.acquire('bridge');
    expect(lease3).not.toBeNull();
  });

  // Test E — successful recovery: heidi-web's own state is HEALTHY (the
  // failure is bridge-route-specific), so restartBridge performs the real
  // governed restart_process path for heidi-web end to end.
  test('Test E: bridge recovery restarts heidi-web when heidi-web itself is healthy', async () => {
    const { recoveryEngine, model } = createSystem();
    model.updateState('heidi-web', 'HEALTHY', []);

    await (recoveryEngine as any).restartBridge('bridge');

    expect(mockExecSync).toHaveBeenCalledWith(
      'netstat -ano',
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  // Test F — failed verification / correct escalation: heidi-web itself is
  // UNAVAILABLE, so restartBridge must NOT redundantly restart it (that is
  // heidi-web's own recovery's job) -- it must fail loudly instead of
  // silently no-op-ing or falsely restarting.
  test('Test F: bridge recovery refuses to act when heidi-web itself is unavailable', async () => {
    const { recoveryEngine, model } = createSystem();
    model.updateState('heidi-web', 'UNAVAILABLE', []);

    await expect((recoveryEngine as any).restartBridge('bridge')).rejects.toThrow(/heidi-web/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('Test F2: bridge recovery also refuses to act when heidi-web is only BLOCKED', async () => {
    const { recoveryEngine, model } = createSystem();
    model.updateState('heidi-web', 'BLOCKED', []);

    await expect((recoveryEngine as any).restartBridge('bridge')).rejects.toThrow();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  // Test G — no false green: a spawned process is not, by itself, evidence
  // of a healthy bridge. restartBridge only ever spawns; it never asserts
  // HEALTHY itself -- verification is RecoveryEngine.recover()'s own
  // postcondition check (an unmodified, pre-existing mechanism), which
  // this test confirms is still what governs the final recorded state.
  test('Test G: restartBridge never itself claims success -- only recover() verifies via checkAll()', async () => {
    const { recoveryEngine, model, healthChecker } = createSystem();
    model.updateState('heidi-web', 'HEALTHY', []);
    model.updateState('bridge', 'UNAVAILABLE', []);

    // Force the post-restart functional probe to still fail, simulating a
    // spawn that "succeeded" (process exists) but never became healthy.
    const checkAllSpy = jest.spyOn(healthChecker, 'checkAll').mockImplementation(async () => {
      model.updateState('bridge', 'UNAVAILABLE', [{ check: 'bridge-endpoint', status: 'fail', value: 'still down', checkedAt: new Date().toISOString() }]);
      return model.getAllStates();
    });

    // maxAttempts: 1 avoids recover()'s real-time inter-attempt cooldown
    // wait (bridge policy cooldownMs is 30s) -- irrelevant to what this
    // test is proving (a spawn alone is not verification).
    const record = await recoveryEngine.recover('bridge', 'test-no-false-green', { maxAttempts: 1 });

    expect(record.finalState).not.toBe('HEALTHY');
    checkAllSpy.mockRestore();
  }, 20000);
});
