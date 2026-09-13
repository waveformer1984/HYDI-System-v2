/**
 * HYDI Event-Sourced Operational History — Phase 3
 *
 * Verifies that every important transition emits an event and that
 * the event history is sufficient to reconstruct operational history.
 *
 * Also verifies:
 * - Event idempotency (duplicate records with same key don't create duplicates)
 * - Event ordering (sequence numbers are monotonic per goal)
 * - Event secret safety (no secrets in any event)
 * - New event types are supported (GOAL_ACCEPTED, DEVIATION_DETECTED, etc.)
 * - Duplicate event emission does not create contradictory state
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
  OperationalEventStream,
  isOperationalEventClean,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  initializePersistence,
} from '../lib/delegated-operator';
import type { OperationalEventType } from '../lib/delegated-operator/OperationalEvent';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Event-Sourced Operational History — Phase 3');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_evt_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_evt_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_evt_%');

  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'evt_test', authority: {
      authorityId: 'auth_evt', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'evt_test' },
      requiresConfirmation: {
        destructiveActions: true, financialActions: true, externalCommunication: true,
        deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
      },
      purpose: 'event test', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: [],
    sideEffectPolicies: [],
    purpose: 'event test',
  });

  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);

  const goalId = 'goal_evt_001';

  // ─── Test 1: All required event types can be recorded ─────────────
  console.log('  ─── All Required Event Types ───');
  const requiredEvents: OperationalEventType[] = [
    'GOAL_CREATED', 'GOAL_ACCEPTED', 'GOAL_STARTED', 'PLAN_CREATED',
    'ACTION_SELECTED', 'AUTHORIZATION_GRANTED', 'AUTHORIZATION_DENIED',
    'SAFETY_DENIAL', 'ACTION_STARTED', 'ACTION_COMPLETED', 'ACTION_FAILED',
    'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED',
    'DEVIATION_DETECTED', 'REPLAN_STARTED', 'REPLAN_COMPLETED',
    'INTERVENTION_REQUIRED', 'INTERVENTION_APPROVED', 'INTERVENTION_REJECTED',
    'INTERVENTION_CANCELLED', 'INTERVENTION_EXPIRED',
    'CHECKPOINT_CREATED', 'CHECKPOINT_RESTORED', 'CHECKPOINT_REJECTED',
    'RECOVERY_STARTED', 'RECOVERY_COMPLETED', 'STALE_STATE_DETECTED',
    'GOAL_PAUSED', 'GOAL_RESUMED', 'GOAL_COMPLETED', 'GOAL_FAILED',
    'GOAL_CANCELLED', 'GOAL_EXPIRED',
  ];

  for (const evtType of requiredEvents) {
    try {
      await controlPlane.recordEvent({
        goalId, identityId: identity.identityId, eventType: evtType,
        payload: { reason: `test ${evtType}` },
      });
      assert(true, `Event type ${evtType} can be recorded`);
    } catch (err) {
      assert(false, `Event type ${evtType} can be recorded: ${err}`);
    }
  }

  // ─── Test 2: Event ordering ───────────────────────────────────────
  console.log('\n  ─── Event Ordering ───');
  const events = controlPlane.getGoalEvents(goalId);
  assert(events.length === requiredEvents.length, `All ${requiredEvents.length} events recorded (got ${events.length})`);

  let lastSeq = 0;
  let ordered = true;
  for (const evt of events) {
    if (evt.sequence <= lastSeq) { ordered = false; break; }
    lastSeq = evt.sequence;
  }
  assert(ordered, 'Events are in monotonic sequence order');

  // ─── Test 3: Event secret safety ──────────────────────────────────
  console.log('\n  ─── Event Secret Safety ───');
  // Record an event with secrets in the payload
  const goalId2 = 'goal_evt_002';
  await controlPlane.recordEvent({
    goalId: goalId2, identityId: identity.identityId, eventType: 'ACTION_COMPLETED',
    payload: {
      capability: 'stripe.create_charge',
      targetResource: 'stripe',
      riskLevel: 'R3',
      errorMessage: 'Failed with key sk_live_FAKE1234567890 and password=SecretPass and Bearer eyJfake.jwt.token',
    },
  });
  const events2 = controlPlane.getGoalEvents(goalId2);
  const secretEvent = events2.find((e) => e.eventType === 'ACTION_COMPLETED');
  assert(secretEvent !== undefined, 'Secret-bearing event recorded');
  if (secretEvent) {
    assert(isOperationalEventClean(secretEvent), 'Secret event is clean after sanitization');
    const evtStr = JSON.stringify(secretEvent);
    assert(!evtStr.includes('sk_live_FAKE'), 'No sk_live in event');
    assert(!evtStr.includes('password=SecretPass'), 'No password in event');
    assert(!evtStr.includes('Bearer eyJfake'), 'No Bearer token in event');
  }

  // ─── Test 4: Idempotency ──────────────────────────────────────────
  console.log('\n  ─── Event Idempotency ───');
  const goalId3 = 'goal_evt_003';
  const idempotencyKey = `idem_${goalId3}_001`;
  const evt1 = await controlPlane.recordEvent({
    goalId: goalId3, identityId: identity.identityId, eventType: 'GOAL_CREATED',
    payload: { goalText: 'Idempotency test' },
    idempotencyKey,
  });
  const evt2 = await controlPlane.recordEvent({
    goalId: goalId3, identityId: identity.identityId, eventType: 'GOAL_CREATED',
    payload: { goalText: 'Idempotency test duplicate' },
    idempotencyKey,
  });
  assert(evt1.eventId === evt2.eventId, 'Duplicate idempotency key returns same event');
  assert(evt1.sequence === evt2.sequence, 'Duplicate idempotency key returns same sequence');
  const events3 = controlPlane.getGoalEvents(goalId3);
  assert(events3.length === 1, 'Only one event recorded for duplicate idempotency key');

  // ─── Test 5: Event history reconstructs operational timeline ──────
  console.log('\n  ─── Event History Reconstruction ───');
  const goalId4 = 'goal_evt_004';
  const timeline: Array<{ type: OperationalEventType; payload: Record<string, unknown> }> = [
    { type: 'GOAL_CREATED', payload: { goalText: 'Reconstruction test' } },
    { type: 'GOAL_ACCEPTED', payload: { reason: 'Accepted by system' } },
    { type: 'GOAL_STARTED', payload: { planVersion: 1 } },
    { type: 'PLAN_CREATED', payload: { planVersion: 1 } },
    { type: 'ACTION_SELECTED', payload: { capability: 'filesystem.write_file', targetResource: '/tmp/test.txt', riskLevel: 'R1' } },
    { type: 'AUTHORIZATION_GRANTED', payload: { capability: 'filesystem.write_file', authorizationState: 'authorized' } },
    { type: 'ACTION_STARTED', payload: { capability: 'filesystem.write_file', targetResource: '/tmp/test.txt' } },
    { type: 'ACTION_COMPLETED', payload: { capability: 'filesystem.write_file', result: 'success' } },
    { type: 'VERIFICATION_PASSED', payload: { verificationContract: 'filesystem.write_file', verificationResult: 'verified' } },
    { type: 'CHECKPOINT_CREATED', payload: { checkpointId: 'ckpt_test_001', checkpointStatus: 'RUNNING' } },
    { type: 'GOAL_COMPLETED', payload: { result: 'success' } },
  ];

  for (const step of timeline) {
    await controlPlane.recordEvent({
      goalId: goalId4, identityId: identity.identityId,
      eventType: step.type, payload: step.payload,
    });
  }

  const history = controlPlane.getGoalEvents(goalId4);
  assert(history.length === timeline.length, `History has ${timeline.length} events (got ${history.length})`);

  // Verify the timeline can be reconstructed
  for (let i = 0; i < timeline.length; i++) {
    assert(history[i].eventType === timeline[i].type, `History[${i}] type matches: ${timeline[i].type}`);
  }

  // Verify the history tells a coherent story
  const hasGoalCreated = history.some((e) => e.eventType === 'GOAL_CREATED');
  const hasGoalStarted = history.some((e) => e.eventType === 'GOAL_STARTED');
  const hasActionCompleted = history.some((e) => e.eventType === 'ACTION_COMPLETED');
  const hasVerification = history.some((e) => e.eventType === 'VERIFICATION_PASSED');
  const hasGoalCompleted = history.some((e) => e.eventType === 'GOAL_COMPLETED');
  assert(hasGoalCreated && hasGoalStarted && hasActionCompleted && hasVerification && hasGoalCompleted, 'History tells coherent story: created → started → action → verify → completed');

  // ─── Test 6: Duplicate event emission doesn't create contradictory state ───
  console.log('\n  ─── Duplicate Event Safety ───');
  const goalId5 = 'goal_evt_005';
  // Record GOAL_COMPLETED twice (without idempotency key)
  await controlPlane.recordEvent({ goalId: goalId5, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: { result: 'success' } });
  await controlPlane.recordEvent({ goalId: goalId5, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: { result: 'success' } });
  const events5 = controlPlane.getGoalEvents(goalId5);
  assert(events5.length === 2, 'Two GOAL_COMPLETED events recorded (no idempotency key)');
  // Both should have different sequence numbers
  assert(events5[0].sequence !== events5[1].sequence, 'Duplicate events have different sequence numbers');
  // Both should have different event IDs
  assert(events5[0].eventId !== events5[1].eventId, 'Duplicate events have different event IDs');

  // ─── Test 7: Event persistence to Supabase ────────────────────────
  console.log('\n  ─── Event Persistence ───');
  // Verify events were persisted to Supabase
  const { data: persistedEvents } = await supabase
    .from('adaptive_operator_events')
    .select('*')
    .eq('goal_id', goalId4)
    .order('created_at', { ascending: true });
  assert(persistedEvents !== null, 'Events persisted to Supabase');
  assert((persistedEvents?.length ?? 0) === timeline.length, `All ${timeline.length} events persisted to Supabase (got ${persistedEvents?.length})`);

  // ─── Test 8: Event restoration from Supabase ──────────────────────
  console.log('\n  ─── Event Restoration ───');
  // Use a fresh event stream (not the singleton) to verify restoration
  const { OperationalEventPersistence } = require('../lib/delegated-operator/OperationalEvent');
  const freshStream = new OperationalEventStream();
  freshStream.attachPersistence(new OperationalEventPersistence(supabase));
  const restoredCount = await freshStream.restoreFromPersistence([goalId4]);
  assert(restoredCount > 0, `Events restored from Supabase: ${restoredCount}`);
  const restoredEvents = freshStream.getEvents(goalId4);
  assert(restoredEvents.length === timeline.length, `Restored ${timeline.length} events (got ${restoredEvents.length})`);

  // ─── Cleanup ──────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_evt_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_evt_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_evt_%');

  // ─── Results ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Event History Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) { console.log('\nFailures:'); for (const f of failures) { console.log(`  ✗ ${f}`); } }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
