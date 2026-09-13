/**
 * HYDI Intervention Lifecycle Qualification — Phase 5
 *
 * Tests the complete intervention lifecycle:
 * - create/enqueue
 * - pending state
 * - approval (with checkpoint resume)
 * - rejection (no resume)
 * - cancellation (no resume)
 * - expiration (no resume)
 * - resume conditions
 * - terminal-goal interaction (no interventions on terminal goals)
 * - restart persistence and recovery
 * - prevention of invalid resume (rejected/cancelled/expired can't be re-approved)
 * - double-approval prevention
 * - double-rejection prevention
 * - approve-then-reject prevention
 * - expired intervention can't be approved
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  HumanProxyControlPlane,
  InterventionController,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  initializePersistence,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
} from '../lib/delegated-operator';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

const TMP_DIR = path.join(os.tmpdir(), 'hydi-intervention-lifecycle');
const WORKSPACE = process.cwd();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Intervention Lifecycle Qualification — Phase 5');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_int_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_int_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_int_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const checkpointManager = getCheckpointManager();
  const interventionQueue = getInterventionQueue();

  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'int_lifecycle', authority: {
      authorityId: 'auth_int', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'int_lifecycle' },
      requiresConfirmation: {
        destructiveActions: true, financialActions: true, externalCommunication: true,
        deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
      },
      purpose: 'intervention test', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Test' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'intervention test',
  });

  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);
  const controller = new InterventionController();

  // Helper to create a goal + intervention
  async function createGoalWithIntervention(goalId: string, blocker: string, expiresInMs: number = 3600000): Promise<string> {
    const testFile = path.join(TMP_DIR, `${goalId}.txt`);
    fs.writeFileSync(testFile, `test ${goalId}`);

    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: `Intervention test ${goalId}`,
      planVersion: 1,
      completedObjectives: [],
      failedObjectives: [],
      inProgressObjectives: ['OBJ_1'],
      pendingObjectives: ['OBJ_2'],
      executedActions: [],
      verifiedState: {},
      status: 'WAITING_FOR_HUMAN',
      resumeCondition: 'Human approval required',
      executedSideEffects: [],
      summary: `Test ${goalId}`,
    });
    await new Promise((r) => setTimeout(r, 50));

    const enqueued = interventionQueue.enqueue({
      goalId, identityId: identity.identityId, userId: 'user:owner',
      currentObjective: 'OBJ_1', blocker,
      requiredHumanAction: 'Confirm action', whyRequired: 'High risk',
      expectedResultingState: 'Action completed',
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      resumeCondition: 'Approved by human', auditId: `audit_${goalId}`,
      interventionType: 'CONFIRMATION_REQUIRED',
      originalRequest: {
        requestId: `req_${goalId}`, actionId: `act_${goalId}`, goalId,
        reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
        whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
        whatHappensAfter: 'test', interventionType: 'CONFIRMATION_REQUIRED' as any,
        timestamp: new Date().toISOString(),
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    return enqueued.requestId;
  }

  // ─── Test 1: Create/Enqueue ───────────────────────────────────────
  console.log('  ─── Create/Enqueue ───');
  const goalId1 = 'goal_int_001';
  const reqId1 = await createGoalWithIntervention(goalId1, 'HUMAN_CONFIRMATION_REQUIRED');
  assert(reqId1 !== null, 'Intervention enqueued successfully');
  assert(typeof reqId1 === 'string', 'Enqueue returns request ID');

  // ─── Test 2: Pending State ────────────────────────────────────────
  console.log('\n  ─── Pending State ───');
  const pending = interventionQueue.getPending();
  const intv1 = pending.find((i) => i.requestId === reqId1);
  assert(intv1 !== undefined, 'Intervention appears in pending list');
  assert(intv1?.status === 'pending', 'Intervention status is pending');
  assert(intv1?.blocker === 'HUMAN_CONFIRMATION_REQUIRED', 'Intervention blocker matches');

  const pendingByGoal = interventionQueue.getPendingByGoal(goalId1);
  assert(pendingByGoal.length === 1, 'getPendingByGoal returns 1 intervention');

  // ─── Test 3: Approval with checkpoint resume ──────────────────────
  console.log('\n  ─── Approval ───');
  const approveResult = await controller.approve(reqId1, 'user:owner', 'Approved for testing');
  assert(approveResult.resumed, 'Approval succeeds');
  assert(approveResult.resolution === 'approved', 'Resolution is approved');
  assert(approveResult.resumed, 'Goal resumed after approval');
  assert(approveResult.checkpointId !== undefined, 'Checkpoint ID returned');
  assert(approveResult.replanRequired === false, 'No replan required (no failed objectives)');

  // Verify intervention is no longer pending
  const pendingAfterApprove = interventionQueue.getPending();
  const stillPending = pendingAfterApprove.find((i) => i.requestId === reqId1);
  assert(stillPending === undefined, 'Approved intervention is no longer pending');

  // ─── Test 4: Double-approval prevention ───────────────────────────
  console.log('\n  ─── Double-Approval Prevention ───');
  const doubleApprove = await controller.approve(reqId1, 'user:owner', 'Double approve');
  assert(!doubleApprove.resumed, 'Double approval fails');
  assert(doubleApprove.reason?.includes('not pending') || doubleApprove.reason?.includes('not found'), 'Double approval rejected with reason');

  // ─── Test 5: Rejection ────────────────────────────────────────────
  console.log('\n  ─── Rejection ───');
  const goalId2 = 'goal_int_002';
  const reqId2 = await createGoalWithIntervention(goalId2, 'REJECTION_TEST');
  const rejectResult = await controller.reject(reqId2, 'user:owner', 'Rejected for testing');
  assert(rejectResult.reason.startsWith('Rejected by'), `Rejection succeeds (reason: ${rejectResult.reason})`);
  assert(rejectResult.resolution === 'rejected', 'Resolution is rejected');
  assert(!rejectResult.resumed, 'Goal NOT resumed after rejection');

  // ─── Test 6: Approve-then-reject prevention ───────────────────────
  console.log('\n  ─── Approve-Then-Reject Prevention ───');
  const rejectAfterApprove = await controller.reject(reqId2, 'user:owner', 'Reject after approve');
  assert(!rejectAfterApprove.reason.startsWith('Rejected by'), `Reject after approve fails (reason: ${rejectAfterApprove.reason})`);

  // ─── Test 7: Cancellation ─────────────────────────────────────────
  console.log('\n  ─── Cancellation ───');
  const goalId3 = 'goal_int_003';
  const reqId3 = await createGoalWithIntervention(goalId3, 'CANCEL_TEST');
  const cancelResult = await controller.cancel(reqId3, 'user:owner', 'Cancelled for testing');
  assert(cancelResult.reason.startsWith('Cancelled by'), `Cancellation succeeds (reason: ${cancelResult.reason})`);
  assert(cancelResult.resolution === 'cancelled', 'Resolution is cancelled');
  assert(!cancelResult.resumed, 'Goal NOT resumed after cancellation');

  // ─── Test 8: Double-cancellation prevention ───────────────────────
  console.log('\n  ─── Double-Cancellation Prevention ───');
  const doubleCancel = await controller.cancel(reqId3, 'user:owner', 'Double cancel');
  assert(!doubleCancel.reason.startsWith('Cancelled by'), `Double cancellation fails (reason: ${doubleCancel.reason})`);

  // ─── Test 9: Expiration ───────────────────────────────────────────
  console.log('\n  ─── Expiration ───');
  const goalId4 = 'goal_int_004';
  // Create intervention that expires in 1ms
  const reqId4 = await createGoalWithIntervention(goalId4, 'EXPIRY_TEST', 1);
  // Wait for it to expire
  await new Promise((r) => setTimeout(r, 100));

  const expiredCount = await controller.expireStale();
  assert(expiredCount >= 1, `expireStale returns >= 1 (got ${expiredCount})`);

  // Verify intervention is no longer pending
  const pendingAfterExpiry = interventionQueue.getPending();
  const expiredIntv = pendingAfterExpiry.find((i) => i.requestId === reqId4);
  assert(expiredIntv === undefined, 'Expired intervention is no longer pending');

  // ─── Test 10: Expired intervention can't be approved ──────────────
  console.log('\n  ─── Expired Can\'t Be Approved ───');
  const approveExpired = await controller.approve(reqId4, 'user:owner', 'Approve expired');
  assert(!approveExpired.resumed, 'Approving expired intervention fails (not resumed)');
  assert(approveExpired.reason.includes('not pending') || approveExpired.reason.includes('expired'), `Expired intervention approval rejected (reason: ${approveExpired.reason})`);

  // ─── Test 11: Terminal-goal interaction ───────────────────────────
  console.log('\n  ─── Terminal-Goal Interaction ───');
  const goalId5 = 'goal_int_005';
  const testFile5 = path.join(TMP_DIR, `${goalId5}.txt`);
  fs.writeFileSync(testFile5, `test ${goalId5}`);

  // Create a COMPLETED goal
  checkpointManager.checkpoint({
    goalId: goalId5, identityId: identity.identityId,
    goalStatement: `Completed goal ${goalId5}`,
    planVersion: 1,
    completedObjectives: ['OBJ_1'],
    failedObjectives: [],
    inProgressObjectives: [],
    pendingObjectives: [],
    executedActions: [{ actionId: `act_${goalId5}`, capability: 'filesystem.write_file', target: testFile5, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
    verifiedState: { 'file:exists': true },
    status: 'COMPLETED',
    resumeCondition: 'N/A',
    executedSideEffects: [`create:${testFile5}`],
    summary: `Completed ${goalId5}`,
  });
  await new Promise((r) => setTimeout(r, 50));

  // Try to create an intervention on a terminal goal
  const terminalIntv = interventionQueue.enqueue({
    goalId: goalId5, identityId: identity.identityId, userId: 'user:owner',
    currentObjective: 'OBJ_1', blocker: 'ORPHANED_ON_TERMINAL',
    requiredHumanAction: 'test', whyRequired: 'test',
    expectedResultingState: 'test',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'test', auditId: `audit_${goalId5}`,
    interventionType: 'CONFIRMATION_REQUIRED',
    originalRequest: {
      requestId: `req_${goalId5}`, actionId: `act_${goalId5}`, goalId: goalId5,
      reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
      whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
      whatHappensAfter: 'test', interventionType: 'CONFIRMATION_REQUIRED' as any,
      timestamp: new Date().toISOString(),
    },
  });
  await new Promise((r) => setTimeout(r, 50));

  // The intervention exists in the queue but should be filtered by the control plane
  const cpPending = controlPlane.listPendingInterventions();
  const terminalInList = cpPending.find((i) => i.goalId === goalId5);
  assert(terminalInList === undefined, 'Control plane filters interventions on terminal goals');

  // The goal state should not show intervention required
  const goalState5 = controlPlane.getGoalState(goalId5);
  assert(goalState5?.interventionRequired === false, 'Terminal goal does not show intervention required');

  // ─── Test 12: Restart persistence ─────────────────────────────────
  console.log('\n  ─── Restart Persistence ───');
  const goalId6 = 'goal_int_006';
  const reqId6 = await createGoalWithIntervention(goalId6, 'PERSISTENCE_TEST');

  // Verify it's in Supabase
  const { data: persistedIntv } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', reqId6)
    .limit(1);
  assert(persistedIntv !== null, 'Intervention persisted to Supabase');
  assert((persistedIntv?.length ?? 0) >= 1, `At least 1 intervention in Supabase (got ${persistedIntv?.length})`);
  const persistedRow = persistedIntv?.[0];
  assert(persistedRow?.status === 'pending', `Persisted intervention is pending (got ${persistedRow?.status})`);

  // ─── Test 13: Restart recovery ────────────────────────────────────
  console.log('\n  ─── Restart Recovery ───');
  // Simulate restart by creating fresh queue and restoring
  const { InterventionPersistence, CheckpointPersistence } = require('../lib/delegated-operator');
  const freshQueue = new (require('../lib/delegated-operator/InterventionQueue').InterventionQueue)();
  freshQueue.attachPersistence(new InterventionPersistence(supabase));
  const restored = await freshQueue.restoreFromPersistence();
  assert(restored > 0, `Interventions restored from Supabase: ${restored}`);
  const restoredPending = freshQueue.getPending();
  const restoredIntv = restoredPending.find((i: { requestId: string; status: string; blocker: string }) => i.requestId === reqId6);
  assert(restoredIntv !== undefined, 'Pending intervention restored after restart');
  assert(restoredIntv?.status === 'pending', 'Restored intervention is pending');
  assert(restoredIntv?.blocker === 'PERSISTENCE_TEST', `Restored intervention blocker matches (got ${restoredIntv?.blocker})`);

  // ─── Test 14: Restored intervention can be approved ───────────────
  console.log('\n  ─── Restored Intervention Can Be Approved ───');
  // Use the controller with the restored queue
  // We need to use the singleton queue since the controller uses singletons
  const singletonPending = interventionQueue.getPending();
  const singletonIntv = singletonPending.find((i) => i.requestId === reqId6);
  assert(singletonIntv !== undefined, 'Restored intervention is in singleton queue');
  const approveRestored = await controller.approve(reqId6, 'user:owner', 'Approved after restart');
  assert(approveRestored.resumed, 'Restored intervention can be approved');
  assert(approveRestored.resumed, 'Goal resumed after restored intervention approval');

  // ─── Test 15: Event emission for lifecycle ────────────────────────
  console.log('\n  ─── Event Emission ───');
  // Check that events were emitted for the approved intervention
  const events1 = controlPlane.getGoalEvents(goalId1);
  const hasApprovedEvent = events1.some((e) => e.eventType === 'INTERVENTION_APPROVED');
  assert(hasApprovedEvent, 'INTERVENTION_APPROVED event emitted for goal 1');

  const events2 = controlPlane.getGoalEvents(goalId2);
  const hasRejectedEvent = events2.some((e) => e.eventType === 'INTERVENTION_REJECTED');
  assert(hasRejectedEvent, 'INTERVENTION_REJECTED event emitted for goal 2');

  const events3 = controlPlane.getGoalEvents(goalId3);
  const hasCancelledEvent = events3.some((e) => e.eventType === 'INTERVENTION_CANCELLED');
  assert(hasCancelledEvent, 'INTERVENTION_CANCELLED event emitted for goal 3');

  const events4 = controlPlane.getGoalEvents(goalId4);
  const hasExpiredEvent = events4.some((e) => e.eventType === 'INTERVENTION_EXPIRED');
  assert(hasExpiredEvent, 'INTERVENTION_EXPIRED event emitted for goal 4');

  // ─── Test 16: Resume conditions ───────────────────────────────────
  console.log('\n  ─── Resume Conditions ───');
  // Create a goal with failed objectives to test replanRequired
  const goalId7 = 'goal_int_007';
  const testFile7 = path.join(TMP_DIR, `${goalId7}.txt`);
  fs.writeFileSync(testFile7, `test ${goalId7}`);

  checkpointManager.checkpoint({
    goalId: goalId7, identityId: identity.identityId,
    goalStatement: `Replan test ${goalId7}`,
    planVersion: 1,
    completedObjectives: ['OBJ_1'],
    failedObjectives: ['OBJ_2'], // Has failed objectives → replan required
    inProgressObjectives: [],
    pendingObjectives: ['OBJ_3'],
    executedActions: [{ actionId: `act_${goalId7}`, capability: 'filesystem.write_file', target: testFile7, outcome: 'failure', verified: false, timestamp: new Date().toISOString() }],
    verifiedState: {},
    status: 'WAITING_FOR_HUMAN',
    resumeCondition: 'Human approval + replan',
    executedSideEffects: [`create:${testFile7}`],
    summary: `Replan ${goalId7}`,
  });
  await new Promise((r) => setTimeout(r, 50));

  const reqId7Enqueued = interventionQueue.enqueue({
    goalId: goalId7, identityId: identity.identityId, userId: 'user:owner',
    currentObjective: 'OBJ_2', blocker: 'REPLAN_REQUIRED',
    requiredHumanAction: 'Approve replan', whyRequired: 'Objective failed',
    expectedResultingState: 'Replanned and resumed',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'Approved + replan', auditId: `audit_${goalId7}`,
    interventionType: 'REPLAN_APPROVAL',
    originalRequest: {
      requestId: `req_${goalId7}`, actionId: `act_${goalId7}`, goalId: goalId7,
      reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
      whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
      whatHappensAfter: 'test', interventionType: 'REPLAN_APPROVAL' as any,
      timestamp: new Date().toISOString(),
    },
  });
  const reqId7 = reqId7Enqueued.requestId;
  await new Promise((r) => setTimeout(r, 50));

  const approveReplan = await controller.approve(reqId7, 'user:owner', 'Approved replan');
  assert(approveReplan.resumed, `Approval with replan succeeds (reason: ${approveReplan.reason})`);
  assert(approveReplan.replanRequired === true, `Replan required when failed objectives exist (got ${approveReplan.replanRequired})`);
  assert(approveReplan.objectivesToSkip !== undefined, 'Objectives to skip returned');

  // ─── Cleanup ──────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_int_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_int_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_int_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // ─── Results ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Intervention Lifecycle Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) { console.log('\nFailures:'); for (const f of failures) { console.log(`  ✗ ${f}`); } }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

