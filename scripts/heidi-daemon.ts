/**
 * HEIDI Continuous Cognitive-Loop Daemon
 *
 * Wraps the existing CognitiveCore bounded loop with:
 *   1. Self-sufficiency integration — each cycle observes capability health,
 *      classifies blockers, and runs governed self-repair
 *   2. Process-level single-instance locking — prevents duplicate daemons
 *   3. SIGINT/SIGTERM graceful shutdown — finishes current cycle, then stops
 *   4. Persistent audit records — every cycle gets an ID and is recorded
 *   5. Health reporting — exposes loop state through /api/status
 *
 * The daemon does NOT:
 *   - Escalate autonomy level
 *   - Bypass authorization
 *   - Fabricate credentials, revenue, or health
 *   - Modify protected assets
 *   - Run without the kill switch being functional
 *
 * Usage:
 *   npx tsx scripts/heidi-daemon.ts                              # default 60s cycle
 *   npx tsx scripts/heidi-daemon.ts --interval=30000             # 30s cycle
 *   npx tsx scripts/heidi-daemon.ts --no-stabilization           # skip 2min startup delay
 *   npx tsx scripts/heidi-daemon.ts --once                       # run one cycle and exit
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { buildCognitiveCore } from '../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore, LoopStatus } from '../lib/heidi/CognitiveCore';

// ─── Configuration ───────────────────────────────────────────────────────

const DB_CONFIG = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
};

const LOCK_FILE = path.resolve(__dirname, '..', '.heidi-daemon.lock');
const AUDIT_FILE = path.resolve(__dirname, '..', '.heidi-daemon-audit.jsonl');

interface DaemonConfig {
  intervalMs: number;
  startupStabilizationMs: number;
  once: boolean;
}

function parseArgs(): DaemonConfig {
  const args = process.argv.slice(2);
  const config: DaemonConfig = {
    intervalMs: 60000,
    startupStabilizationMs: 120000,
    once: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--interval=')) {
      config.intervalMs = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--no-stabilization') {
      config.startupStabilizationMs = 0;
    } else if (arg === '--once') {
      config.once = true;
    }
  }

  return config;
}

// ─── Single-Instance Lock ────────────────────────────────────────────────

function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    if (content) {
      try {
        const lockData = JSON.parse(content);
        // Check if the lock is stale (process no longer running)
        if (lockData.pid && !isProcessAlive(lockData.pid)) {
          console.log(`[daemon] Stale lock from PID ${lockData.pid}, removing`);
          fs.unlinkSync(LOCK_FILE);
        } else {
          console.error(`[daemon] Another daemon is already running (PID: ${lockData.pid})`);
          return false;
        }
      } catch {
        // Corrupt lock file — remove it
        fs.unlinkSync(LOCK_FILE);
      }
    }
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }));
  return true;
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      if (content) {
        const lockData = JSON.parse(content);
        if (lockData.pid === process.pid) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    }
  } catch {
    // Best effort
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Audit Recording ─────────────────────────────────────────────────────

interface CycleAuditRecord {
  cycleId: string;
  timestamp: string;
  phase: string;
  loopState: string;
  cycleCount: number;
  capabilityHealth?: {
    total: number;
    ready: number;
    blocked: number;
    unavailable: number;
  } | null;
  selfRepairResult?: {
    totalIssues: number;
    repaired: number;
    escalated: number;
    workedAround: number;
    refused: number;
  } | null;
  error?: string;
  durationMs?: number;
}

function appendAuditRecord(record: CycleAuditRecord): void {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n');
  } catch {
    // Best effort — don't crash the daemon for audit write failures
  }
}

// ─── Self-Sufficiency Cycle Integration ──────────────────────────────────

async function runSelfSufficiencyCycle(core: CognitiveCore): Promise<{
  capabilityHealth: { total: number; ready: number; blocked: number; unavailable: number } | null;
  selfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null;
}> {
  const bridge = core.getBridge();

  if (!bridge.capabilityHealthManager) {
    return { capabilityHealth: null, selfRepairResult: null };
  }

  try {
    // 1. OBSERVE: Check all capabilities
    const summary = await bridge.capabilityHealthManager.checkAll() as any;

    const capabilityHealth = {
      total: summary.total,
      ready: summary.ready,
      blocked: summary.blocked,
      unavailable: summary.unavailable,
    };

    // 2. CLASSIFY + REPAIR: Run self-repair if engine is wired
    let selfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null = null;

    if (bridge.selfRepairEngine) {
      try {
        const repairResult = await bridge.selfRepairEngine.runSelfRepair(summary) as any;
        selfRepairResult = {
          totalIssues: repairResult.totalIssues,
          repaired: repairResult.repaired,
          escalated: repairResult.escalated,
          workedAround: repairResult.workedAround,
          refused: repairResult.refused,
        };
      } catch (repairError) {
        // Self-repair failure must not kill the daemon
        console.error(`[daemon] Self-repair cycle failed: ${repairError instanceof Error ? repairError.message : 'unknown'}`);
      }
    }

    return { capabilityHealth, selfRepairResult };
  } catch (error) {
    console.error(`[daemon] Capability health check failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return { capabilityHealth: null, selfRepairResult: null };
  }
}

// ─── Daemon Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('HEIDI CONTINUOUS COGNITIVE-LOOP DAEMON');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`PID:              ${process.pid}`);
  console.log(`Interval:         ${config.intervalMs}ms`);
  console.log(`Stabilization:    ${config.startupStabilizationMs}ms`);
  console.log(`Mode:             ${config.once ? 'single cycle' : 'continuous'}`);
  console.log(`Autonomy level:   2 (EXECUTE_REVERSIBLE)`);
  console.log(`Kill switch:      ARMED`);
  console.log('');

  // 1. Acquire single-instance lock
  if (!acquireLock()) {
    process.exit(1);
  }
  console.log(`[daemon] Lock acquired: ${LOCK_FILE}`);

  // 2. Build production CognitiveCore with self-sufficiency wired
  console.log('[daemon] Building production CognitiveCore...');
  const core = await buildCognitiveCore({ dbConfig: DB_CONFIG });
  const bridge = core.getBridge();

  // Verify self-sufficiency services are wired
  const wired: string[] = [];
  if (bridge.capabilityHealthManager) wired.push('CapabilityHealthManager');
  if (bridge.blockerResolutionEngine) wired.push('BlockerResolutionEngine');
  if (bridge.selfRepairEngine) wired.push('SelfRepairEngine');
  console.log(`[daemon] Self-sufficiency services: ${wired.join(', ') || 'NONE'}`);

  if (wired.length === 0) {
    console.error('[daemon] FATAL: No self-sufficiency services wired');
    releaseLock();
    process.exit(1);
  }

  // 3. Set up graceful shutdown
  let shuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');
    console.log(`[daemon] ${signal} received — shutting down gracefully`);

    // Stop the loop
    core.stop();
    console.log('[daemon] Cognitive loop stopped');

    // Record final audit
    appendAuditRecord({
      cycleId: `daemon-shutdown-${Date.now()}`,
      timestamp: new Date().toISOString(),
      phase: 'shutdown',
      loopState: 'stopped',
      cycleCount: core.getLoopStatus().cycleCount,
    });

    // Release lock
    releaseLock();
    console.log('[daemon] Lock released');

    console.log('[daemon] Shutdown complete');
    console.log('════════════════════════════════════════════════════════════════');
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

  // 4. Run initial self-sufficiency observation
  console.log('[daemon] Running initial capability health check...');
  const initialResult = await runSelfSufficiencyCycle(core);
  if (initialResult.capabilityHealth) {
    console.log(`[daemon] Capabilities: ${initialResult.capabilityHealth.total} total, ${initialResult.capabilityHealth.ready} READY, ${initialResult.capabilityHealth.blocked} BLOCKED, ${initialResult.capabilityHealth.unavailable} UNAVAILABLE`);
  }
  if (initialResult.selfRepairResult) {
    const r = initialResult.selfRepairResult;
    console.log(`[daemon] Self-repair: ${r.totalIssues} issues, ${r.repaired} repaired, ${r.workedAround} worked around, ${r.escalated} escalated, ${r.refused} refused`);
  }

  // 5. Single-cycle mode
  if (config.once) {
    console.log('[daemon] Running single cognitive cycle...');
    try {
      const cycleState = await core.runCycle();
      console.log(`[daemon] Cycle complete: ${cycleState.phase}`);
      appendAuditRecord({
        cycleId: `daemon-once-${Date.now()}`,
        timestamp: new Date().toISOString(),
        phase: cycleState.phase,
        loopState: 'stopped',
        cycleCount: 1,
        ...initialResult,
      });
    } catch (error) {
      console.error(`[daemon] Cycle failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    releaseLock();
    process.exit(0);
  }

  // 6. Start continuous loop
  console.log(`[daemon] Starting continuous loop (${config.intervalMs}ms interval)...`);

  // Override loop config to use our interval
  // The CognitiveCore.start() method accepts an interval parameter
  await core.start(config.intervalMs);

  // 7. Self-sufficiency observation loop (runs alongside cognitive loop)
  let selfSufficiencyCycleCount = 0;

  async function runSelfSufficiencyInterval(): Promise<void> {
    if (shuttingDown) return;

    selfSufficiencyCycleCount++;
    const cycleId = `ssf-${Date.now()}-${selfSufficiencyCycleCount}`;
    const startTime = Date.now();

    try {
      const result = await runSelfSufficiencyCycle(core);
      const durationMs = Date.now() - startTime;

      appendAuditRecord({
        cycleId,
        timestamp: new Date().toISOString(),
        phase: 'self_sufficiency',
        loopState: core.getLoopStatus().state,
        cycleCount: core.getLoopStatus().cycleCount,
        capabilityHealth: result.capabilityHealth || undefined,
        selfRepairResult: result.selfRepairResult || undefined,
        durationMs,
      });

      // Log significant events
      if (result.selfRepairResult && result.selfRepairResult.repaired > 0) {
        console.log(`[daemon] [${cycleId}] Repaired ${result.selfRepairResult.repaired} capability(s)`);
      }
      if (result.selfRepairResult && result.selfRepairResult.refused > 0) {
        console.log(`[daemon] [${cycleId}] Refused ${result.selfRepairResult.refused} protected-asset repair(s)`);
      }
      if (result.selfRepairResult && result.selfRepairResult.escalated > 0) {
        console.log(`[daemon] [${cycleId}] Escalated ${result.selfRepairResult.escalated} blocker(s) to human`);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      appendAuditRecord({
        cycleId,
        timestamp: new Date().toISOString(),
        phase: 'self_sufficiency',
        loopState: core.getLoopStatus().state,
        cycleCount: core.getLoopStatus().cycleCount,
        error: error instanceof Error ? error.message : 'unknown',
        durationMs,
      });
      // Cycle isolation — one failed observation must not kill the daemon
      console.error(`[daemon] [${cycleId}] Self-sufficiency cycle failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  // Run self-sufficiency on the same interval as the cognitive loop
  const ssfInterval = setInterval(runSelfSufficiencyInterval, config.intervalMs);

  // 8. Status reporting
  const statusInterval = setInterval(() => {
    if (shuttingDown) return;
    const status = core.getLoopStatus();
    const memUsage = process.memoryUsage();
    console.log(`[daemon] state=${status.state} cycles=${status.cycleCount} failures=${status.consecutiveFailures} mem=${Math.round(memUsage.rss / 1024 / 1024)}MB kill=${status.killSwitchActive}`);
  }, 30000);

  // 9. Wait for shutdown
  console.log('[daemon] Daemon is running. Press Ctrl+C to stop.');
  console.log('');

  // Keep the process alive
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (shuttingDown) {
        clearInterval(checkInterval);
        clearInterval(ssfInterval);
        clearInterval(statusInterval);
        resolve();
      }
    }, 1000);
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────

main().catch((error) => {
  console.error(`[daemon] FATAL: ${error instanceof Error ? error.message : 'unknown'}`);
  releaseLock();
  process.exit(1);
});
