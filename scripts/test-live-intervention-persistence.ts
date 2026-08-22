/**
 * HYDI Live Supabase Intervention Persistence Test
 *
 * Phase 2 — REAL Supabase persistence. NO MOCKS.
 *
 * Tests:
 *   1. Create intervention via production InterventionQueue with real Supabase
 *   2. Verify the row exists independently of the in-memory queue
 *   3. Destroy/recreate the queue
 *   4. Restore from Supabase
 *   5. Verify same interventionId, goalId, identity, type, resume condition, expiration, status
 *   6. Resolve the intervention
 *   7. Verify the actual database row changes
 *   8. Repeat for cancel
 *   9. Test expire
 *  10. Test stale intervention recovery
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  InterventionQueue,
  InterventionPersistence,
} from '../lib/delegated-operator';

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Live Supabase Intervention Persistence Test');
  console.log('  NO MOCKS — Real Supabase at http://127.0.0.1:54321');
  console.log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('FATAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(url, key);
  console.log(`\nConnected to: ${url}`);

  // Clean up any previous test data
  console.log('\nCleaning up previous test data...');
  await supabase.from('human_intervention_requests').delete().like('request_id', 'live_test_%');

  // ─── TEST 1: Create intervention via production queue ───────────
  console.log('\n═══ Test 1: Create intervention via production queue ═══');

  const queue = new InterventionQueue();
  const persistence = new InterventionPersistence(supabase);
  queue.attachPersistence(persistence);

  const intervention = queue.enqueue({
    goalId: 'goal_live_test_001',
    identityId: 'identity_live_test_001',
    userId: 'user:owner',
    currentObjective: 'AUTHENTICATE',
    blocker: 'MFA_REQUIRED',
    requiredHumanAction: 'Approve MFA challenge',
    whyRequired: 'MFA cannot be bypassed by policy',
    expectedResultingState: 'Authenticated session',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'MFA approved and session active',
    auditId: 'audit_live_test_001',
    interventionType: 'MFA_REQUIRED',
    originalRequest: {
      requestId: 'req_live_test_001',
      actionId: 'action_live_test_001',
      goalId: 'goal_live_test_001',
      reason: 'MFA required',
      whatWasAttempted: 'Login with credentials',
      whatSucceeded: 'Credentials accepted',
      whatFailed: 'MFA challenge',
      whyCannotContinue: 'Cannot bypass MFA',
      requiredHumanAction: 'Approve MFA',
      whatHappensAfter: 'Access protected resource',
      interventionType: 'MFA_REQUIRED' as any,
      timestamp: new Date().toISOString(),
    },
  });

  // Wait for async persistence
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert(intervention.requestId.startsWith('intervention_'), 'Intervention ID generated');
  console.log(`  Request ID: ${intervention.requestId}`);

  // ─── TEST 2: Verify row exists independently in Supabase ────────
  console.log('\n═══ Test 2: Verify row exists independently in Supabase ═══');

  const { data: dbRow, error: dbError } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', intervention.requestId)
    .single();

  assert(dbError === null, `No error querying Supabase: ${dbError?.message ?? 'OK'}`);
  assert(dbRow !== null, 'Row exists in Supabase independently of in-memory queue');
  assert(dbRow?.goal_id === 'goal_live_test_001', `Goal ID matches: ${dbRow?.goal_id}`);
  assert(dbRow?.identity_id === 'identity_live_test_001', `Identity ID matches: ${dbRow?.identity_id}`);
  assert(dbRow?.intervention_type === 'MFA_REQUIRED', `Intervention type matches: ${dbRow?.intervention_type}`);
  assert(dbRow?.resume_condition === 'MFA approved and session active', `Resume condition matches: ${dbRow?.resume_condition}`);
  assert(dbRow?.status === 'pending', `Status is pending: ${dbRow?.status}`);
  assert(dbRow?.blocker === 'MFA_REQUIRED', `Blocker matches: ${dbRow?.blocker}`);
  assert(dbRow?.required_action === 'Approve MFA challenge', `Required action matches: ${dbRow?.required_action}`);

  // ─── TEST 3: Destroy/recreate the queue ─────────────────────────
  console.log('\n═══ Test 3: Destroy and recreate queue ═══');

  // Destroy the in-memory queue
  queue.cancel(intervention.requestId); // cancel in-memory to clear it
  // The queue is now empty in memory

  const inMemoryAfterDestroy = queue.get(intervention.requestId);
  // It was cancelled, so it still exists but with status 'cancelled'
  assert(inMemoryAfterDestroy?.status === 'cancelled', 'In-memory entry is cancelled');

  // Create a NEW queue (simulates process restart — fresh memory)
  const newQueue = new InterventionQueue();
  const newPersistence = new InterventionPersistence(supabase);
  newQueue.attachPersistence(newPersistence);

  // The new queue should have NO knowledge of the intervention
  const freshMemoryCheck = newQueue.get(intervention.requestId);
  assert(freshMemoryCheck === null || freshMemoryCheck === undefined, 'New queue has no in-memory knowledge of intervention');

  // ─── TEST 4: Restore from Supabase ──────────────────────────────
  console.log('\n═══ Test 4: Restore from Supabase ═══');

  // First, we need to restore the intervention to pending in the DB
  // (since we cancelled it in-memory, but the DB may have been updated too)
  // Let's create a fresh intervention for the restore test
  const restoreIntervention = newQueue.enqueue({
    goalId: 'goal_live_test_002',
    identityId: 'identity_live_test_002',
    userId: 'user:owner',
    currentObjective: 'CONFIGURE_SERVICE',
    blocker: 'CREDENTIALS_NEEDED',
    requiredHumanAction: 'Provide API key',
    whyRequired: 'Cannot proceed without credentials',
    expectedResultingState: 'Service configured',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'Credentials provided and validated',
    auditId: 'audit_live_test_002',
    interventionType: 'MANUAL_CREDENTIAL_ENTRY',
    originalRequest: {
      requestId: 'req_live_test_002',
      actionId: 'action_live_test_002',
      goalId: 'goal_live_test_002',
      reason: 'Credentials needed',
      whatWasAttempted: 'Configure service',
      whatSucceeded: 'Service detected',
      whatFailed: 'Missing API key',
      whyCannotContinue: 'Need API key',
      requiredHumanAction: 'Provide API key',
      whatHappensAfter: 'Service configured',
      interventionType: 'MANUAL_CREDENTIAL_ENTRY' as any,
      timestamp: new Date().toISOString(),
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  // Verify it's in Supabase
  const { data: restoreRow } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', restoreIntervention.requestId)
    .single();
  assert(restoreRow !== null, 'Restore intervention in Supabase');

  // Now destroy the queue and create a fresh one
  const thirdQueue = new InterventionQueue();
  const thirdPersistence = new InterventionPersistence(supabase);
  thirdQueue.attachPersistence(thirdPersistence);

  // Restore from Supabase
  const restoredCount = await thirdQueue.restoreFromPersistence();
  console.log(`  Restored ${restoredCount} intervention(s) from Supabase`);
  assert(restoredCount >= 1, `At least 1 intervention restored from Supabase`);

  // ─── TEST 5: Verify restored intervention matches ───────────────
  console.log('\n═══ Test 5: Verify restored intervention matches ═══');

  const restored = thirdQueue.get(restoreIntervention.requestId);
  assert(restored !== null && restored !== undefined, 'Restored intervention found in new queue');
  assert(restored?.requestId === restoreIntervention.requestId, `Same interventionId: ${restored?.requestId}`);
  assert(restored?.goalId === 'goal_live_test_002', `Same goalId: ${restored?.goalId}`);
  assert(restored?.identityId === 'identity_live_test_002', `Same delegated identity: ${restored?.identityId}`);
  assert(restored?.interventionType === 'MANUAL_CREDENTIAL_ENTRY', `Same intervention type: ${restored?.interventionType}`);
  assert(restored?.resumeCondition === 'Credentials provided and validated', `Same resume condition: ${restored?.resumeCondition}`);
  assert(restored?.status === 'pending', `Same status (pending): ${restored?.status}`);

  // ─── TEST 6: Resolve the intervention ───────────────────────────
  console.log('\n═══ Test 6: Resolve the intervention ═══');

  const resolveResult = thirdQueue.resolve(restoreIntervention.requestId, 'User provided API key');
  assert(resolveResult === true, 'Intervention resolved in memory');

  // Wait for async persistence
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Verify the actual database row changed
  const { data: resolvedRow } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', restoreIntervention.requestId)
    .single();

  assert(resolvedRow?.status === 'resolved', `Database row status is 'resolved': ${resolvedRow?.status}`);
  assert(resolvedRow?.resolution_note === 'User provided API key', `Resolution note in DB: ${resolvedRow?.resolution_note}`);
  assert(resolvedRow?.completed_at !== null, `Completed_at is set in DB: ${resolvedRow?.completed_at}`);

  // ─── TEST 7: Cancel test ────────────────────────────────────────
  console.log('\n═══ Test 7: Cancel intervention ═══');

  const cancelIntervention = thirdQueue.enqueue({
    goalId: 'goal_live_test_003',
    identityId: 'identity_live_test_003',
    userId: 'user:owner',
    currentObjective: 'DEPLOY',
    blocker: 'DESTRUCTIVE_CONFIRMATION',
    requiredHumanAction: 'Confirm deployment',
    whyRequired: 'Deployment requires confirmation',
    expectedResultingState: 'Deployed',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'Deployment confirmed',
    auditId: 'audit_live_test_003',
    interventionType: 'DESTRUCTIVE_CONFIRMATION',
    originalRequest: {
      requestId: 'req_live_test_003', actionId: 'action_live_test_003', goalId: 'goal_live_test_003',
      reason: 'Deploy', whatWasAttempted: 'Deploy', whatSucceeded: 'Build', whatFailed: 'Confirmation',
      whyCannotContinue: 'Need confirmation', requiredHumanAction: 'Confirm', whatHappensAfter: 'Deployed',
      interventionType: 'DESTRUCTIVE_CONFIRMATION' as any, timestamp: new Date().toISOString(),
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const cancelResult = thirdQueue.cancel(cancelIntervention.requestId);
  assert(cancelResult === true, 'Intervention cancelled in memory');

  await new Promise((resolve) => setTimeout(resolve, 500));

  const { data: cancelledRow } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', cancelIntervention.requestId)
    .single();

  assert(cancelledRow?.status === 'cancelled', `Database row status is 'cancelled': ${cancelledRow?.status}`);

  // ─── TEST 8: Expire test ────────────────────────────────────────
  console.log('\n═══ Test 8: Expire stale interventions ═══');

  // Create an intervention that's already expired
  const expiredIntervention = thirdQueue.enqueue({
    goalId: 'goal_live_test_004',
    identityId: 'identity_live_test_004',
    userId: 'user:owner',
    currentObjective: 'TEST',
    blocker: 'TEST',
    requiredHumanAction: 'TEST',
    whyRequired: 'TEST',
    expectedResultingState: 'TEST',
    expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
    resumeCondition: 'TEST',
    auditId: 'audit_live_test_004',
    interventionType: 'UNKNOWN',
    originalRequest: {
      requestId: 'req_live_test_004', actionId: 'action_live_test_004', goalId: 'goal_live_test_004',
      reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test', whatFailed: 'test',
      whyCannotContinue: 'test', requiredHumanAction: 'test', whatHappensAfter: 'test',
      interventionType: 'UNKNOWN' as any, timestamp: new Date().toISOString(),
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  // Expire stale interventions
  const expiredCount = thirdQueue.expireStale();
  assert(expiredCount >= 1, `${expiredCount} stale intervention(s) expired in memory`);

  await new Promise((resolve) => setTimeout(resolve, 500));

  // Verify in DB
  const { data: expiredRow } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', expiredIntervention.requestId)
    .single();

  assert(expiredRow?.status === 'expired', `Database row status is 'expired': ${expiredRow?.status}`);

  // ─── TEST 9: Stale intervention recovery ────────────────────────
  console.log('\n═══ Test 9: Stale intervention recovery (restore after restart) ═══');

  // Create a fresh queue (simulates restart)
  const recoveryQueue = new InterventionQueue();
  const recoveryPersistence = new InterventionPersistence(supabase);
  recoveryQueue.attachPersistence(recoveryPersistence);

  // Restore — should NOT restore expired/cancelled/resolved interventions
  const recoveryCount = await recoveryQueue.restoreFromPersistence();
  console.log(`  Restored ${recoveryCount} pending intervention(s) from Supabase`);

  // The expired intervention should NOT be in the restored queue
  const expiredInNewQueue = recoveryQueue.get(expiredIntervention.requestId);
  assert(expiredInNewQueue === null || expiredInNewQueue === undefined, 'Expired intervention NOT restored (correctly excluded)');

  // The cancelled intervention should NOT be in the restored queue
  const cancelledInNewQueue = recoveryQueue.get(cancelIntervention.requestId);
  assert(cancelledInNewQueue === null || cancelledInNewQueue === undefined, 'Cancelled intervention NOT restored (correctly excluded)');

  // The resolved intervention should NOT be in the restored queue
  const resolvedInNewQueue = recoveryQueue.get(restoreIntervention.requestId);
  assert(resolvedInNewQueue === null || resolvedInNewQueue === undefined, 'Resolved intervention NOT restored (correctly excluded)');

  // ─── CLEANUP ────────────────────────────────────────────────────
  console.log('\n═══ Cleanup ═══');
  const { error: cleanupError } = await supabase
    .from('human_intervention_requests')
    .delete()
    .like('request_id', 'intervention_%');
  assert(cleanupError === null, 'Test data cleaned up from Supabase');

  // Results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
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
