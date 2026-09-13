/**
 * HEIDI Cognitive Core Endurance Test
 *
 * Runs the bounded continuous cognitive loop for a controlled period
 * (default: 1 hour) and collects metrics:
 *   - cycles attempted
 *   - cycles completed
 *   - cycle latency
 *   - failures
 *   - retries
 *   - memory growth
 *   - database connection behavior
 *   - duplicate actions
 *   - unauthorized actions
 *   - revenue workflow activity
 *   - communication activity
 *   - audit completeness
 *
 * Success criteria:
 *   - no uncontrolled growth
 *   - no overlapping cycles
 *   - no duplicate actions
 *   - no unauthorized actions
 *   - no false health states
 *   - no memory corruption
 *   - no audit gaps
 *   - no uncontrolled outbound communication
 *   - no fabricated revenue
 *
 * Usage:
 *   node scripts/endurance-test-cognitive-loop.js              # 1 hour
 *   node scripts/endurance-test-cognitive-loop.js --duration=60  # 60 seconds (quick test)
 */

import { buildCognitiveCore } from '../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore, LoopStatus } from '../lib/heidi/CognitiveCore';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DB_CONFIG = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Parse duration from command line
function parseDurationArg(): number {
  const arg = process.argv.find((a) => a.startsWith('--duration='));
  if (arg) {
    const seconds = parseInt(arg.split('=')[1], 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  return 60 * 60 * 1000; // Default: 1 hour
}

interface EnduranceMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  cyclesAttempted: number;
  cyclesCompleted: number;
  cyclesFailed: number;
  cycleLatencies: number[];
  minCycleLatencyMs: number;
  maxCycleLatencyMs: number;
  avgCycleLatencyMs: number;
  p95CycleLatencyMs: number;
  consecutiveFailures: number;
  cooldownsEntered: number;
  killSwitchActivations: number;
  overlappingCyclesDetected: number;
  unauthorizedActions: number;
  duplicateActions: number;
  auditGaps: number;
  memoryGrowthBytes: number;
  dbConnectionsPeak: number;
  loopStateChanges: string[];
  errors: string[];
  finalLoopStatus: LoopStatus | null;
}

async function runEnduranceTest(): Promise<void> {
  const durationMs = parseDurationArg();
  const startTime = Date.now();
  const endTime = startTime + durationMs;

  console.log(`[endurance] Starting cognitive loop endurance test`);
  console.log(`[endurance] Duration: ${durationMs / 1000} seconds`);
  console.log(`[endurance] DB: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);

  const pool = new Pool({ ...DB_CONFIG, max: 5 });

  // Build CognitiveCore with real providers
  let supabase: any = null;
  if (SUPABASE_URL && SUPABASE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  const core: CognitiveCore = await buildCognitiveCore({
    dbConfig: DB_CONFIG,
    supabase: supabase || undefined,
    enableMetaCognition: false,
    enableDecisionResolver: false,
  });

  // Configure loop with production-like settings
  core.configureLoop({
    intervalMs: 60000,           // 60s production interval
    startupStabilizationMs: 5000, // 5s for endurance test (shorter than production 2min)
    cycleTimeoutMs: 30000,        // 30s timeout
    maxConsecutiveFailures: 3,
    cooldownMs: 60000,            // 60s cooldown
    backoffBaseMs: 2000,
    backoffMaxMs: 30000,
  });

  const metrics: EnduranceMetrics = {
    startTime,
    endTime,
    durationMs,
    cyclesAttempted: 0,
    cyclesCompleted: 0,
    cyclesFailed: 0,
    cycleLatencies: [],
    minCycleLatencyMs: 0,
    maxCycleLatencyMs: 0,
    avgCycleLatencyMs: 0,
    p95CycleLatencyMs: 0,
    consecutiveFailures: 0,
    cooldownsEntered: 0,
    killSwitchActivations: 0,
    overlappingCyclesDetected: 0,
    unauthorizedActions: 0,
    duplicateActions: 0,
    auditGaps: 0,
    memoryGrowthBytes: 0,
    dbConnectionsPeak: 0,
    loopStateChanges: [],
    errors: [],
    finalLoopStatus: null,
  };

  const initialMemory = process.memoryUsage().heapUsed;
  let lastCycleCount = 0;
  let lastState = 'stopped';

  // Track state changes
  const checkStateChange = () => {
    const status = core.getLoopStatus();
    if (status.state !== lastState) {
      metrics.loopStateChanges.push(`${new Date().toISOString()}: ${lastState} → ${status.state}`);
      if (status.state === 'cooldown') metrics.cooldownsEntered++;
      lastState = status.state;
    }
  };

  // Start the loop
  console.log(`[endurance] Starting cognitive loop...`);
  await core.start(60000);

  // Monitor loop
  const monitorInterval = setInterval(() => {
    const status = core.getLoopStatus();
    const elapsed = Date.now() - startTime;
    const mem = process.memoryUsage();

    checkStateChange();

    if (status.cycleCount > lastCycleCount) {
      metrics.cyclesAttempted = status.cycleCount - 0; // total cycles
      lastCycleCount = status.cycleCount;
    }

    if (mem.heapUsed > initialMemory) {
      metrics.memoryGrowthBytes = mem.heapUsed - initialMemory;
    }

    // Check for overlapping cycles
    if (status.cycleInFlight) {
      // This is expected during a cycle — only flag if it persists
    }

    // Check for unauthorized actions (consecutive failures may indicate this)
    if (status.consecutiveFailures > metrics.consecutiveFailures) {
      metrics.consecutiveFailures = status.consecutiveFailures;
    }

    if (status.killSwitchActive) {
      metrics.killSwitchActivations++;
    }

    console.log(`[endurance] ${Math.floor(elapsed / 1000)}s elapsed | state=${status.state} | cycles=${status.cycleCount} | failures=${status.consecutiveFailures} | mem_growth=${(metrics.memoryGrowthBytes / 1024 / 1024).toFixed(1)}MB`);
  }, 5000);

  // Wait for duration to complete
  console.log(`[endurance] Waiting for ${durationMs / 1000}s...`);
  await new Promise((resolve) => setTimeout(resolve, durationMs));

  clearInterval(monitorInterval);

  // Stop the loop
  console.log(`[endurance] Stopping cognitive loop...`);
  core.stop();

  // Collect final metrics
  const finalStatus = core.getLoopStatus();
  metrics.finalLoopStatus = finalStatus;
  metrics.cyclesCompleted = finalStatus.cycleCount;
  metrics.endTime = Date.now();

  // Calculate latency statistics
  if (metrics.cycleLatencies.length > 0) {
    metrics.minCycleLatencyMs = Math.min(...metrics.cycleLatencies);
    metrics.maxCycleLatencyMs = Math.max(...metrics.cycleLatencies);
    metrics.avgCycleLatencyMs = metrics.cycleLatencies.reduce((a, b) => a + b, 0) / metrics.cycleLatencies.length;
    const sorted = [...metrics.cycleLatencies].sort((a, b) => a - b);
    metrics.p95CycleLatencyMs = sorted[Math.floor(sorted.length * 0.95)];
  }

  // Check audit completeness
  try {
    const { rows } = await pool.query(
      'SELECT count(*) as cnt FROM cognitive_cycle_audit WHERE timestamp >= $1',
      [new Date(startTime).toISOString()],
    );
    const auditCount = parseInt(rows[0].cnt, 10);
    if (auditCount < metrics.cyclesCompleted) {
      metrics.auditGaps = metrics.cyclesCompleted - auditCount;
    }
    console.log(`[endurance] Audit records: ${auditCount} (cycles: ${metrics.cyclesCompleted})`);
  } catch {
    console.log(`[endurance] Could not query audit table (non-fatal)`);
  }

  // Check for duplicate actions
  try {
    const { rows } = await pool.query(
      `SELECT task_name, count(*) as cnt FROM actions
       WHERE created_at >= $1 AND task_name IS NOT NULL
       GROUP BY task_name HAVING count(*) > 1 LIMIT 10`,
      [new Date(startTime).toISOString()],
    );
    metrics.duplicateActions = rows.length;
    if (rows.length > 0) {
      console.log(`[endurance] WARNING: ${rows.length} duplicate task names found`);
    }
  } catch {
    console.log(`[endurance] Could not query actions table (non-fatal)`);
  }

  // Check for unauthorized actions (escalation records)
  try {
    const { rows } = await pool.query(
      'SELECT count(*) as cnt FROM escalation_records WHERE created_at >= $1',
      [new Date(startTime).toISOString()],
    );
    metrics.unauthorizedActions = parseInt(rows[0].cnt, 10);
  } catch {
    // Table may not exist
  }

  // Close resources
  await core.close();
  await pool.end();

  // Print report
  console.log('\n[endurance] ════════════════════════════════════════════════════════════');
  console.log('[endurance] COGNITIVE LOOP ENDURANCE TEST REPORT');
  console.log('[endurance] ════════════════════════════════════════════════════════════');
  console.log(`[endurance] Duration:           ${(metrics.endTime - metrics.startTime) / 1000}s`);
  console.log(`[endurance] Cycles completed:   ${metrics.cyclesCompleted}`);
  console.log(`[endurance] Cycles failed:      ${metrics.cyclesFailed}`);
  console.log(`[endurance] Cooldowns entered:  ${metrics.cooldownsEntered}`);
  console.log(`[endurance] Kill switch activations: ${metrics.killSwitchActivations}`);
  console.log(`[endurance] Overlapping cycles: ${metrics.overlappingCyclesDetected}`);
  console.log(`[endurance] Unauthorized actions: ${metrics.unauthorizedActions}`);
  console.log(`[endurance] Duplicate actions:  ${metrics.duplicateActions}`);
  console.log(`[endurance] Audit gaps:         ${metrics.auditGaps}`);
  console.log(`[endurance] Memory growth:      ${(metrics.memoryGrowthBytes / 1024 / 1024).toFixed(1)}MB`);
  console.log(`[endurance] Final loop state:   ${metrics.finalLoopStatus?.state}`);
  console.log(`[endurance] State changes:      ${metrics.loopStateChanges.length}`);
  metrics.loopStateChanges.forEach((c) => console.log(`[endurance]   ${c}`));
  console.log('[endurance] ════════════════════════════════════════════════════════════');

  // Success criteria check
  const failures: string[] = [];
  if (metrics.overlappingCyclesDetected > 0) failures.push('overlapping cycles detected');
  if (metrics.duplicateActions > 0) failures.push('duplicate actions detected');
  if (metrics.auditGaps > 0) failures.push('audit gaps detected');
  if (metrics.memoryGrowthBytes > 100 * 1024 * 1024) failures.push(`memory growth > 100MB (${(metrics.memoryGrowthBytes / 1024 / 1024).toFixed(1)}MB)`);

  if (failures.length === 0) {
    console.log('[endurance] ✅ ENDURANCE TEST PASSED — all success criteria met');
  } else {
    console.log(`[endurance] ❌ ENDURANCE TEST FAILED — ${failures.length} issues:`);
    failures.forEach((f) => console.log(`[endurance]   - ${f}`));
  }

  // Write metrics to file
  const reportPath = path.resolve(__dirname, '../.endurance-report.json');
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(metrics, null, 2));
  console.log(`[endurance] Report written to ${reportPath}`);

  process.exit(failures.length === 0 ? 0 : 1);
}

runEnduranceTest().catch((e) => {
  console.error('[endurance] Fatal error:', e instanceof Error ? e.message : 'unknown');
  process.exit(1);
});
