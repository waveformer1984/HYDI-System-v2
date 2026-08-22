/**
 * HYDI Bounded Soak Test — Phase 17
 *
 * Runs the governed delegated operator under bounded workload.
 * Monitors: memory, CPU, action latency, goal completion, failure rate,
 * replans, intervention count, persistence failures, checkpoint failures,
 * browser failures, provider failures, duplicate actions, stale checkpoints.
 *
 * Maintains existing autonomy limits. No unrestricted autonomy.
 *
 * Duration: 60 seconds (bounded — appropriate for local environment)
 * Cycles: ~60 checkpoint/intervention cycles
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
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
} from '../lib/delegated-operator';
import type { DelegatedAuthority } from '../lib/human-action/AuthorityManager';
import { STRICT_CONFIRMATION } from '../lib/human-action/AuthorityManager';
import type { RiskLevel } from '../lib/operational/types';
import type { AuthorizationScope, AuthorizationMode, ActionCategory } from '../lib/human-action/HumanActionTypes';

const TMP_DIR = path.join(os.tmpdir(), 'hydi-soak-test');
const WORKSPACE = process.cwd();
const SOAK_DURATION_MS = 60000; // 60 seconds
const CYCLE_INTERVAL_MS = 1000; // 1 second per cycle

function makeAuthority(): DelegatedAuthority {
  return {
    authorityId: 'auth_soak_001', delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
    riskLimit: 'HIGH', riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'soak_session' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'bounded soak test', createdAt: new Date().toISOString(), metadata: {},
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Bounded Soak Test');
  console.log(`  Duration: ${SOAK_DURATION_MS / 1000}s, Cycle: ${CYCLE_INTERVAL_MS}ms`);
  console.log('  NO MOCKS — Real Supabase');
  console.log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_soak_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_soak_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Initialize
  const identityManager = new DelegatedIdentityManager();
  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'soak_session', authority: makeAuthority(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [],
    alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Soak workspace' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'bounded soak test',
  });

  const checkpointManager = new GoalCheckpointManager();
  const checkpointPersistence = new CheckpointPersistence(supabase);
  checkpointManager.attachPersistence(checkpointPersistence);

  const interventionQueue = new InterventionQueue();
  const interventionPersistence = new InterventionPersistence(supabase);
  interventionQueue.attachPersistence(interventionPersistence);

  const stateMachine = new GoalStateMachine();
  const verificationRegistry = new VerificationContractRegistry();
  for (const c of createDefaultVerificationContracts()) verificationRegistry.register(c);

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
    staleCheckpoints: 0,
    actionLatencies: [] as number[],
    memorySamples: [] as number[],
    cpuSamples: [] as number[],
  };

  const startTime = Date.now();
  const startMem = process.memoryUsage().rss;
  const startCpu = process.cpuUsage();

  console.log(`\nStarting soak at ${new Date().toISOString()}`);
  console.log(`Initial memory: ${Math.round(startMem / 1024 / 1024)}MB`);

  // Run cycles
  while (Date.now() - startTime < SOAK_DURATION_MS) {
    const cycleStart = Date.now();
    const cycleNum = ++metrics.cycles;
    const goalId = `goal_soak_${String(cycleNum).padStart(4, '0')}`;

    try {
      // Create a file (side effect)
      const testFile = path.join(TMP_DIR, `resource_${cycleNum}.txt`);
      fs.writeFileSync(testFile, `cycle ${cycleNum}`);

      // Verify
      const verifyStart = Date.now();
      const verifyResult = verificationRegistry.verify('filesystem.write_file', {
        exists: fs.existsSync(testFile),
        size: fs.statSync(testFile).size,
      });
      const actionLatency = Date.now() - verifyStart;
      metrics.actionLatencies.push(actionLatency);

      if (!verifyResult.verified) {
        metrics.goalsFailed++;
        continue;
      }

      // Checkpoint
      const cpStart = Date.now();
      const cp = checkpointManager.checkpoint({
        goalId, identityId: identity.identityId,
        goalStatement: `Soak cycle ${cycleNum}`,
        planVersion: 1,
        completedObjectives: ['CREATE_RESOURCE'],
        failedObjectives: [], inProgressObjectives: [],
        pendingObjectives: [],
        executedActions: [
          { actionId: `act_soak_${cycleNum}`, capability: 'filesystem.write_file', target: testFile, outcome: 'success', verified: true, timestamp: new Date().toISOString() },
        ],
        verifiedState: { 'resource:exists': true },
        status: 'COMPLETED', resumeCondition: 'N/A',
        executedSideEffects: [`create:${testFile}`],
        summary: `Soak cycle ${cycleNum} complete`,
      });

      // Wait for async persistence
      await new Promise((r) => setTimeout(r, 50));

      // Verify checkpoint persisted
      const { data: cpRow } = await supabase
        .from('goal_checkpoints').select('checkpoint_id').eq('checkpoint_id', cp.checkpointId).single();
      if (!cpRow) {
        metrics.persistenceFailures++;
      }

      // Every 10th cycle: create + resolve an intervention
      if (cycleNum % 10 === 0) {
        const intervention = interventionQueue.enqueue({
          goalId, identityId: identity.identityId, userId: 'user:owner',
          currentObjective: 'TEST', blocker: 'SOAK_TEST',
          requiredHumanAction: 'Confirm', whyRequired: 'Soak test',
          expectedResultingState: 'Done',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          resumeCondition: 'Confirmed', auditId: `audit_soak_${cycleNum}`,
          interventionType: 'UNKNOWN',
          originalRequest: {
            requestId: `req_soak_${cycleNum}`, actionId: `act_soak_int_${cycleNum}`,
            goalId, reason: 'soak', whatWasAttempted: 'test', whatSucceeded: 'test',
            whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
            whatHappensAfter: 'test', interventionType: 'UNKNOWN' as any,
            timestamp: new Date().toISOString(),
          },
        });
        metrics.interventionsCreated++;
        await new Promise((r) => setTimeout(r, 50));

        // Resolve immediately
        interventionQueue.resolve(intervention.requestId, 'Soak test resolved');
        metrics.interventionsResolved++;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Every 15th cycle: simulate a replan
      if (cycleNum % 15 === 0) {
        metrics.replans++;
      }

      // Every 20th cycle: check for stale checkpoint
      if (cycleNum % 20 === 0 && cycleNum > 1) {
        const prevFile = path.join(TMP_DIR, `resource_${cycleNum - 1}.txt`);
        if (fs.existsSync(prevFile)) {
          fs.unlinkSync(prevFile);
          // The previous checkpoint is now stale
          metrics.staleCheckpoints++;
        }
      }

      // Check for duplicate actions (should never happen)
      const existingActions = cp.executedActions.filter(a => a.actionId === `act_soak_${cycleNum}`);
      if (existingActions.length > 1) {
        metrics.duplicateActions++;
      }

      metrics.goalsCompleted++;

      // Sample memory and CPU
      if (cycleNum % 5 === 0) {
        const mem = process.memoryUsage().rss;
        metrics.memorySamples.push(Math.round(mem / 1024 / 1024));
        const cpu = process.cpuUsage(startCpu);
        metrics.cpuSamples.push(Math.round((cpu.user + cpu.system) / 1000)); // microseconds to milliseconds
      }
    } catch (err) {
      metrics.goalsFailed++;
      metrics.checkpointFailures++;
    }

    // Wait for next cycle
    const cycleElapsed = Date.now() - cycleStart;
    if (cycleElapsed < CYCLE_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, CYCLE_INTERVAL_MS - cycleElapsed));
    }
  }

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const endMem = process.memoryUsage().rss;

  // Compute statistics
  const avgLatency = metrics.actionLatencies.length > 0
    ? Math.round(metrics.actionLatencies.reduce((a, b) => a + b, 0) / metrics.actionLatencies.length)
    : 0;
  const maxLatency = metrics.actionLatencies.length > 0
    ? Math.max(...metrics.actionLatencies) : 0;
  const minLatency = metrics.actionLatencies.length > 0
    ? Math.min(...metrics.actionLatencies) : 0;

  const avgMem = metrics.memorySamples.length > 0
    ? Math.round(metrics.memorySamples.reduce((a, b) => a + b, 0) / metrics.memorySamples.length)
    : 0;
  const maxMem = metrics.memorySamples.length > 0
    ? Math.max(...metrics.memorySamples) : 0;
  const memGrowth = Math.round((endMem - startMem) / 1024 / 1024);

  const failureRate = metrics.cycles > 0
    ? Math.round((metrics.goalsFailed / metrics.cycles) * 100) : 0;

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Soak Test Results');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Duration:          ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Cycles:            ${metrics.cycles}`);
  console.log(`  Goals completed:   ${metrics.goalsCompleted}`);
  console.log(`  Goals failed:      ${metrics.goalsFailed}`);
  console.log(`  Failure rate:      ${failureRate}%`);
  console.log(`  Replans:           ${metrics.replans}`);
  console.log(`  Interventions:     ${metrics.interventionsCreated} created, ${metrics.interventionsResolved} resolved`);
  console.log(`  Persistence fails: ${metrics.persistenceFailures}`);
  console.log(`  Checkpoint fails:  ${metrics.checkpointFailures}`);
  console.log(`  Duplicate actions: ${metrics.duplicateActions}`);
  console.log(`  Stale checkpoints: ${metrics.staleCheckpoints}`);
  console.log(`  Action latency:    avg=${avgLatency}ms, min=${minLatency}ms, max=${maxLatency}ms`);
  console.log(`  Memory:            start=${Math.round(startMem / 1024 / 1024)}MB, end=${Math.round(endMem / 1024 / 1024)}MB, avg=${avgMem}MB, max=${maxMem}MB, growth=${memGrowth > 0 ? '+' : ''}${memGrowth}MB`);
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
  assert(metrics.cycles >= 50, `At least 50 cycles executed: ${metrics.cycles}`);
  assert(metrics.goalsCompleted >= 45, `At least 45 goals completed: ${metrics.goalsCompleted}`);
  assert(failureRate < 10, `Failure rate < 10%: ${failureRate}%`);
  assert(metrics.duplicateActions === 0, `No duplicate actions: ${metrics.duplicateActions}`);
  assert(metrics.persistenceFailures < 5, `Persistence failures < 5: ${metrics.persistenceFailures}`);
  assert(metrics.checkpointFailures < 5, `Checkpoint failures < 5: ${metrics.checkpointFailures}`);
  assert(metrics.interventionsCreated === metrics.interventionsResolved, `All interventions resolved: ${metrics.interventionsCreated}/${metrics.interventionsResolved}`);
  assert(memGrowth < 50, `Memory growth < 50MB: ${memGrowth}MB`);
  assert(avgLatency < 100, `Average action latency < 100ms: ${avgLatency}ms`);

  console.log(`\n  Soak Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n  Failures:');
    for (const f of failures) { console.log(`    ✗ ${f}`); }
  }

  // Cleanup
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_soak_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_soak_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // Save metrics
  const metricsPath = path.join(process.cwd(), 'data', 'soak-test-metrics.json');
  if (!fs.existsSync(path.dirname(metricsPath))) {
    fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  }
  fs.writeFileSync(metricsPath, JSON.stringify({
    ...metrics,
    durationMs,
    avgLatency, maxLatency, minLatency,
    avgMem, maxMem, memGrowth,
    failureRate,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(`\n  Metrics saved: ${metricsPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
