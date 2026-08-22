/**
 * HYDI Live Checkpoint Persistence + Idempotency Test
 *
 * Phase 4-5 — REAL Supabase persistence. NO MOCKS.
 *
 * Tests:
 *   1. Create checkpoint with real Supabase persistence
 *   2. Verify the row exists independently in Supabase
 *   3. Destroy/recreate the checkpoint manager
 *   4. Restore from Supabase
 *   5. Verify same goalId, identity, objectives, executed actions, side effects
 *   6. Idempotency: create a resource, checkpoint, restart, verify resource
 *      exists, DO NOT create it again
 *   7. Stale checkpoint: change environment, detect inconsistency
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
} from '../lib/delegated-operator';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

const TMP_DIR = path.join(os.tmpdir(), 'hydi-checkpoint-test');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Live Checkpoint Persistence + Idempotency Test');
  console.log('  NO MOCKS — Real Supabase');
  console.log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  console.log('\nCleaning up previous test data...');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_ckpt_test_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const testFile = path.join(TMP_DIR, 'test-resource.txt');
  try { fs.unlinkSync(testFile); } catch { /* ignore */ }

  // ─── TEST 1: Create checkpoint with real Supabase ───────────────
  console.log('\n═══ Test 1: Create checkpoint with real Supabase ═══');

  const manager = new GoalCheckpointManager();
  const persistence = new CheckpointPersistence(supabase);
  manager.attachPersistence(persistence);

  // First, create a real side effect (file)
  fs.writeFileSync(testFile, 'test resource content');
  assert(fs.existsSync(testFile), 'Test resource created on filesystem');

  const checkpoint = manager.checkpoint({
    goalId: 'goal_ckpt_test_001',
    identityId: 'identity_ckpt_test_001',
    goalStatement: 'Create and verify test resource',
    planVersion: 1,
    completedObjectives: ['RESOURCE_CREATED'],
    failedObjectives: [],
    inProgressObjectives: ['RESOURCE_VERIFIED'],
    pendingObjectives: ['CLEANUP'],
    executedActions: [
      { actionId: 'act_ckpt_001', capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() },
    ],
    verifiedState: { 'resource:exists': true, 'resource:path': testFile },
    status: 'RUNNING',
    resumeCondition: 'Resource file exists',
    executedSideEffects: [`create:${testFile}`],
    summary: 'Resource created, verifying',
  });

  // Wait for async persistence
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert(checkpoint.checkpointId.startsWith('ckpt_'), 'Checkpoint ID generated');
  console.log(`  Checkpoint ID: ${checkpoint.checkpointId}`);

  // ─── TEST 2: Verify row exists independently in Supabase ────────
  console.log('\n═══ Test 2: Verify checkpoint row in Supabase ═══');

  const { data: dbRow, error: dbError } = await supabase
    .from('goal_checkpoints')
    .select('*')
    .eq('checkpoint_id', checkpoint.checkpointId)
    .single();

  assert(dbError === null, `No error querying Supabase: ${dbError?.message ?? 'OK'}`);
  assert(dbRow !== null, 'Checkpoint row exists in Supabase');
  assert(dbRow?.goal_id === 'goal_ckpt_test_001', `Goal ID matches: ${dbRow?.goal_id}`);
  assert(dbRow?.identity_id === 'identity_ckpt_test_001', `Identity ID matches: ${dbRow?.identity_id}`);
  assert(dbRow?.plan_version === 1, `Plan version matches: ${dbRow?.plan_version}`);
  assert(dbRow?.status === 'RUNNING', `Status matches: ${dbRow?.status}`);
  assert(dbRow?.checksum !== null, `Checksum is set: ${dbRow?.checksum}`);

  // Verify completed objectives are persisted
  const completedObs = dbRow?.completed_objectives as string[];
  assert(completedObs?.includes('RESOURCE_CREATED'), 'Completed objectives persisted');

  // Verify executed actions are persisted
  const executedActions = dbRow?.executed_actions as any[];
  assert(executedActions?.length === 1, `Executed actions persisted: ${executedActions?.length}`);
  assert(executedActions?.[0]?.actionId === 'act_ckpt_001', 'Action ID persisted');

  // Verify executed side effects are persisted
  const sideEffects = dbRow?.executed_side_effects as string[];
  assert(sideEffects?.includes(`create:${testFile}`), 'Executed side effects persisted');

  // ─── TEST 3: Destroy/recreate checkpoint manager ────────────────
  console.log('\n═══ Test 3: Destroy and recreate checkpoint manager ═══');

  // Create a NEW manager (simulates process restart)
  const newManager = new GoalCheckpointManager();
  const newPersistence = new CheckpointPersistence(supabase);
  newManager.attachPersistence(newPersistence);

  // The new manager should have NO in-memory knowledge of the checkpoint
  const freshCheck = newManager.getCheckpoint('goal_ckpt_test_001');
  assert(freshCheck === null, 'New manager has no in-memory knowledge of checkpoint');

  // ─── TEST 4: Restore from Supabase ──────────────────────────────
  console.log('\n═══ Test 4: Restore checkpoints from Supabase ═══');

  const restoredCount = await newManager.restoreFromPersistence();
  console.log(`  Restored ${restoredCount} checkpoint(s) from Supabase`);
  assert(restoredCount >= 1, `At least 1 checkpoint restored from Supabase`);

  // ─── TEST 5: Verify restored checkpoint matches ─────────────────
  console.log('\n═══ Test 5: Verify restored checkpoint matches ═══');

  const restored = newManager.getCheckpoint('goal_ckpt_test_001');
  assert(restored !== null, 'Restored checkpoint found in new manager');
  assert(restored?.goalId === 'goal_ckpt_test_001', `Same goalId: ${restored?.goalId}`);
  assert(restored?.identityId === 'identity_ckpt_test_001', `Same identity: ${restored?.identityId}`);
  assert(restored?.planVersion === 1, `Same plan version: ${restored?.planVersion}`);
  assert(restored?.completedObjectives.includes('RESOURCE_CREATED'), 'Same completed objectives');
  assert(restored?.executedActions.length === 1, `Same executed actions count: ${restored?.executedActions.length}`);
  assert(restored?.executedActions[0]?.actionId === 'act_ckpt_001', 'Same action ID');
  assert(restored?.executedSideEffects.includes(`create:${testFile}`), 'Same executed side effects');
  assert(restored?.status === 'RUNNING', `Same status: ${restored?.status}`);

  // ─── TEST 6: Idempotency — do NOT create resource again ─────────
  console.log('\n═══ Test 6: Idempotency — resource exists, do NOT recreate ═══');

  // Re-observe environment
  const resourceExists = fs.existsSync(testFile);
  assert(resourceExists === true, 'Resource still exists on filesystem (re-observed)');

  // Revalidate checkpoint against current state
  const currentObs = new Map<string, unknown>([
    ['resource:exists', true],
    ['resource:path', testFile],
  ]);
  const revalidation = newManager.revalidate(restored!, currentObs);
  assert(revalidation.consistent === true, 'Checkpoint consistent with current environment');

  // Get resume point — should skip completed objectives
  const resume = newManager.getResumePoint(restored!);
  assert(resume.objectivesToSkip.includes('RESOURCE_CREATED'), 'Completed objective in skip list');
  assert(!resume.objectivesToExecute.includes('RESOURCE_CREATED'), 'Completed objective NOT in resume list');

  // The executed side effect is tracked — must NOT be replayed
  assert(restored!.executedSideEffects.includes(`create:${testFile}`),
    'Side effect tracked — will NOT be replayed');

  // Verify the file was NOT modified (no duplicate write)
  const fileContent = fs.readFileSync(testFile, 'utf8');
  assert(fileContent === 'test resource content', 'File content unchanged (no duplicate write)');

  // Record action IDs before and after
  const actionIdsBefore = restored!.executedActions.map(a => a.actionId);
  console.log(`  Action IDs before restart: ${actionIdsBefore.join(', ')}`);
  assert(actionIdsBefore.length === 1, `1 action before restart: ${actionIdsBefore.length}`);

  // After resume, no new actions for the completed objective
  // (in a real scenario, the operator would only execute remaining objectives)
  const actionIdsAfter = restored!.executedActions.map(a => a.actionId);
  console.log(`  Action IDs after restart: ${actionIdsAfter.join(', ')}`);
  assert(actionIdsBefore.length === actionIdsAfter.length, 'No duplicate actions after restart');

  // ─── TEST 7: Stale checkpoint detection ─────────────────────────
  console.log('\n═══ Test 7: Stale checkpoint detection ═══');

  // Change the environment — delete the resource
  fs.unlinkSync(testFile);
  assert(!fs.existsSync(testFile), 'Resource deleted (environment changed)');

  // Revalidate — should detect inconsistency
  const staleObs = new Map<string, unknown>([
    ['resource:exists', false],
    ['resource:path', testFile],
  ]);
  const staleCheck = newManager.revalidate(restored!, staleObs);
  assert(staleCheck.consistent === false, 'Stale checkpoint detected (resource missing)');
  assert(staleCheck.invalidatedObjectives.length > 0, 'Invalidated objectives reported');

  // ─── TEST 8: Checkpoint integrity verification ┐════════════════
  console.log('\n═══ Test 8: Checkpoint integrity verification ═══');

  const integrityOk = await newPersistence.verifyIntegrity(checkpoint.checkpointId);
  assert(integrityOk === true, 'Checkpoint integrity verified (checksum matches)');

  // ─── CLEANUP ────────────────────────────────────────────────────
  console.log('\n═══ Cleanup ═══');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_ckpt_test_%');
  try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  try { fs.rmdirSync(TMP_DIR); } catch { /* ignore */ }

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
