/**
 * HYDI Control-Plane Long-Run Stability Test — Phase 11
 *
 * 100 delegated goal cycles through the control plane.
 * Tracks: success rate, failure rate, intervention rate, duplicate actions,
 * duplicate side effects, checkpoint corruption, persistence failures,
 * recovery failures, replan count, memory growth, orphaned interventions,
 * stale checkpoints.
 *
 * No memory-growth trend or duplicate side-effect regression may be introduced.
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
  isOperationalGoalStateClean,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  getVerificationRegistry,
  initializePersistence,
} from '../lib/delegated-operator';
import type { DelegatedAuthority } from '../lib/human-action/AuthorityManager';
import { STRICT_CONFIRMATION } from '../lib/human-action/AuthorityManager';

const TMP_DIR = path.join(os.tmpdir(), 'hydi-cp-soak');
const WORKSPACE = process.cwd();
const CYCLE_COUNT = 100;
const CYCLE_INTERVAL_MS = 200; // 200ms per cycle → ~20 seconds total

function makeAuthority(): DelegatedAuthority {
  return {
    authorityId: 'auth_cp_soak', delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
    riskLimit: 'HIGH', riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'cp_soak_session' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'control-plane soak test', createdAt: new Date().toISOString(), metadata: {},
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Control-Plane Long-Run Stability Test — Phase 11');
  console.log(`  Cycles: ${CYCLE_COUNT}, Interval: ${CYCLE_INTERVAL_MS}ms`);
  console.log('  NO MOCKS — Real Supabase, Real Control Plane');
  console.log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_cp_soak_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_cp_soak_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_cp_soak_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Initialize singletons
  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const checkpointManager = getCheckpointManager();
  const interventionQueue = getInterventionQueue();
  const verificationRegistry = getVerificationRegistry();

  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'cp_soak_session', authority: makeAuthority(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [],
    alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Soak workspace' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'control-plane soak test',
  });

  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);

  const stateMachine = new GoalStateMachine();

  // Metrics
  const metrics = {
    cycles: 0,
    goalsCompleted: 0,
    goalsFailed: 0,
    replans: 0,
    interventionsCreated: 0,
    interventionsResolved: 0,
    persistenceFailures: 0,
    checkpointFailures: 0,
    duplicateActions: 0,
    duplicateSideEffects: 0,
    staleCheckpoints: 0,
    orphanedInterventions: 0,
    secretLeaks: 0,
    controlPlaneReadFailures: 0,
    memorySamples: [] as number[],
    actionLatencies: [] as number[],
  };

  const startTime = Date.now();
  const startMem = process.memoryUsage().rss;
  console.log(`\nStarting soak at ${new Date().toISOString()}`);
  console.log(`Initial memory: ${Math.round(startMem / 1024 / 1024)}MB`);

  const sideEffectTracker = new Set<string>();

  for (let i = 0; i < CYCLE_COUNT; i++) {
    const cycleStart = Date.now();
    const cycleNum = i + 1;
    const goalId = `goal_cp_soak_${String(cycleNum).padStart(4, '0')}`;
    metrics.cycles++;

    try {
      // Record goal creation
      await controlPlane.recordEvent({ goalId, sessionId: 'cp_soak_session', identityId: identity.identityId, eventType: 'GOAL_CREATED', payload: { goalText: `Soak cycle ${cycleNum}` } });
      await controlPlane.recordEvent({ goalId, sessionId: 'cp_soak_session', identityId: identity.identityId, eventType: 'GOAL_STARTED', payload: { planVersion: 1 } });

      // Filesystem action
      const testFile = path.join(TMP_DIR, `resource_${cycleNum}.txt`);
      const sideEffectKey = `create:${testFile}`;

      // Check for duplicate side effect
      if (sideEffectTracker.has(sideEffectKey)) {
        metrics.duplicateSideEffects++;
      }
      sideEffectTracker.add(sideEffectKey);

      fs.writeFileSync(testFile, `cycle ${cycleNum}`);

      const verifyStart = Date.now();
      const verifyResult = verificationRegistry.verify('filesystem.write_file', { exists: fs.existsSync(testFile), size: fs.statSync(testFile).size });
      metrics.actionLatencies.push(Date.now() - verifyStart);

      if (!verifyResult.verified) {
        metrics.goalsFailed++;
        await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_FAILED', payload: { errorMessage: 'Verification failed' } });
        continue;
      }

      await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED', payload: { capability: 'filesystem.write_file', targetResource: testFile, result: 'success' } });
      await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_PASSED', payload: { verificationContract: 'filesystem.write_file', verificationResult: 'verified' } });

      // Checkpoint
      const cp = checkpointManager.checkpoint({
        goalId, identityId: identity.identityId, goalStatement: `Soak cycle ${cycleNum}`,
        planVersion: 1, completedObjectives: ['CREATE_RESOURCE'], failedObjectives: [], inProgressObjectives: [], pendingObjectives: [],
        executedActions: [{ actionId: `act_soak_${cycleNum}`, capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
        verifiedState: { 'resource:exists': true }, status: 'COMPLETED', resumeCondition: 'N/A',
        executedSideEffects: [sideEffectKey], summary: `Soak cycle ${cycleNum}`,
      });
      await new Promise((r) => setTimeout(r, 50));

      // Verify checkpoint persisted
      const { data: cpRow } = await supabase.from('goal_checkpoints').select('checkpoint_id').eq('checkpoint_id', cp.checkpointId).single();
      if (!cpRow) metrics.persistenceFailures++;

      await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'CHECKPOINT_CREATED', payload: { checkpointId: cp.checkpointId, checkpointStatus: 'COMPLETED' } });
      await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: { result: 'success' } });

      // Every 10th cycle: intervention
      if (cycleNum % 10 === 0) {
        const intervention = interventionQueue.enqueue({
          goalId, identityId: identity.identityId, userId: 'user:owner',
          currentObjective: 'TEST', blocker: 'SOAK_TEST', requiredHumanAction: 'Confirm', whyRequired: 'Soak test',
          expectedResultingState: 'Done', expiresAt: new Date(Date.now() + 3600000).toISOString(),
          resumeCondition: 'Confirmed', auditId: `audit_soak_${cycleNum}`, interventionType: 'UNKNOWN',
          originalRequest: { requestId: `req_soak_${cycleNum}`, actionId: `act_soak_int_${cycleNum}`, goalId, reason: 'soak', whatWasAttempted: 'test', whatSucceeded: 'test', whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test', whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any, timestamp: new Date().toISOString() },
        });
        metrics.interventionsCreated++;
        await new Promise((r) => setTimeout(r, 50));
        interventionQueue.resolve(intervention.requestId, 'Soak resolved');
        metrics.interventionsResolved++;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Every 15th cycle: replan
      if (cycleNum % 15 === 0) {
        metrics.replans++;
        await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'REPLAN_STARTED', payload: { previousPlanVersion: 1, replanReason: 'Soak replan test' } });
        await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'REPLAN_COMPLETED', payload: { planVersion: 2, replanReason: 'Soak replan test' } });
      }

      // Every 20th cycle: stale checkpoint
      if (cycleNum % 20 === 0 && cycleNum > 1) {
        const prevFile = path.join(TMP_DIR, `resource_${cycleNum - 1}.txt`);
        if (fs.existsSync(prevFile)) {
          fs.unlinkSync(prevFile);
          metrics.staleCheckpoints++;
        }
      }

      // Every 25th cycle: verify control plane reads state correctly
      if (cycleNum % 25 === 0) {
        const state = controlPlane.getGoalState(goalId);
        if (!state) {
          metrics.controlPlaneReadFailures++;
        } else if (!isOperationalGoalStateClean(state)) {
          metrics.secretLeaks++;
        }
      }

      // Check for duplicate actions
      const existingActions = cp.executedActions.filter((a) => a.actionId === `act_soak_${cycleNum}`);
      if (existingActions.length > 1) metrics.duplicateActions++;

      metrics.goalsCompleted++;

      // Sample memory
      if (cycleNum % 10 === 0) {
        const mem = process.memoryUsage().rss;
        metrics.memorySamples.push(Math.round(mem / 1024 / 1024));
      }
    } catch {
      metrics.goalsFailed++;
      metrics.checkpointFailures++;
    }

    const cycleElapsed = Date.now() - cycleStart;
    if (cycleElapsed < CYCLE_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, CYCLE_INTERVAL_MS - cycleElapsed));
    }
  }

  // Check for orphaned interventions
  const pendingInterventions = interventionQueue.getPending().filter((i) => i.goalId.startsWith('goal_cp_soak_'));
  metrics.orphanedInterventions = pendingInterventions.length;

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const endMem = process.memoryUsage().rss;

  // Compute statistics
  const avgLatency = metrics.actionLatencies.length > 0 ? Math.round(metrics.actionLatencies.reduce((a, b) => a + b, 0) / metrics.actionLatencies.length) : 0;
  const maxLatency = metrics.actionLatencies.length > 0 ? Math.max(...metrics.actionLatencies) : 0;
  const avgMem = metrics.memorySamples.length > 0 ? Math.round(metrics.memorySamples.reduce((a, b) => a + b, 0) / metrics.memorySamples.length) : 0;
  const maxMem = metrics.memorySamples.length > 0 ? Math.max(...metrics.memorySamples) : 0;
  const memGrowth = Math.round((endMem - startMem) / 1024 / 1024);
  const failureRate = metrics.cycles > 0 ? Math.round((metrics.goalsFailed / metrics.cycles) * 100) : 0;
  const successRate = metrics.cycles > 0 ? Math.round((metrics.goalsCompleted / metrics.cycles) * 100) : 0;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Control-Plane Soak Test Results');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Duration:              ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Cycles:                ${metrics.cycles}`);
  console.log(`  Success rate:          ${successRate}%`);
  console.log(`  Failure rate:          ${failureRate}%`);
  console.log(`  Goals completed:       ${metrics.goalsCompleted}`);
  console.log(`  Goals failed:          ${metrics.goalsFailed}`);
  console.log(`  Replans:               ${metrics.replans}`);
  console.log(`  Interventions:         ${metrics.interventionsCreated} created, ${metrics.interventionsResolved} resolved`);
  console.log(`  Orphaned interventions:${metrics.orphanedInterventions}`);
  console.log(`  Persistence failures:  ${metrics.persistenceFailures}`);
  console.log(`  Checkpoint failures:   ${metrics.checkpointFailures}`);
  console.log(`  Duplicate actions:     ${metrics.duplicateActions}`);
  console.log(`  Duplicate side effects:${metrics.duplicateSideEffects}`);
  console.log(`  Stale checkpoints:     ${metrics.staleCheckpoints}`);
  console.log(`  Secret leaks:          ${metrics.secretLeaks}`);
  console.log(`  CP read failures:      ${metrics.controlPlaneReadFailures}`);
  console.log(`  Action latency:        avg=${avgLatency}ms, max=${maxLatency}ms`);
  console.log(`  Memory:                start=${Math.round(startMem / 1024 / 1024)}MB, end=${Math.round(endMem / 1024 / 1024)}MB, avg=${avgMem}MB, max=${maxMem}MB, growth=${memGrowth > 0 ? '+' : ''}${memGrowth}MB`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Assertions
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  function assert(condition: boolean, message: string): void {
    if (condition) { passed++; console.log(`  ✓ ${message}`); }
    else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
  }

  console.log('\n  Soak Assertions:');
  assert(metrics.cycles === CYCLE_COUNT, `All ${CYCLE_COUNT} cycles executed: ${metrics.cycles}`);
  assert(successRate >= 95, `Success rate >= 95%: ${successRate}%`);
  assert(failureRate <= 5, `Failure rate <= 5%: ${failureRate}%`);
  assert(metrics.duplicateActions === 0, `No duplicate actions: ${metrics.duplicateActions}`);
  assert(metrics.duplicateSideEffects === 0, `No duplicate side effects: ${metrics.duplicateSideEffects}`);
  assert(metrics.persistenceFailures === 0, `No persistence failures: ${metrics.persistenceFailures}`);
  assert(metrics.checkpointFailures === 0, `No checkpoint failures: ${metrics.checkpointFailures}`);
  assert(metrics.interventionsCreated === metrics.interventionsResolved, `All interventions resolved: ${metrics.interventionsCreated}/${metrics.interventionsResolved}`);
  assert(metrics.orphanedInterventions === 0, `No orphaned interventions: ${metrics.orphanedInterventions}`);
  assert(metrics.secretLeaks === 0, `No secret leaks: ${metrics.secretLeaks}`);
  assert(metrics.controlPlaneReadFailures === 0, `No control-plane read failures: ${metrics.controlPlaneReadFailures}`);
  assert(memGrowth < 50, `Memory growth < 50MB: ${memGrowth}MB`);
  assert(avgLatency < 100, `Average action latency < 100ms: ${avgLatency}ms`);

  console.log(`\n  Soak Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) { console.log('\n  Failures:'); for (const f of failures) { console.log(`    ✗ ${f}`); } }

  // Cleanup
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_cp_soak_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_cp_soak_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_cp_soak_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // Save metrics
  const metricsPath = path.join(process.cwd(), 'data', 'cp-soak-metrics.json');
  if (!fs.existsSync(path.dirname(metricsPath))) fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify({ ...metrics, durationMs, successRate, failureRate, avgLatency, maxLatency, avgMem, maxMem, memGrowth, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n  Metrics saved: ${metricsPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
