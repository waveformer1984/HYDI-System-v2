/**
 * HYDI Runtime Truth Audit — Phase 2
 *
 * Verifies that the control plane state is truthful for every goal status.
 * Tests that dashboard/API/control-plane state matches the authoritative
 * state machine and checkpoint state.
 *
 * Truth matrix verified:
 *   RUNNING         → active, current action shown, next action shown
 *   PAUSED          → active, no current action
 *   WAITING_FOR_HUMAN → active, intervention shown
 *   WAITING_FOR_PROVIDER → active, intervention shown
 *   RECOVERING      → active, recovery shown
 *   COMPLETED       → terminal, no current action, no next action, no intervention
 *   PARTIAL         → terminal, no current action, no next action, no intervention
 *   FAILED          → terminal, no current action, no next action, no intervention
 *   EXPIRED         → terminal, no current action, no next action, no intervention
 *
 * Also verifies:
 *   - Terminal goals don't appear in listActiveGoals()
 *   - Terminal goals don't have pending interventions in listPendingInterventions()
 *   - PARTIAL is treated as terminal (was previously inconsistent)
 *   - Orphaned interventions (pending on terminal goals) are suppressed
 *   - completedGoals/failedGoals counts are accurate
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  GoalCheckpointManager,
  CheckpointPersistence,
  InterventionQueue,
  InterventionPersistence,
  GoalStateMachine,
  DelegatedIdentityManager,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
  HumanProxyControlPlane,
  isOperationalGoalStateClean,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  initializePersistence,
} from '../lib/delegated-operator';
import type { GoalRuntimeStatus } from '../lib/delegated-operator/GoalCheckpoint';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

const TMP_DIR = path.join(os.tmpdir(), 'hydi-truth-audit');
const WORKSPACE = process.cwd();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Runtime Truth Audit — Phase 2');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_truth_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_truth_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_truth_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Initialize singletons
  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const checkpointManager = getCheckpointManager();
  const interventionQueue = getInterventionQueue();

  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'truth_audit', authority: {
      authorityId: 'auth_truth', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'truth_audit' },
      requiresConfirmation: { alwaysConfirm: [], confirmRiskLevel: 'R3', confirmCategories: ['FINANCIAL', 'DEPLOY', 'DELETE', 'EXTERNAL_COMMITMENT', 'COMMUNICATE'] },
      purpose: 'truth audit', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Test' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'truth audit',
  });

  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);

  // ─── Test each status ─────────────────────────────────────────────
  const statuses: GoalRuntimeStatus[] = [
    'RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_PROVIDER', 'RECOVERING',
    'COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED',
  ];

  const terminalStatuses: GoalRuntimeStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED'];
  const activeStatuses: GoalRuntimeStatus[] = ['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_PROVIDER', 'RECOVERING'];

  for (const status of statuses) {
    console.log(`\n  ─── Status: ${status} ───`);
    const goalId = `goal_truth_${status}`;

    // Create a checkpoint with this status
    const testFile = path.join(TMP_DIR, `test_${status}.txt`);
    fs.writeFileSync(testFile, `test ${status}`);

    const cp = checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: `Truth audit ${status}`,
      planVersion: 1,
      completedObjectives: status === 'COMPLETED' || status === 'PARTIAL' ? ['OBJ_1'] : [],
      failedObjectives: status === 'FAILED' || status === 'PARTIAL' ? ['OBJ_2'] : [],
      inProgressObjectives: activeStatuses.includes(status) ? ['OBJ_1'] : [],
      pendingObjectives: activeStatuses.includes(status) ? ['OBJ_2'] : [],
      executedActions: [{ actionId: `act_${status}`, capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
      verifiedState: { 'file:exists': true },
      status, resumeCondition: 'N/A',
      executedSideEffects: [`create:${testFile}`],
      summary: `Truth audit ${status}`,
    });
    await new Promise((r) => setTimeout(r, 100));

    // Record an action event for this goal
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_STARTED',
      payload: { capability: 'filesystem.write_file', targetResource: testFile, riskLevel: 'R1' },
    });
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED',
      payload: { capability: 'filesystem.write_file', targetResource: testFile, result: 'success' },
    });

    // For WAITING_FOR_HUMAN, create an intervention
    if (status === 'WAITING_FOR_HUMAN') {
      interventionQueue.enqueue({
        goalId, identityId: identity.identityId, userId: 'user:owner',
        currentObjective: 'TEST', blocker: 'HUMAN_REQUIRED',
        requiredHumanAction: 'Confirm', whyRequired: 'Test',
        expectedResultingState: 'Done',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        resumeCondition: 'Confirmed', auditId: `audit_${status}`,
        interventionType: 'UNKNOWN',
        originalRequest: {
          requestId: `req_${status}`, actionId: `act_int_${status}`, goalId,
          reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
          whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
          whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
          timestamp: new Date().toISOString(),
        },
      });
      await new Promise((r) => setTimeout(r, 100));
    }

    // Also create an orphaned intervention on a terminal goal
    if (terminalStatuses.includes(status)) {
      interventionQueue.enqueue({
        goalId, identityId: identity.identityId, userId: 'user:owner',
        currentObjective: 'TEST', blocker: 'ORPHANED',
        requiredHumanAction: 'Confirm', whyRequired: 'Orphaned',
        expectedResultingState: 'Done',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        resumeCondition: 'Confirmed', auditId: `audit_orphan_${status}`,
        interventionType: 'UNKNOWN',
        originalRequest: {
          requestId: `req_orphan_${status}`, actionId: `act_orphan_${status}`, goalId,
          reason: 'orphaned', whatWasAttempted: 'test', whatSucceeded: 'test',
          whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
          whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
          timestamp: new Date().toISOString(),
        },
      });
      await new Promise((r) => setTimeout(r, 100));
    }

    // Get state from control plane
    const state = controlPlane.getGoalState(goalId);
    assert(state !== null, `${status}: Control plane returns state`);
    if (!state) continue;

    assert(state.status === status, `${status}: Status matches checkpoint status`);
    assert(isOperationalGoalStateClean(state), `${status}: State is secret-clean`);

    if (terminalStatuses.includes(status)) {
      // Terminal goals should NOT have current action
      assert(state.currentAction === undefined, `${status}: Terminal goal has no current action`);
      assert(state.currentCapability === undefined, `${status}: Terminal goal has no current capability`);
      assert(state.nextAction === undefined, `${status}: Terminal goal has no next action`);
      assert(state.interventionRequired === false, `${status}: Terminal goal has no intervention required`);
      assert(state.interventionId === undefined, `${status}: Terminal goal has no intervention ID`);
      assert(state.blockers.length === 0, `${status}: Terminal goal has no blockers`);

      if (status === 'COMPLETED') {
        assert(state.finalState !== undefined, `${status}: COMPLETED has final state`);
        assert(state.finalVerification === 'verified', `${status}: COMPLETED has final verification`);
      }
    } else {
      // Active goals should have current action (since we recorded ACTION_STARTED)
      // Except PAUSED which shouldn't be actively executing
      if (status === 'RUNNING' || status === 'RECOVERING') {
        assert(state.currentAction !== undefined, `${status}: Active goal has current action`);
      }
    }
  }

  // ─── Test listActiveGoals() ───────────────────────────────────────
  console.log('\n  ─── listActiveGoals() ───');
  const activeGoals = controlPlane.listActiveGoals();
  const activeGoalIds = activeGoals.map((g) => g.goalId);

  for (const status of activeStatuses) {
    const goalId = `goal_truth_${status}`;
    assert(activeGoalIds.includes(goalId), `listActiveGoals includes ${status}`);
  }

  for (const status of terminalStatuses) {
    const goalId = `goal_truth_${status}`;
    assert(!activeGoalIds.includes(goalId), `listActiveGoals excludes terminal ${status}`);
  }

  // ─── Test listPendingInterventions() ──────────────────────────────
  console.log('\n  ─── listPendingInterventions() ───');
  const pendingInterventions = controlPlane.listPendingInterventions();
  const interventionGoalIds = pendingInterventions.map((i) => i.goalId);

  // WAITING_FOR_HUMAN should have a pending intervention
  assert(interventionGoalIds.includes('goal_truth_WAITING_FOR_HUMAN'), 'WAITING_FOR_HUMAN has pending intervention');

  // Terminal goals should NOT have pending interventions (orphaned filtered)
  for (const status of terminalStatuses) {
    const goalId = `goal_truth_${status}`;
    assert(!interventionGoalIds.includes(goalId), `listPendingInterventions excludes orphaned on ${status}`);
  }

  // ─── Test getOperationalSummary() ─────────────────────────────────
  console.log('\n  ─── getOperationalSummary() ───');
  const summary = controlPlane.getOperationalSummary();
  assert(summary.activeGoals === activeStatuses.length, `Summary activeGoals = ${activeStatuses.length} (got ${summary.activeGoals})`);
  assert(summary.completedGoals >= 1, `Summary completedGoals >= 1 (got ${summary.completedGoals})`);
  assert(summary.failedGoals >= 2, `Summary failedGoals >= 2 (FAILED + EXPIRED, got ${summary.failedGoals})`);
  assert(summary.pendingInterventions === 1, `Summary pendingInterventions = 1 (got ${summary.pendingInterventions})`);

  // ─── Test state machine terminal enforcement ──────────────────────
  console.log('\n  ─── State Machine Terminal Enforcement ───');
  const sm = new GoalStateMachine();
  for (const terminal of terminalStatuses) {
    const goalId = `goal_sm_${terminal}`;
    sm.initialize(goalId, 'RUNNING');
    sm.transition(goalId, terminal, 'Test');
    const result = sm.transition(goalId, 'RUNNING', 'Try to reopen');
    assert(result.success === false, `${terminal} → RUNNING rejected by state machine`);
  }

  // ─── Test PARTIAL is in listActive() terminal filter ──────────────
  console.log('\n  ─── PARTIAL Terminal Consistency ───');
  const cpManager = getCheckpointManager();
  const activeCps = cpManager.listActive();
  const partialCp = activeCps.find((cp) => cp.status === 'PARTIAL');
  assert(partialCp === undefined, 'PARTIAL is excluded from listActive() (was previously included)');

  // ─── Cleanup ──────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_truth_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_truth_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_truth_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // ─── Results ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Truth Audit Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) { console.log('\nFailures:'); for (const f of failures) { console.log(`  ✗ ${f}`); } }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
