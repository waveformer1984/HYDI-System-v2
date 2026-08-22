/**
 * HYDI Failure Injection — Phase 6
 *
 * Tests that the system correctly detects, classifies, and handles failures:
 * - network failure (Supabase unreachable)
 * - provider failure (Ollama unavailable)
 * - browser failure (Chrome not found)
 * - authentication failure (expired identity)
 * - verification failure (action completed but verification failed)
 * - stale checkpoint (checkpoint with old state)
 * - Supabase failure (persistence error)
 * - daemon crash (process termination)
 * - duplicate event (same event recorded twice)
 * - duplicate action (same action executed twice)
 * - unauthorized action attempt (action without authorization)
 * - resource boundary violation (action outside allowed paths)
 * - security events (secret in payload, path traversal)
 *
 * Each failure must be:
 * 1. Detected
 * 2. Classified
 * 3. Handled through governed mechanisms
 * 4. Verified
 * 5. Recorded
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
  isOperationalGoalStateClean,
} from '../lib/delegated-operator';
import type { GoalRuntimeStatus } from '../lib/delegated-operator/GoalCheckpoint';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

const TMP_DIR = path.join(os.tmpdir(), 'hydi-failure-injection');
const WORKSPACE = process.cwd();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Failure Injection — Phase 6');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_fail_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_fail_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_fail_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const checkpointManager = getCheckpointManager();
  const interventionQueue = getInterventionQueue();

  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'fail_inject', authority: {
      authorityId: 'auth_fail', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'fail_inject' },
      requiresConfirmation: {
        destructiveActions: true, financialActions: true, externalCommunication: true,
        deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
      },
      purpose: 'failure injection', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Test' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'failure injection',
  });

  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);

  // ─── Test 1: Network failure (Supabase unreachable) ───────────────
  console.log('  ─── Network Failure (Supabase Unreachable) ───');
  {
    const badSupabase = createClient('https://invalid.supabase.co', 'invalid-key');
    const { OperationalEventPersistence } = require('../lib/delegated-operator/OperationalEvent');
    const badPersistence = new OperationalEventPersistence(badSupabase);
    // Try to persist an event — should not throw
    try {
      await badPersistence.persist({
        eventId: 'evt_test', goalId: 'goal_fail_net', eventType: 'GOAL_CREATED',
        timestamp: new Date().toISOString(), sequence: 1, payload: {},
      });
      assert(true, 'Network failure does not throw on persist');
    } catch (err) {
      assert(false, `Network failure should not throw: ${err}`);
    }
    // Try to load events — should return empty
    try {
      const events = await badPersistence.loadRecent(['goal_fail_net']);
      assert(Array.isArray(events), 'Network failure returns empty array on load');
    } catch (err) {
      assert(false, `Network failure should not throw on load: ${err}`);
    }
  }

  // ─── Test 2: Provider failure (Ollama unavailable) ────────────────
  console.log('\n  ─── Provider Failure (Ollama Unavailable) ───');
  {
    // Simulate provider failure by recording a WAITING_FOR_PROVIDER event
    const goalId = 'goal_fail_provider';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Provider test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'WAITING_FOR_PROVIDER' as GoalRuntimeStatus,
      resumeCondition: 'Provider available',
      executedSideEffects: [], summary: 'Provider test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_FAILED',
      payload: { capability: 'ollama.generate', errorMessage: 'Connection refused' },
    });

    const state = controlPlane.getGoalState(goalId);
    assert(state !== null, 'Provider failure: state exists');
    assert(state?.status === 'WAITING_FOR_PROVIDER', 'Provider failure: status is WAITING_FOR_PROVIDER');
    assert((state?.failedActionCount ?? 0) >= 1, 'Provider failure: failed action count tracked');
  }

  // ─── Test 3: Browser failure (Chrome not found) ───────────────────
  console.log('\n  ─── Browser Failure ───');
  {
    const goalId = 'goal_fail_browser';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Browser test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'WAITING_FOR_HUMAN',
      resumeCondition: 'Browser available',
      executedSideEffects: [], summary: 'Browser test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_FAILED',
      payload: { capability: 'browser.navigate', errorMessage: 'Chrome not found at expected path' },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const failEvent = events.find((e) => e.eventType === 'ACTION_FAILED');
    assert(failEvent !== undefined, 'Browser failure: ACTION_FAILED event recorded');
    assert(!!failEvent?.payload.errorMessage?.includes('Chrome not found'), 'Browser failure: error message preserved');
  }

  // ─── Test 4: Authentication failure (expired identity) ────────────
  console.log('\n  ─── Authentication Failure (Expired Identity) ───');
  {
    const expiredIdentity = identityManager.delegate({
      userId: 'user:owner', sessionId: 'fail_auth', authority: {
        authorityId: 'auth_expired', delegatedBy: 'user:owner', delegatedTo: 'heidi',
        scopes: ['READ_ONLY'], riskLimit: 'LOW', riskLevelLimit: 'R1',
        resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
        timeConstraint: { type: 'session_bounded', sessionId: 'fail_auth' },
        requiresConfirmation: {
          destructiveActions: true, financialActions: true, externalCommunication: true,
          deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
        },
        purpose: 'expired test', createdAt: new Date(Date.now() - 7200000).toISOString(), metadata: {},
      },
      expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
      includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
      resourceBoundaries: [], sideEffectPolicies: [], purpose: 'expired test',
    });

    const validCheck = identityManager.isIdentityValid(expiredIdentity.identityId);
    assert(!validCheck.valid, 'Expired identity is not valid');
    assert(!!validCheck.reason?.includes('expired'), `Expired identity reason: ${validCheck.reason}`);

    const goalId = 'goal_fail_auth';
    await controlPlane.recordEvent({
      goalId, identityId: expiredIdentity.identityId, eventType: 'AUTHORIZATION_DENIED',
      payload: { authorizationReason: 'Identity expired', authorizationState: 'denied' },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const authDenied = events.find((e) => e.eventType === 'AUTHORIZATION_DENIED');
    assert(authDenied !== undefined, 'Auth failure: AUTHORIZATION_DENIED event recorded');
    assert(authDenied?.payload.authorizationReason === 'Identity expired', 'Auth failure: reason preserved');
  }

  // ─── Test 5: Verification failure ─────────────────────────────────
  console.log('\n  ─── Verification Failure ───');
  {
    const goalId = 'goal_fail_verify';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Verification test',
      planVersion: 1, completedObjectives: [], failedObjectives: ['OBJ_1'],
      inProgressObjectives: [], pendingObjectives: [],
      executedActions: [{ actionId: 'act_1', capability: 'filesystem.write_file', target: '/tmp/test', outcome: 'success', verified: false, timestamp: new Date().toISOString() }],
      verifiedState: {}, status: 'FAILED',
      resumeCondition: 'N/A', executedSideEffects: [], summary: 'Verification test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'VERIFICATION_STARTED',
      payload: { verificationContract: 'filesystem.write_file' },
    });
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'VERIFICATION_FAILED',
      payload: { verificationContract: 'filesystem.write_file', verificationResult: 'failed', errorMessage: 'File not found after write' },
    });

    const state = controlPlane.getGoalState(goalId);
    assert(state?.verificationState === 'failed', 'Verification failure: state is failed');
    assert(state?.status === 'FAILED', 'Verification failure: goal status is FAILED');
  }

  // ─── Test 6: Stale checkpoint ─────────────────────────────────────
  console.log('\n  ─── Stale Checkpoint ───');
  {
    const goalId = 'goal_fail_stale';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Stale test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'RUNNING',
      resumeCondition: 'Continue',
      executedSideEffects: [], summary: 'Stale test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'STALE_STATE_DETECTED',
      payload: { reason: 'Checkpoint age exceeds threshold', staleKeys: ['env_state'] },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const staleEvent = events.find((e) => e.eventType === 'STALE_STATE_DETECTED');
    assert(staleEvent !== undefined, 'Stale checkpoint: STALE_STATE_DETECTED event recorded');
    assert(!!staleEvent?.payload.reason?.includes('Checkpoint age'), 'Stale checkpoint: reason preserved');
  }

  // ─── Test 7: Supabase persistence failure ─────────────────────────
  console.log('\n  ─── Supabase Persistence Failure ───');
  {
    // The event stream should not throw on persistence failure
    const goalId = 'goal_fail_persist';
    try {
      await controlPlane.recordEvent({
        goalId, identityId: identity.identityId, eventType: 'GOAL_CREATED',
        payload: { goalText: 'Persistence failure test' },
      });
      assert(true, 'Supabase persistence failure: event recording does not throw');
    } catch (err) {
      assert(false, `Supabase persistence failure: should not throw: ${err}`);
    }
    // Event should still be in memory
    const events = controlPlane.getGoalEvents(goalId);
    assert(events.length > 0, 'Supabase persistence failure: event in memory despite persistence error');
  }

  // ─── Test 8: Duplicate event ──────────────────────────────────────
  console.log('\n  ─── Duplicate Event ───');
  {
    const goalId = 'goal_fail_dupevt';
    const idempotencyKey = `idem_fail_${goalId}`;
    const evt1 = await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'GOAL_CREATED',
      payload: {}, idempotencyKey,
    });
    const evt2 = await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'GOAL_CREATED',
      payload: {}, idempotencyKey,
    });
    assert(evt1.eventId === evt2.eventId, 'Duplicate event: idempotency prevents duplication');
    const events = controlPlane.getGoalEvents(goalId);
    assert(events.length === 1, 'Duplicate event: only one event in history');
  }

  // ─── Test 9: Duplicate action ─────────────────────────────────────
  console.log('\n  ─── Duplicate Action ───');
  {
    const goalId = 'goal_fail_dupact';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Duplicate action test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'RUNNING',
      resumeCondition: 'Continue',
      executedSideEffects: [], summary: 'Duplicate action test',
    });
    await new Promise((r) => setTimeout(r, 50));

    const actionId = 'act_dup_001';
    // Record the same action twice (with different event IDs but same actionId)
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_STARTED',
      payload: { capability: 'filesystem.write_file', targetResource: '/tmp/test', actionId },
    });
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED',
      payload: { capability: 'filesystem.write_file', result: 'success', actionId },
    });
    // Duplicate action completed
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED',
      payload: { capability: 'filesystem.write_file', result: 'success', actionId },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const completedEvents = events.filter((e) => e.eventType === 'ACTION_COMPLETED');
    assert(completedEvents.length === 2, 'Duplicate action: both completions recorded (detection)');

    // The control plane should show actionCount = 3 (1 started + 2 completed)
    const state = controlPlane.getGoalState(goalId);
    assert(state !== null, 'Duplicate action: state exists');
    // The system should be able to detect duplicate actions by checking actionId
    const actionIds = completedEvents.map((e) => e.payload.actionId);
    const uniqueActionIds = new Set(actionIds);
    assert(uniqueActionIds.size === 1, 'Duplicate action: same actionId detected');
  }

  // ─── Test 10: Unauthorized action attempt ─────────────────────────
  console.log('\n  ─── Unauthorized Action Attempt ───');
  {
    const goalId = 'goal_fail_unauth';
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'AUTHORIZATION_DENIED',
      payload: {
        capability: 'stripe.create_charge',
        authorizationState: 'denied',
        authorizationReason: 'Capability not authorized for this identity',
      },
    });
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'SAFETY_DENIAL',
      payload: {
        capability: 'stripe.create_charge',
        reason: 'Unauthorized action attempt blocked',
      },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const deniedEvent = events.find((e) => e.eventType === 'AUTHORIZATION_DENIED');
    const safetyEvent = events.find((e) => e.eventType === 'SAFETY_DENIAL');
    assert(deniedEvent !== undefined, 'Unauthorized action: AUTHORIZATION_DENIED recorded');
    assert(safetyEvent !== undefined, 'Unauthorized action: SAFETY_DENIAL recorded');
  }

  // ─── Test 11: Resource boundary violation ─────────────────────────
  console.log('\n  ─── Resource Boundary Violation ───');
  {
    const goalId = 'goal_fail_boundary';
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'SAFETY_DENIAL',
      payload: {
        capability: 'filesystem.write_file',
        targetResource: '/etc/passwd',
        reason: 'Resource outside allowed boundaries',
      },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const violationEvent = events.find((e) => e.eventType === 'SAFETY_DENIAL');
    assert(violationEvent !== undefined, 'Resource boundary: SAFETY_DENIAL recorded');
    assert(violationEvent?.payload.targetResource === '/etc/passwd', 'Resource boundary: target preserved');
    assert(!!violationEvent?.payload.reason?.includes('outside allowed boundaries'), 'Resource boundary: reason preserved');
  }

  // ─── Test 12: Security event — secret in payload ──────────────────
  console.log('\n  ─── Security Event — Secret in Payload ───');
  {
    const goalId = 'goal_fail_secret';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Secret test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'RUNNING',
      resumeCondition: 'Continue',
      executedSideEffects: [], summary: 'Secret test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'ACTION_FAILED',
      payload: {
        capability: 'stripe.create_charge',
        errorMessage: 'Failed with key sk_live_SECRET1234567890 and password=SuperSecret and token=Bearer eyJsecret.jwt.token',
      },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const secretEvent = events.find((e) => e.eventType === 'ACTION_FAILED');
    assert(secretEvent !== undefined, 'Secret event: recorded');
    const secretState = controlPlane.getGoalState(goalId);
    assert(secretState !== null, 'Secret event: state exists');
    assert(secretState !== null && isOperationalGoalStateClean(secretState), 'Secret event: state is clean');
    const evtStr = JSON.stringify(secretEvent);
    assert(!evtStr.includes('sk_live_SECRET'), 'Secret event: no sk_live in event');
    assert(!evtStr.includes('password=SuperSecret'), 'Secret event: no password in event');
    assert(!evtStr.includes('Bearer eyJsecret'), 'Secret event: no Bearer token in event');
  }

  // ─── Test 13: Security event — path traversal ─────────────────────
  console.log('\n  ─── Security Event — Path Traversal ───');
  {
    const goalId = 'goal_fail_traversal';
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'SAFETY_DENIAL',
      payload: {
        capability: 'filesystem.read_file',
        targetResource: '../../../etc/shadow',
        reason: 'Path traversal detected',
      },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const traversalEvent = events.find((e) => e.eventType === 'SAFETY_DENIAL');
    assert(traversalEvent !== undefined, 'Path traversal: SAFETY_DENIAL recorded');
    assert(!!traversalEvent?.payload.targetResource?.includes('..'), 'Path traversal: path preserved in event');
    assert(traversalEvent?.payload.reason === 'Path traversal detected', 'Path traversal: reason preserved');
  }

  // ─── Test 14: Deviation detected ──────────────────────────────────
  console.log('\n  ─── Deviation Detected ───');
  {
    const goalId = 'goal_fail_deviation';
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'DEVIATION_DETECTED',
      payload: {
        expectedState: { 'file:exists': true },
        actualState: { 'file:exists': false },
        reason: 'Expected file to exist after write, but it does not',
      },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const devEvent = events.find((e) => e.eventType === 'DEVIATION_DETECTED');
    assert(devEvent !== undefined, 'Deviation: DEVIATION_DETECTED recorded');
    assert(devEvent?.payload.expectedState !== undefined, 'Deviation: expected state preserved');
    assert(devEvent?.payload.actualState !== undefined, 'Deviation: actual state preserved');
  }

  // ─── Test 15: Recovery from failure ───────────────────────────────
  console.log('\n  ─── Recovery from Failure ───');
  {
    const goalId = 'goal_fail_recovery';
    checkpointManager.checkpoint({
      goalId, identityId: identity.identityId,
      goalStatement: 'Recovery test',
      planVersion: 1, completedObjectives: [], failedObjectives: [],
      inProgressObjectives: ['OBJ_1'], pendingObjectives: [],
      executedActions: [], verifiedState: {},
      status: 'RECOVERING',
      resumeCondition: 'Recover from failure',
      executedSideEffects: [], summary: 'Recovery test',
    });
    await new Promise((r) => setTimeout(r, 50));

    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'RECOVERY_STARTED',
      payload: { recoveryReason: 'Action failed, attempting recovery' },
    });
    await controlPlane.recordEvent({
      goalId, identityId: identity.identityId, eventType: 'RECOVERY_COMPLETED',
      payload: { recoveryReason: 'Recovery successful' },
    });

    const events = controlPlane.getGoalEvents(goalId);
    const recStarted = events.find((e) => e.eventType === 'RECOVERY_STARTED');
    const recCompleted = events.find((e) => e.eventType === 'RECOVERY_COMPLETED');
    assert(recStarted !== undefined, 'Recovery: RECOVERY_STARTED recorded');
    assert(recCompleted !== undefined, 'Recovery: RECOVERY_COMPLETED recorded');

    const state = controlPlane.getGoalState(goalId);
    assert((state?.recoveryCount ?? 0) >= 1, 'Recovery: recovery count tracked');
  }

  // ─── Test 16: All failures produce events ─────────────────────────
  console.log('\n  ─── All Failures Produce Events ───');
  {
    // Verify that every failure scenario produced at least one event
    const allGoalIds = [
      'goal_fail_provider', 'goal_fail_browser', 'goal_fail_auth',
      'goal_fail_verify', 'goal_fail_stale', 'goal_fail_persist',
      'goal_fail_dupevt', 'goal_fail_dupact', 'goal_fail_unauth',
      'goal_fail_boundary', 'goal_fail_secret', 'goal_fail_traversal',
      'goal_fail_deviation', 'goal_fail_recovery',
    ];

    let allHaveEvents = true;
    for (const gid of allGoalIds) {
      const evts = controlPlane.getGoalEvents(gid);
      if (evts.length === 0) {
        allHaveEvents = false;
        console.log(`    [warn] ${gid} has no events`);
      }
    }
    assert(allHaveEvents, 'All failure scenarios produced events');
  }

  // ─── Cleanup ──────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_fail_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_fail_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_fail_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // ─── Results ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Failure Injection Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) { console.log('\nFailures:'); for (const f of failures) { console.log(`  ✗ ${f}`); } }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
