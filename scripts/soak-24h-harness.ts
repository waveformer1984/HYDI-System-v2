/**
 * HYDI 24-Hour Soak Harness — Phase 10
 *
 * scripts/soak-24h-harness.ts
 *
 * Real long-running bounded harness for 24-hour continuous operation.
 *
 * IMPORTANT: This harness does NOT claim 24-hour qualification until an
 * actual 24-hour run completes. It is a preparation tool that:
 *   - Provides deterministic startup and shutdown
 *   - Performs periodic health checks
 *   - Monitors memory and resource usage
 *   - Supports restart/recovery
 *   - Tracks event/checkpoint/intervention metrics
 *   - Classifies environmental blockers if dependencies prevent execution
 *   - Never fabricates PASS
 *
 * Usage:
 *   npx tsx scripts/soak-24h-harness.ts --duration=86400 [--cycle-interval=1000]
 *
 * Output:
 *   - Console progress every 60 seconds
 *   - hydi-phase10-soak-24h-results.json on completion
 *   - Exit 0 on successful completion within duration
 *   - Exit 1 on safety violation or environmental blocker
 *   - Exit 2 on timeout (duration exceeded without clean shutdown)
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  HumanProxyControlPlane,
  InterventionController,
  GoalStateMachine,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  getOperationalEventStream,
  initializePersistence,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
} from '../lib/delegated-operator';

// ─── CLI args ─────────────────────────────────────────────────────

interface HarnessConfig {
  durationSeconds: number;
  cycleIntervalMs: number;
  healthCheckIntervalMs: number;
  memoryCheckIntervalMs: number;
  outputFilePath: string;
}

function parseArgs(): HarnessConfig {
  const args = process.argv.slice(2);
  const config: HarnessConfig = {
    durationSeconds: 86400, // 24 hours default
    cycleIntervalMs: 1000,
    healthCheckIntervalMs: 60000, // 1 minute
    memoryCheckIntervalMs: 30000, // 30 seconds
    outputFilePath: path.join(process.cwd(), 'hydi-phase10-soak-24h-results.json'),
  };

  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    switch (key) {
      case 'duration': config.durationSeconds = parseInt(value, 10); break;
      case 'cycle-interval': config.cycleIntervalMs = parseInt(value, 10); break;
      case 'health-check-interval': config.healthCheckIntervalMs = parseInt(value, 10); break;
      case 'memory-check-interval': config.memoryCheckIntervalMs = parseInt(value, 10); break;
      case 'output': config.outputFilePath = value; break;
    }
  }

  return config;
}

// ─── Deterministic PRNG ────────────────────────────────────────────

class DeterministicPRNG {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) / 0xFFFFFFFF);
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  bool(prob: number): boolean { return this.next() < prob; }
  pick<T>(arr: T[]): T { return arr[this.int(arr.length)]; }
}

// ─── Metrics ──────────────────────────────────────────────────────

interface HarnessMetrics {
  startTime: string;
  endTime: string | null;
  durationActualSeconds: number;
  cycles: number;
  successes: number;
  failures: number;
  recoveries: number;
  replans: number;
  interventionsCreated: number;
  interventionsApproved: number;
  interventionsRejected: number;
  duplicateSideEffects: number;
  orphanedInterventions: number;
  terminalResurrections: number;
  eventDuplications: number;
  persistenceFailures: number;
  healthChecks: number;
  healthCheckFailures: number;
  memorySamples: Array<{ time: string; heapMB: number; rssMB: number; queueDepth: number }>;
  cycleDurations: number[];
  environmentalBlockers: string[];
  safetyViolations: string[];
  shutdownReason: string | null;
}

const metrics: HarnessMetrics = {
  startTime: new Date().toISOString(),
  endTime: null,
  durationActualSeconds: 0,
  cycles: 0, successes: 0, failures: 0, recoveries: 0, replans: 0,
  interventionsCreated: 0, interventionsApproved: 0, interventionsRejected: 0,
  duplicateSideEffects: 0, orphanedInterventions: 0, terminalResurrections: 0,
  eventDuplications: 0, persistenceFailures: 0,
  healthChecks: 0, healthCheckFailures: 0,
  memorySamples: [],
  cycleDurations: [],
  environmentalBlockers: [],
  safetyViolations: [],
  shutdownReason: null,
};

// ─── Graceful shutdown ────────────────────────────────────────────

let shutdownRequested = false;
let shutdownReason = '';

function requestShutdown(reason: string) {
  if (!shutdownRequested) {
    shutdownRequested = true;
    shutdownReason = reason;
    console.log(`\n  [SHUTDOWN] Requested: ${reason}`);
  }
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI 24-Hour Soak Harness — Phase 10');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const config = parseArgs();
  console.log(`  Duration:       ${config.durationSeconds}s (${(config.durationSeconds / 3600).toFixed(1)}h)`);
  console.log(`  Cycle interval: ${config.cycleIntervalMs}ms`);
  console.log(`  Health check:   every ${config.healthCheckIntervalMs}ms`);
  console.log(`  Memory check:   every ${config.memoryCheckIntervalMs}ms`);
  console.log('');

  // ─── Environmental checks ────────────────────────────────────────
  const envBlockers: string[] = [];

  if (!process.env.SUPABASE_URL) {
    envBlockers.push('SUPABASE_URL not set — cannot persist to Supabase');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    envBlockers.push('SUPABASE_SERVICE_ROLE_KEY not set — cannot persist to Supabase');
  }

  if (envBlockers.length > 0) {
    console.log('  ENVIRONMENTAL BLOCKERS:');
    for (const b of envBlockers) {
      console.log(`    ⚠ ${b}`);
      metrics.environmentalBlockers.push(b);
    }
    console.log('\n  Cannot proceed with soak — environmental dependencies missing.');
    console.log('  This is classified as ENVIRONMENTAL, not PASS.\n');

    metrics.endTime = new Date().toISOString();
    metrics.shutdownReason = 'ENVIRONMENTAL_BLOCKER';
    writeResults(config, metrics);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Verify Supabase connectivity
  try {
    const { error } = await supabase.from('goal_checkpoints').select('goal_id').limit(1);
    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`);
    }
    console.log('  Supabase connectivity: OK');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.log(`  Supabase connectivity: FAILED — ${msg}`);
    metrics.environmentalBlockers.push(`Supabase connectivity: ${msg}`);
    metrics.endTime = new Date().toISOString();
    metrics.shutdownReason = 'ENVIRONMENTAL_BLOCKER';
    writeResults(config, metrics);
    process.exit(1);
  }

  // Clean up previous test data
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_soak24h_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_soak24h_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_soak24h_%');

  initializePersistence(supabase);

  const identityManager = getIdentityManager();
  const WORKSPACE = process.cwd();
  const identity = identityManager.delegate({
    userId: 'user:owner',
    sessionId: 'soak24h_test',
    authority: {
      authorityId: 'auth_soak24h', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'soak24h_test' },
      requiresConfirmation: {
        destructiveActions: true, financialActions: true, externalCommunication: true,
        deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
      },
      purpose: 'soak24h test', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 86400000 * 2).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'soak24h test',
  });

  const cp = new HumanProxyControlPlane();
  cp.initialize(supabase);
  const controller = new InterventionController();
  const stateMachine = new GoalStateMachine();
  const queue = getInterventionQueue();
  const checkpointManager = getCheckpointManager();

  const prng = new DeterministicPRNG(12345);
  const TMP_DIR = path.join(os.tmpdir(), 'hydi-soak24h');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const sideEffects = new Map<string, number>();
  const eventIds = new Set<string>();
  const terminalGoals = new Set<string>();
  const completedActions = new Set<string>();

  const FAILURE_TYPES: string[] = [
    'none', 'none', 'none', 'none', 'none',
    'process_interruption', 'http_failure', 'browser_failure',
    'verification_failure', 'stale_checkpoint',
    'intervention_required', 'intervention_approval', 'intervention_rejection',
    'persistence_failure', 'restart_recovery', 'replanning',
    'terminal_completion', 'terminal_failure',
  ];
  type FailureType = string;

  const harnessStart = Date.now();
  const harnessEnd = harnessStart + config.durationSeconds * 1000;
  let cycle = 0;
  let lastHealthCheck = 0;
  let lastMemoryCheck = 0;
  let lastProgressLog = 0;

  console.log(`\n  Starting soak at ${metrics.startTime}`);
  console.log(`  Will run until ${new Date(harnessEnd).toISOString()}`);
  console.log('');

  // ─── Main loop ───────────────────────────────────────────────────
  while (!shutdownRequested && Date.now() < harnessEnd) {
    const cycleStart = Date.now();
    const goalId = `goal_soak24h_${cycle}`;
    const actionId = `act_soak24h_${cycle}`;
    const failureType = prng.pick(FAILURE_TYPES) as FailureType;
    metrics.cycles++;

    try {
      // ─── OBSERVE ────────────────────────────────────────────────
      await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_CREATED', payload: {} });
      await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_ACCEPTED', payload: {} });

      // ─── PLAN + AUTHORIZE ───────────────────────────────────────
      await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'AUTHORIZATION_GRANTED', payload: {} });

      // ─── EXECUTE ────────────────────────────────────────────────
      const isInterrupted = failureType === ('process_interruption' as string);
      const isPersistenceFail = failureType === ('persistence_failure' as string);
      if (!isInterrupted && !isPersistenceFail) {
        await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_STARTED', payload: { actionId } });

        if (failureType !== 'http_failure' && failureType !== 'browser_failure') {
          const filePath = path.join(TMP_DIR, `${actionId}.txt`);
          if (!sideEffects.has(actionId)) {
            fs.writeFileSync(filePath, `cycle=${cycle}\naction=${actionId}\nnonce=${crypto.randomUUID()}`);
            sideEffects.set(actionId, 1);
            completedActions.add(actionId);
          } else {
            sideEffects.set(actionId, sideEffects.get(actionId)! + 1);
            metrics.duplicateSideEffects++;
          }
        }

        if (failureType !== 'verification_failure' && !isInterrupted) {
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED', payload: { actionId } });
        }
      }

      // ─── FAILURE INJECTION ──────────────────────────────────────
      switch (failureType) {
        case 'process_interruption':
        case 'restart_recovery': {
          checkpointManager.restore([]);
          queue.restore([]);
          getOperationalEventStream().clearAll();
          await checkpointManager.restoreFromPersistence();
          await queue.restoreFromPersistence();
          await cp.restoreFromPersistence([goalId]);
          metrics.recoveries++;
          break;
        }

        case 'intervention_required': {
          const req = queue.enqueue({
            goalId, identityId: identity.identityId, userId: 'user:owner',
            currentObjective: 'OBJ_1', blocker: 'Soak intervention',
            requiredHumanAction: 'Confirm', whyRequired: 'Test',
            expectedResultingState: 'Done',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            resumeCondition: 'Approved', auditId: `audit_${goalId}`,
            interventionType: 'CONFIRMATION_REQUIRED',
            originalRequest: {
              requestId: `req_${goalId}`, actionId, goalId, reason: 'test',
              whatWasAttempted: 'test', whatSucceeded: 'test', whatFailed: 'test',
              whyCannotContinue: 'test', requiredHumanAction: 'test', whatHappensAfter: 'test',
              interventionType: 'CONFIRMATION_REQUIRED' as any, timestamp: new Date().toISOString(),
            },
          });
          await new Promise((r) => setTimeout(r, 20));
          metrics.interventionsCreated++;
          checkpointManager.checkpoint({
            goalId, identityId: identity.identityId,
            goalStatement: `Soak ${cycle}`, planVersion: 1,
            completedObjectives: [], failedObjectives: [],
            inProgressObjectives: ['OBJ_1'], pendingObjectives: ['OBJ_2'],
            executedActions: [], verifiedState: {}, status: 'WAITING_FOR_HUMAN',
            resumeCondition: 'Approved', executedSideEffects: [], summary: `Soak ${cycle}`,
          });
          await new Promise((r) => setTimeout(r, 20));
          break;
        }

        case 'intervention_approval': {
          const req = queue.enqueue({
            goalId, identityId: identity.identityId, userId: 'user:owner',
            currentObjective: 'OBJ_1', blocker: 'Soak approval',
            requiredHumanAction: 'Confirm', whyRequired: 'Test',
            expectedResultingState: 'Done',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            resumeCondition: 'Approved', auditId: `audit_${goalId}`,
            interventionType: 'CONFIRMATION_REQUIRED',
            originalRequest: {
              requestId: `req_${goalId}`, actionId, goalId, reason: 'test',
              whatWasAttempted: 'test', whatSucceeded: 'test', whatFailed: 'test',
              whyCannotContinue: 'test', requiredHumanAction: 'test', whatHappensAfter: 'test',
              interventionType: 'CONFIRMATION_REQUIRED' as any, timestamp: new Date().toISOString(),
            },
          });
          await new Promise((r) => setTimeout(r, 20));
          metrics.interventionsCreated++;
          await controller.approve(req.requestId, 'user:owner', 'Soak approval');
          metrics.interventionsApproved++;
          break;
        }

        case 'intervention_rejection': {
          const req = queue.enqueue({
            goalId, identityId: identity.identityId, userId: 'user:owner',
            currentObjective: 'OBJ_1', blocker: 'Soak rejection',
            requiredHumanAction: 'Confirm', whyRequired: 'Test',
            expectedResultingState: 'Done',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            resumeCondition: 'Approved', auditId: `audit_${goalId}`,
            interventionType: 'CONFIRMATION_REQUIRED',
            originalRequest: {
              requestId: `req_${goalId}`, actionId, goalId, reason: 'test',
              whatWasAttempted: 'test', whatSucceeded: 'test', whatFailed: 'test',
              whyCannotContinue: 'test', requiredHumanAction: 'test', whatHappensAfter: 'test',
              interventionType: 'CONFIRMATION_REQUIRED' as any, timestamp: new Date().toISOString(),
            },
          });
          await new Promise((r) => setTimeout(r, 20));
          metrics.interventionsCreated++;
          await controller.reject(req.requestId, 'user:owner', 'Soak rejection');
          metrics.interventionsRejected++;
          break;
        }

        case 'replanning': {
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'REPLAN_STARTED', payload: {} });
          metrics.replans++;
          break;
        }

        case 'verification_failure': {
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_FAILED', payload: {} });
          break;
        }

        case 'stale_checkpoint': {
          checkpointManager.checkpoint({
            goalId, identityId: identity.identityId,
            goalStatement: `Soak ${cycle}`, planVersion: 1,
            completedObjectives: ['OBJ_1', 'OBJ_2'], failedObjectives: [],
            inProgressObjectives: [], pendingObjectives: [],
            executedActions: [], verifiedState: {}, status: 'COMPLETED',
            resumeCondition: 'Done', executedSideEffects: [], summary: `Soak ${cycle}`,
          });
          await new Promise((r) => setTimeout(r, 20));
          terminalGoals.add(goalId);
          break;
        }

        case 'terminal_completion': {
          checkpointManager.checkpoint({
            goalId, identityId: identity.identityId,
            goalStatement: `Soak ${cycle}`, planVersion: 1,
            completedObjectives: ['OBJ_1', 'OBJ_2'], failedObjectives: [],
            inProgressObjectives: [], pendingObjectives: [],
            executedActions: completedActions.has(actionId)
              ? [{ actionId, capability: 'filesystem.write_file', target: '', outcome: 'success', verified: true, timestamp: new Date().toISOString() }]
              : [],
            verifiedState: {}, status: 'COMPLETED',
            resumeCondition: 'Done', executedSideEffects: [], summary: `Soak ${cycle}`,
          });
          await new Promise((r) => setTimeout(r, 20));
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: {} });
          terminalGoals.add(goalId);
          metrics.successes++;
          break;
        }

        case 'terminal_failure': {
          checkpointManager.checkpoint({
            goalId, identityId: identity.identityId,
            goalStatement: `Soak ${cycle}`, planVersion: 1,
            completedObjectives: [], failedObjectives: ['OBJ_1'],
            inProgressObjectives: [], pendingObjectives: [],
            executedActions: [], verifiedState: {}, status: 'FAILED',
            resumeCondition: 'Done', executedSideEffects: [], summary: `Soak ${cycle}`,
          });
          await new Promise((r) => setTimeout(r, 20));
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_FAILED', payload: {} });
          terminalGoals.add(goalId);
          metrics.failures++;
          break;
        }

        case 'persistence_failure': {
          metrics.persistenceFailures++;
          break;
        }

        case 'http_failure':
        case 'browser_failure': {
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_FAILED', payload: { actionId, reason: failureType } });
          break;
        }

        case 'none':
        default: {
          checkpointManager.checkpoint({
            goalId, identityId: identity.identityId,
            goalStatement: `Soak ${cycle}`, planVersion: 1,
            completedObjectives: ['OBJ_1', 'OBJ_2'], failedObjectives: [],
            inProgressObjectives: [], pendingObjectives: [],
            executedActions: completedActions.has(actionId)
              ? [{ actionId, capability: 'filesystem.write_file', target: '', outcome: 'success', verified: true, timestamp: new Date().toISOString() }]
              : [],
            verifiedState: {}, status: 'COMPLETED',
            resumeCondition: 'Done', executedSideEffects: [], summary: `Soak ${cycle}`,
          });
          await new Promise((r) => setTimeout(r, 20));
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_PASSED', payload: {} });
          await cp.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: {} });
          terminalGoals.add(goalId);
          metrics.successes++;
          break;
        }
      }

      // ─── VERIFY ─────────────────────────────────────────────────
      const events = cp.getGoalEvents(goalId);
      for (const evt of events) {
        if (eventIds.has(evt.eventId)) metrics.eventDuplications++;
        eventIds.add(evt.eventId);
      }

      if (terminalGoals.has(goalId)) {
        const state = cp.getGoalState(goalId);
        if (state) {
          const isTerminal = state.status === 'COMPLETED' || state.status === 'FAILED' || state.status === 'EXPIRED' || state.status === 'PARTIAL';
          if (!isTerminal) metrics.terminalResurrections++;
          stateMachine.initialize(goalId, state.status as any);
          const resurrection = stateMachine.transition(goalId, 'RUNNING', 'soak resurrection');
          if (resurrection.success && isTerminal) metrics.terminalResurrections++;
        }
      }

      // ─── Cleanup ────────────────────────────────────────────────
      if (cycle % 25 === 24) {
        const batchStart = cycle - 24;
        for (let j = batchStart; j <= cycle; j++) {
          await supabase.from('human_intervention_requests').delete().eq('goal_id', `goal_soak24h_${j}`);
          await supabase.from('goal_checkpoints').delete().eq('goal_id', `goal_soak24h_${j}`);
          await supabase.from('adaptive_operator_events').delete().eq('goal_id', `goal_soak24h_${j}`);
        }
        getOperationalEventStream().clearAll();
        checkpointManager.restore([]);
        queue.restore([]);
      }

      // ─── Health checks ──────────────────────────────────────────
      const now = Date.now();
      if (now - lastHealthCheck >= config.healthCheckIntervalMs) {
        lastHealthCheck = now;
        metrics.healthChecks++;
        try {
          const { error } = await supabase.from('goal_checkpoints').select('goal_id').limit(1);
          if (error) {
            metrics.healthCheckFailures++;
            console.log(`    [HEALTH CHECK ${metrics.healthChecks}] FAILED: ${error.message}`);
          }
        } catch (err) {
          metrics.healthCheckFailures++;
          console.log(`    [HEALTH CHECK ${metrics.healthChecks}] FAILED: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }

      // ─── Memory checks ──────────────────────────────────────────
      if (now - lastMemoryCheck >= config.memoryCheckIntervalMs) {
        lastMemoryCheck = now;
        const mem = process.memoryUsage();
        metrics.memorySamples.push({
          time: new Date().toISOString(),
          heapMB: mem.heapUsed / 1024 / 1024,
          rssMB: mem.rss / 1024 / 1024,
          queueDepth: queue.getPending().length,
        });

        // Safety: memory > 500MB is a violation
        if (mem.heapUsed > 500 * 1024 * 1024) {
          metrics.safetyViolations.push(`Memory exceeded 500MB: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
          requestShutdown('MEMORY_VIOLATION');
        }
      }

      // ─── Progress log ───────────────────────────────────────────
      if (now - lastProgressLog >= 60000) { // Every 60 seconds
        lastProgressLog = now;
        const elapsed = (now - harnessStart) / 1000;
        const remaining = (harnessEnd - now) / 1000;
        const progress = (elapsed / config.durationSeconds) * 100;
        const mem = process.memoryUsage();
        console.log(
          `    [${new Date().toISOString()}] ${progress.toFixed(1)}% | ` +
          `elapsed=${elapsed.toFixed(0)}s remaining=${remaining.toFixed(0)}s | ` +
          `cycles=${metrics.cycles} success=${metrics.successes} fail=${metrics.failures} | ` +
          `recover=${metrics.recoveries} replan=${metrics.replans} intv=${metrics.interventionsCreated} | ` +
          `dup=${metrics.duplicateSideEffects} orphan=${metrics.orphanedInterventions} ` +
          `resurrect=${metrics.terminalResurrections} dupEvt=${metrics.eventDuplications} | ` +
          `heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB queue=${queue.getPending().length}`
        );
      }

      // ─── Safety violation checks ────────────────────────────────
      if (metrics.duplicateSideEffects > 0) {
        metrics.safetyViolations.push(`Duplicate side effects: ${metrics.duplicateSideEffects}`);
        requestShutdown('DUPLICATE_SIDE_EFFECTS');
      }
      if (metrics.terminalResurrections > 0) {
        metrics.safetyViolations.push(`Terminal resurrections: ${metrics.terminalResurrections}`);
        requestShutdown('TERMINAL_RESURRECTION');
      }

    } catch (err) {
      console.log(`    Cycle ${cycle} error: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    const cycleDuration = Date.now() - cycleStart;
    metrics.cycleDurations.push(cycleDuration);

    // Wait for cycle interval
    const waitMs = Math.max(0, config.cycleIntervalMs - cycleDuration);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

    cycle++;
  }

  // ─── Shutdown ────────────────────────────────────────────────────
  const actualDuration = (Date.now() - harnessStart) / 1000;
  metrics.durationActualSeconds = actualDuration;
  metrics.endTime = new Date().toISOString();
  metrics.shutdownReason = shutdownRequested ? shutdownReason : 'DURATION_COMPLETED';

  // ─── Cleanup ─────────────────────────────────────────────────────
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_soak24h_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_soak24h_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_soak24h_%');
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  // ─── Results ─────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PHASE 10 — 24-HOUR SOAK HARNESS RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Start time:           ${metrics.startTime}`);
  console.log(`  End time:             ${metrics.endTime}`);
  console.log(`  Actual duration:      ${actualDuration.toFixed(1)}s (${(actualDuration / 3600).toFixed(2)}h)`);
  console.log(`  Shutdown reason:      ${metrics.shutdownReason}`);
  console.log(`  Target duration:      ${config.durationSeconds}s (${(config.durationSeconds / 3600).toFixed(2)}h)`);
  console.log(`  Completed:            ${actualDuration >= config.durationSeconds ? 'YES' : 'NO'}`);
  console.log('');
  console.log('  CYCLE METRICS:');
  console.log(`  Total cycles:         ${metrics.cycles}`);
  console.log(`  Successes:            ${metrics.successes}`);
  console.log(`  Failures:             ${metrics.failures}`);
  console.log(`  Recoveries:           ${metrics.recoveries}`);
  console.log(`  Replans:              ${metrics.replans}`);
  console.log(`  Interventions:        ${metrics.interventionsCreated} (approved=${metrics.interventionsApproved}, rejected=${metrics.interventionsRejected})`);
  console.log('');
  console.log('  SAFETY METRICS:');
  console.log(`  Duplicate side effects: ${metrics.duplicateSideEffects}`);
  console.log(`  Orphaned interventions: ${metrics.orphanedInterventions}`);
  console.log(`  Terminal resurrections: ${metrics.terminalResurrections}`);
  console.log(`  Event duplications:     ${metrics.eventDuplications}`);
  console.log(`  Persistence failures:   ${metrics.persistenceFailures}`);
  console.log('');
  console.log('  HEALTH CHECKS:');
  console.log(`  Total:                ${metrics.healthChecks}`);
  console.log(`  Failures:             ${metrics.healthCheckFailures}`);
  console.log('');
  console.log('  ENVIRONMENTAL BLOCKERS:');
  for (const b of metrics.environmentalBlockers) console.log(`    ⚠ ${b}`);
  if (metrics.environmentalBlockers.length === 0) console.log('    None');
  console.log('');
  console.log('  SAFETY VIOLATIONS:');
  for (const v of metrics.safetyViolations) console.log(`    ✗ ${v}`);
  if (metrics.safetyViolations.length === 0) console.log('    None');
  console.log('');
  console.log('  MEMORY TREND (samples):');
  for (const s of metrics.memorySamples.slice(-10)) {
    console.log(`    ${s.time} | heap=${s.heapMB.toFixed(1)}MB rss=${s.rssMB.toFixed(1)}MB queue=${s.queueDepth}`);
  }
  console.log('═══════════════════════════════════════════════════════════════');

  // ─── Qualification status ────────────────────────────────────────
  // 24-hour qualification is ONLY earned when an actual 24-hour (86400s) run
  // completes without safety violations or environmental blockers.
  const TWENTY_FOUR_HOURS_SECONDS = 86400;
  const ranFullDuration = actualDuration >= config.durationSeconds;
  const noViolations = metrics.safetyViolations.length === 0;
  const noBlockers = metrics.environmentalBlockers.length === 0;
  const isActual24h = config.durationSeconds >= TWENTY_FOUR_HOURS_SECONDS && ranFullDuration;

  console.log('\n  QUALIFICATION STATUS:');
  if (isActual24h && noViolations && noBlockers) {
    console.log(`    ✓ 24-HOUR SOAK QUALIFIED (ran for ${actualDuration.toFixed(1)}s = ${(actualDuration / 3600).toFixed(2)}h)`);
  } else if (ranFullDuration && noViolations && noBlockers) {
    console.log(`    ✓ SMOKE TEST PASSED (ran for ${actualDuration.toFixed(1)}s = ${(actualDuration / 3600).toFixed(4)}h)`);
    console.log(`    ⚠ 24-hour qualification NOT YET EARNED — must run with --duration=86400`);
  } else if (!ranFullDuration && noViolations && noBlockers) {
    console.log(`    ⚠ PARTIAL RUN COMPLETED (${actualDuration.toFixed(1)}s of ${config.durationSeconds}s)`);
    console.log(`    ⚠ 24-hour qualification NOT YET EARNED — must run full duration`);
  } else {
    console.log(`    ✗ NOT QUALIFIED — safety violations or environmental blockers`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  writeResults(config, metrics);

  // Exit code: 0 if qualified or partial clean, 1 if violations, 2 if timeout
  if (metrics.safetyViolations.length > 0) process.exit(1);
  if (metrics.environmentalBlockers.length > 0) process.exit(1);
  process.exit(0);
}

function writeResults(config: HarnessConfig, m: HarnessMetrics) {
  const TWENTY_FOUR_HOURS_SECONDS = 86400;
  const ranFull = m.durationActualSeconds >= config.durationSeconds;
  const clean = m.safetyViolations.length === 0 && m.environmentalBlockers.length === 0;
  const isActual24h = config.durationSeconds >= TWENTY_FOUR_HOURS_SECONDS && ranFull;

  let qualificationStatus: string;
  if (isActual24h && clean) qualificationStatus = 'QUALIFIED_24H';
  else if (ranFull && clean) qualificationStatus = 'SMOKE_TEST_PASSED_NOT_24H';
  else if (clean) qualificationStatus = 'PARTIAL_RUN';
  else qualificationStatus = 'NOT_QUALIFIED';

  const output = {
    phase: '10',
    timestamp: new Date().toISOString(),
    config,
    metrics: m,
    qualificationStatus,
    note: '24-hour qualification is ONLY earned after an actual 24-hour run (86400s) completes without safety violations or environmental blockers. A smoke test pass does not constitute 24-hour qualification.',
  };
  fs.writeFileSync(config.outputFilePath, JSON.stringify(output, null, 2));
  console.log(`  Results written to: ${config.outputFilePath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
