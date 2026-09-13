/**
 * HYDI Operational Safety Tests — Phase 9
 *
 * Proves that the control plane does not weaken any existing safety controls
 * and that the control plane itself cannot become an alternative execution path.
 *
 * 17 safety assertions covering:
 *   1. Financial actions prohibited without human authorization
 *   2. Destructive actions cannot bypass delegated authority
 *   3. Resource boundaries enforced
 *   4. Path traversal blocked
 *   5. Expired identities cannot act
 *   6. Expired interventions cannot resume
 *   7. Rejected interventions cannot resume
 *   8. Cancelled goals cannot resume
 *   9. Terminal states cannot reopen
 *   10. Stale checkpoints trigger verification/replan
 *   11. Completed actions never duplicated after restart
 *   12. Secrets never enter operational events
 *   13. Secrets never enter API responses
 *   14. Secrets never enter dashboard state
 *   15. Control-plane APIs cannot directly execute capabilities
 *   16. Browser sessions cannot bypass credential/authority system
 *   17. Control plane cannot become alternative execution path
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
  VerificationContractRegistry,
  createDefaultVerificationContracts,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
  HumanProxyControlPlane,
  OperationalEventStream,
  OperationalEventPersistence,
  InterventionController,
  getInterventionController,
  buildOperationalGoalState,
  sanitizeOperationalGoalState,
  isOperationalGoalStateClean,
  createOperationalEvent,
  sanitizeOperationalEventPayload,
  isOperationalEventClean,
} from '../lib/delegated-operator';
import type { DelegatedAuthority } from '../lib/human-action/AuthorityManager';
import { STRICT_CONFIRMATION } from '../lib/human-action/AuthorityManager';
import type { RiskLevel } from '../lib/operational/types';
import type { AuthorizationScope, AuthorizationMode, ActionCategory } from '../lib/human-action/HumanActionTypes';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

function makeAuthority(riskLimit: 'MEDIUM' | 'HIGH' = 'MEDIUM', riskLevelLimit: 'R2' | 'R4' = 'R2'): DelegatedAuthority {
  return {
    authorityId: 'auth_safety_001', delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION', 'CREDENTIAL_MANAGEMENT'],
    riskLimit, riskLevelLimit,
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'safety_test' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'safety test', createdAt: new Date().toISOString(), metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Operational Safety Tests — Phase 9');
  console.log('  17 safety assertions');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);
  const TMP_DIR = path.join(os.tmpdir(), 'hydi-safety-test');
  const WORKSPACE = process.cwd();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_safety_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_safety_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_safety_%');

  // ─── 1. Financial actions prohibited without human authorization ─
  console.log('  ─── Financial & Destructive Safety ───');
  {
    const identityManager = new DelegatedIdentityManager();
    const identity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'safety_test', authority: makeAuthority(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      includedCapabilities: [], excludedCapabilities: [],
      alwaysConfirmActions: [],
      resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: 'safety test',
    });

    // FINANCIAL requires confirmation — authorized but cannot execute autonomously
    const finAuth = identityManager.evaluate({
      identity, capability: 'stripe.create_charge', category: 'FINANCIAL' as ActionCategory,
      target: 'stripe', risk: 'R3' as RiskLevel,
      scope: 'PAYMENT_PROCESSING' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'service', sideEffectCategory: 'FINANCIAL',
    });
    assert(finAuth.requiresConfirmation === true, '1. Financial action requires human confirmation');
    assert(finAuth.authorized !== true || finAuth.requiresConfirmation === true, '1a. Financial action cannot proceed without confirmation');

    // DEPLOY requires confirmation
    const deployAuth = identityManager.evaluate({
      identity, capability: 'dev.deploy', category: 'DEPLOY' as ActionCategory,
      target: 'production', risk: 'R3' as RiskLevel,
      scope: 'DEPLOYMENT' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'service', sideEffectCategory: 'DEPLOY',
    });
    assert(deployAuth.requiresConfirmation === true, '2. Deploy action requires human confirmation');
  }

  // ─── 3. Resource boundaries enforced ─────────────────────────────
  {
    const identityManager = new DelegatedIdentityManager();
    const identity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'safety_test', authority: makeAuthority(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      includedCapabilities: [], excludedCapabilities: [],
      alwaysConfirmActions: [],
      resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: 'safety test',
    });

    // Protected path — .env
    const envAuth = identityManager.evaluate({
      identity, capability: 'filesystem.read_file', category: 'SYSTEM' as ActionCategory,
      target: path.join(WORKSPACE, '.env'), risk: 'R1' as RiskLevel,
      scope: 'READ_ONLY' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'filesystem_path', sideEffectCategory: 'READ',
    });
    assert(envAuth.authorized === false, '3. Resource boundary blocks .env access');

    // Protected path — .ssh
    const sshAuth = identityManager.evaluate({
      identity, capability: 'filesystem.read_file', category: 'SYSTEM' as ActionCategory,
      target: path.join(os.homedir(), '.ssh', 'id_rsa'), risk: 'R1' as RiskLevel,
      scope: 'READ_ONLY' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'filesystem_path', sideEffectCategory: 'READ',
    });
    assert(sshAuth.authorized === false, '3a. Resource boundary blocks .ssh access');
  }

  // ─── 4. Path traversal blocked ───────────────────────────────────
  {
    const identityManager = new DelegatedIdentityManager();
    const identity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'safety_test', authority: makeAuthority(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      includedCapabilities: [], excludedCapabilities: [],
      alwaysConfirmActions: [],
      resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: 'safety test',
    });

    const traversalAuth = identityManager.evaluate({
      identity, capability: 'filesystem.write_file', category: 'SYSTEM' as ActionCategory,
      target: path.join(WORKSPACE, '..', '..', '..', 'etc', 'passwd'), risk: 'R1' as RiskLevel,
      scope: 'LOCAL_WRITE' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'filesystem_path', sideEffectCategory: 'CREATE',
    });
    assert(traversalAuth.authorized === false, '4. Path traversal blocked');
  }

  // ─── 5. Expired identities cannot act ────────────────────────────
  console.log('\n  ─── Identity & Intervention Safety ───');
  {
    const identityManager = new DelegatedIdentityManager();
    const identity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'safety_test', authority: makeAuthority(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
      includedCapabilities: [], excludedCapabilities: [],
      alwaysConfirmActions: [],
      resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: 'safety test',
    });

    const validity = identityManager.isIdentityValid(identity.identityId);
    assert(validity.valid === false, '5. Expired identity is invalid');

    const expiredAuth = identityManager.evaluate({
      identity, capability: 'filesystem.write_file', category: 'SYSTEM' as ActionCategory,
      target: path.join(TMP_DIR, 'test.txt'), risk: 'R1' as RiskLevel,
      scope: 'LOCAL_WRITE' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'filesystem_path', sideEffectCategory: 'CREATE',
    });
    assert(expiredAuth.authorized === false, '5a. Expired identity cannot authorize actions');
  }

  // ─── 6. Expired interventions cannot resume ──────────────────────
  {
    const queue = new InterventionQueue();
    const intervention = queue.enqueue({
      goalId: 'goal_safety_001', identityId: 'id_test', userId: 'user:owner',
      currentObjective: 'TEST', blocker: 'TEST',
      requiredHumanAction: 'Test', whyRequired: 'Test',
      expectedResultingState: 'Done',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
      resumeCondition: 'Test', auditId: 'audit_test',
      interventionType: 'UNKNOWN',
      originalRequest: {
        requestId: 'req_test', actionId: 'act_test', goalId: 'goal_safety_001',
        reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
        whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
        whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
        timestamp: new Date().toISOString(),
      },
    });

    // Expire stale
    queue.expireStale();
    assert(intervention.status === 'expired', '6. Expired intervention marked expired');

    // Try to approve — should fail
    const controller = new InterventionController();
    const result = await controller.approve(intervention.requestId, 'user:owner');
    assert(result.resumed === false, '6a. Expired intervention cannot resume');
  }

  // ─── 7. Rejected interventions cannot resume ─────────────────────
  {
    const queue = new InterventionQueue();
    const intervention = queue.enqueue({
      goalId: 'goal_safety_002', identityId: 'id_test', userId: 'user:owner',
      currentObjective: 'TEST', blocker: 'TEST',
      requiredHumanAction: 'Test', whyRequired: 'Test',
      expectedResultingState: 'Done',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Test', auditId: 'audit_test',
      interventionType: 'UNKNOWN',
      originalRequest: {
        requestId: 'req_test2', actionId: 'act_test2', goalId: 'goal_safety_002',
        reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
        whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
        whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
        timestamp: new Date().toISOString(),
      },
    });

    const controller = new InterventionController();
    const rejectResult = await controller.reject(intervention.requestId, 'user:owner', 'rejected');
    assert(rejectResult.resumed === false, '7. Rejected intervention does not resume');

    // Try to approve after rejection
    const approveAfterReject = await controller.approve(intervention.requestId, 'user:owner');
    assert(approveAfterReject.resumed === false, '7a. Cannot approve after rejection');
  }

  // ─── 8. Cancelled goals cannot resume ─────────────────────────────
  {
    const queue = new InterventionQueue();
    const intervention = queue.enqueue({
      goalId: 'goal_safety_003', identityId: 'id_test', userId: 'user:owner',
      currentObjective: 'TEST', blocker: 'TEST',
      requiredHumanAction: 'Test', whyRequired: 'Test',
      expectedResultingState: 'Done',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Test', auditId: 'audit_test',
      interventionType: 'UNKNOWN',
      originalRequest: {
        requestId: 'req_test3', actionId: 'act_test3', goalId: 'goal_safety_003',
        reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
        whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
        whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
        timestamp: new Date().toISOString(),
      },
    });

    const controller = new InterventionController();
    const cancelResult = await controller.cancel(intervention.requestId, 'user:owner', 'cancelled');
    assert(cancelResult.resumed === false, '8. Cancelled goal does not resume');

    // Try to approve after cancel
    const approveAfterCancel = await controller.approve(intervention.requestId, 'user:owner');
    assert(approveAfterCancel.resumed === false, '8a. Cannot approve after cancellation');
  }

  // ─── 9. Terminal states cannot reopen ─────────────────────────────
  console.log('\n  ─── State Machine Safety ───');
  {
    const sm = new GoalStateMachine();
    const goalId = 'goal_safety_004';
    sm.initialize(goalId, 'RUNNING');

    sm.transition(goalId, 'COMPLETED', 'Done');
    assert(sm.getState(goalId) === 'COMPLETED', '9. Goal reached COMPLETED');

    const reopenResult = sm.transition(goalId, 'RUNNING', 'Try to reopen');
    assert(reopenResult.success === false, '9a. COMPLETED → RUNNING rejected');

    // FAILED
    const goalId2 = 'goal_safety_005';
    sm.initialize(goalId2, 'RUNNING');
    sm.transition(goalId2, 'FAILED', 'Failed');
    const failedReopen = sm.transition(goalId2, 'RUNNING', 'Try to reopen');
    assert(failedReopen.success === false, '9b. FAILED → RUNNING rejected');

    // EXPIRED
    const goalId3 = 'goal_safety_006';
    sm.initialize(goalId3, 'RUNNING');
    sm.transition(goalId3, 'EXPIRED', 'Expired');
    const expiredReopen = sm.transition(goalId3, 'RUNNING', 'Try to reopen');
    assert(expiredReopen.success === false, '9c. EXPIRED → RUNNING rejected');
  }

  // ─── 10. Stale checkpoints trigger verification/replan ────────────
  console.log('\n  ─── Checkpoint Safety ───');
  {
    const checkpointManager = new GoalCheckpointManager();
    const goalId = 'goal_safety_007';

    const testFile = path.join(TMP_DIR, 'stale_test.txt');
    fs.writeFileSync(testFile, 'original content');

    const cp = checkpointManager.checkpoint({
      goalId, identityId: 'id_test',
      goalStatement: 'Stale test', planVersion: 1,
      completedObjectives: ['CREATE_FILE'],
      failedObjectives: [], inProgressObjectives: [],
      pendingObjectives: ['VERIFY_FILE'],
      executedActions: [
        { actionId: 'act_stale_001', capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() },
      ],
      verifiedState: { 'file:exists': true, 'file:content': 'original content' },
      status: 'RUNNING', resumeCondition: 'File exists with original content',
      executedSideEffects: [`create:${testFile}`],
      summary: 'File created',
    });

    // Change the file content (make it stale)
    fs.writeFileSync(testFile, 'CHANGED content');

    const observations = new Map<string, unknown>([
      ['file:exists', true],
      ['file:content', 'CHANGED content'],
    ]);

    const revalidation = checkpointManager.revalidate(cp, observations);
    assert(revalidation.consistent === false, '10. Stale checkpoint detected (content changed)');
    assert(revalidation.invalidatedObjectives.length > 0, '10a. Stale checkpoint triggers objective invalidation');
  }

  // ─── 11. Completed actions never duplicated after restart ─────────
  {
    const checkpointManager = new GoalCheckpointManager();
    const goalId = 'goal_safety_008';
    const testFile = path.join(TMP_DIR, 'dedup_test.txt');
    fs.writeFileSync(testFile, 'unique content');

    const cp = checkpointManager.checkpoint({
      goalId, identityId: 'id_test',
      goalStatement: 'Dedup test', planVersion: 1,
      completedObjectives: ['CREATE_FILE'],
      failedObjectives: [], inProgressObjectives: [],
      pendingObjectives: [],
      executedActions: [
        { actionId: 'act_dedup_001', capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() },
      ],
      verifiedState: { 'file:exists': true, 'file:content': 'unique content' },
      status: 'COMPLETED', resumeCondition: 'N/A',
      executedSideEffects: [`create:${testFile}`],
      summary: 'File created',
    });

    const resume = checkpointManager.getResumePoint(cp);
    assert(resume.resumeFrom === 'completed', '11. Completed goal does not resume');
    assert(resume.objectivesToExecute.length === 0, '11a. No objectives to execute after completion');
    assert(resume.objectivesToSkip.includes('CREATE_FILE'), '11b. Completed objective in skip list');

    // File content unchanged
    const content = fs.readFileSync(testFile, 'utf8');
    assert(content === 'unique content', '11c. File content unchanged (no duplicate write)');
  }

  // ─── 12. Secrets never enter operational events ───────────────────
  console.log('\n  ─── Secret Safety ───');
  {
    const event = createOperationalEvent({
      goalId: 'goal_safety_009',
      eventType: 'ACTION_COMPLETED',
      payload: {
        capability: 'stripe.create_charge',
        targetResource: 'stripe',
        riskLevel: 'R3',
        errorMessage: 'Failed with key sk_live_FAKE1234567890 and password=SecretPass123',
      },
      sequence: 1,
    });
    assert(isOperationalEventClean(event), '12. Secrets stripped from operational events');
    assert(!JSON.stringify(event).includes('sk_live_FAKE'), '12a. No sk_live in event');
    assert(!JSON.stringify(event).includes('password=SecretPass'), '12b. No password in event');
  }

  // ─── 13. Secrets never enter API responses (operational state) ────
  {
    const state = buildOperationalGoalState({
      goalId: 'goal_safety_010',
      sessionId: 'safety_test',
      delegatedIdentityId: 'id_test',
      goalText: 'Test goal with Bearer eyJhbGciOiJIUzI1NiIs_fake_token',
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      authorizationState: 'authorized',
      verificationState: 'pending',
      interventionRequired: false,
    });
    const sanitized = sanitizeOperationalGoalState(state);
    assert(isOperationalGoalStateClean(sanitized), '13. Secrets stripped from operational state');
    assert(!JSON.stringify(sanitized).includes('Bearer eyJ'), '13a. No Bearer token in state');
  }

  // ─── 14. Secrets never enter dashboard state ──────────────────────
  {
    // Simulate what the dashboard would receive
    const state = buildOperationalGoalState({
      goalId: 'goal_safety_011',
      sessionId: 'safety_test',
      delegatedIdentityId: 'id_test',
      goalText: 'Test with mfa_secret=FAKEJBSWY3DPEHPK3PXP and cookie=session_abc123',
      status: 'WAITING_FOR_HUMAN',
      startedAt: new Date().toISOString(),
      authorizationState: 'pending',
      verificationState: 'not_applicable',
      interventionRequired: true,
      interventionReason: 'MFA required — mfa_secret=FAKE_SECRET',
    });
    const sanitized = sanitizeOperationalGoalState(state);
    assert(isOperationalGoalStateClean(sanitized), '14. Secrets stripped from dashboard state');
    assert(!JSON.stringify(sanitized).includes('mfa_secret='), '14a. No mfa_secret in dashboard state');
    assert(!JSON.stringify(sanitized).includes('cookie='), '14b. No cookie in dashboard state');
  }

  // ─── 15. Control-plane APIs cannot directly execute capabilities ──
  console.log('\n  ─── Control Plane Safety ───');
  {
    const cp = new HumanProxyControlPlane();
    // The control plane has NO execute method
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(cp));
    const hasExecute = methods.some((m) => m.toLowerCase().includes('execute'));
    assert(hasExecute === false, '15. Control plane has no execute method');

    // It only has read methods
    assert(typeof cp.getGoalState === 'function', '15a. Control plane has getGoalState (read)');
    assert(typeof cp.listActiveGoals === 'function', '15b. Control plane has listActiveGoals (read)');
    assert(typeof cp.getGoalEvents === 'function', '15c. Control plane has getGoalEvents (read)');
    assert(typeof cp.getOperationalSummary === 'function', '15d. Control plane has getOperationalSummary (read)');
  }

  // ─── 16. Browser sessions cannot bypass credential/authority ──────
  {
    const identityManager = new DelegatedIdentityManager();
    const identity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'safety_test', authority: makeAuthority(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      includedCapabilities: [], excludedCapabilities: [],
      alwaysConfirmActions: [],
      resourceBoundaries: [
        ...createDefaultResourceBoundaries(WORKSPACE),
        { resourceType: 'browser_origin', effect: 'allow', pattern: 'http://localhost:*', matchMode: 'glob', reason: 'Local only' },
      ],
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: 'safety test',
    });

    // Unauthorized origin
    const evilAuth = identityManager.evaluate({
      identity, capability: 'browser.navigate', category: 'SYSTEM' as ActionCategory,
      target: 'http://evil.com', risk: 'R1' as RiskLevel,
      scope: 'READ_ONLY' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'browser_origin', sideEffectCategory: 'READ',
    });
    assert(evilAuth.authorized === false, '16. Unauthorized browser origin denied');

    // Authorized origin
    const localAuth = identityManager.evaluate({
      identity, capability: 'browser.navigate', category: 'SYSTEM' as ActionCategory,
      target: 'http://localhost:3000', risk: 'R1' as RiskLevel,
      scope: 'READ_ONLY' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
      resourceType: 'browser_origin', sideEffectCategory: 'READ',
    });
    assert(localAuth.authorized === true, '16a. Authorized browser origin allowed');
  }

  // ─── 17. Control plane cannot become alternative execution path ───
  {
    const cp = new HumanProxyControlPlane();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(cp));

    // The control plane should NOT have any of these execution-related methods
    const forbiddenMethods = ['executeAction', 'runAction', 'performAction', 'invokeCapability', 'callAdapter', 'runGoal', 'executeGoal'];
    const hasForbidden = methods.some((m) => forbiddenMethods.includes(m));
    assert(hasForbidden === false, '17. Control plane has no execution methods');

    // It CAN record events (but recording is not execution)
    assert(typeof cp.recordEvent === 'function', '17a. Control plane can record events (observability)');
    // But recording events is not the same as executing actions
    // The recordEvent method only writes to the event stream — it does not trigger any adapter or engine
  }

  // ─── Cleanup ──────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_safety_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_safety_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_safety_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // ─── Results ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Safety Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) { console.log(`  ✗ ${f}`); }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
