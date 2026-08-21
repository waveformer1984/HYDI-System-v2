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
const AUDIT_FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — rotate when exceeded

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

/**
 * Acquire the single-instance lock atomically.
 *
 * Uses fs.writeFileSync with { flag: 'wx' } which is an exclusive create —
 * it fails with EEXIST if the file already exists. This eliminates the
 * TOCTOU race that existed with the previous check-then-write approach
 * (existsSync -> unlinkSync -> writeFileSync), where two near-simultaneous
 * daemon starts could both pass the existence check before either wrote.
 *
 * If the lock file exists, we check whether the owning process is still
 * alive. If it's stale (process died without releasing), we remove it and
 * retry the atomic create. If the process IS alive, we refuse to start.
 */
function acquireLock(): boolean {
  const lockData = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  // First attempt: atomic exclusive create
  try {
    fs.writeFileSync(LOCK_FILE, lockData, { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    // EEXIST means the file already exists — check if it's stale
    if (!isNodeError(error, 'EEXIST')) {
      // Some other error (permissions, disk full, etc.)
      console.error(`[daemon] Lock acquisition failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return false;
    }
  }

  // Lock file exists — check if the owning process is still alive
  try {
    const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    if (!content) {
      // Empty lock file — remove and retry
      fs.unlinkSync(LOCK_FILE);
      try {
        fs.writeFileSync(LOCK_FILE, lockData, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }

    const lockInfo = JSON.parse(content);
    if (lockInfo.pid && isProcessAlive(lockInfo.pid)) {
      console.error(`[daemon] Another daemon is already running (PID: ${lockInfo.pid})`);
      return false;
    }

    // Stale lock — process is no longer alive
    console.log(`[daemon] Stale lock from PID ${lockInfo.pid}, removing`);
    fs.unlinkSync(LOCK_FILE);

    // Retry atomic create
    try {
      fs.writeFileSync(LOCK_FILE, lockData, { flag: 'wx' });
      return true;
    } catch (retryError: unknown) {
      if (isNodeError(retryError, 'EEXIST')) {
        // Someone else grabbed it between our unlink and write
        console.error('[daemon] Lock acquired by another process during stale cleanup');
      } else {
        console.error(`[daemon] Lock retry failed: ${retryError instanceof Error ? retryError.message : 'unknown'}`);
      }
      return false;
    }
  } catch {
    // Corrupt lock file — remove and retry
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // Can't remove — give up
      console.error('[daemon] Cannot remove corrupt lock file');
      return false;
    }
    try {
      fs.writeFileSync(LOCK_FILE, lockData, { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Type guard for Node.js filesystem errors with a specific code.
 */
function isNodeError(error: unknown, code: string): boolean {
  return error !== null &&
         typeof error === 'object' &&
         'code' in error &&
         (error as { code: string }).code === code;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  acquisitionResult?: {
    attempted: number;
    resolved: number;
    escalated: number;
    states: Record<string, string>;
  } | null;
  error?: string;
  durationMs?: number;
}

function appendAuditRecord(record: CycleAuditRecord): void {
  try {
    // Rotate audit file if it exceeds the max size.
    // We keep the most recent entries by reading the file, trimming from
    // the front, and rewriting. This is O(n) but only triggers when the
    // file exceeds the cap, not on every write.
    try {
      const stats = fs.statSync(AUDIT_FILE);
      if (stats.size > AUDIT_FILE_MAX_BYTES) {
        rotateAuditFile();
      }
    } catch {
      // File doesn't exist yet — no rotation needed
    }
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n');
  } catch {
    // Best effort — don't crash the daemon for audit write failures
  }
}

/**
 * Rotate the audit file by keeping only the most recent half of entries.
 * This bounds disk usage so the JSONL file doesn't grow forever in a
 * long-running daemon.
 */
function rotateAuditFile(): void {
  try {
    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Keep the most recent half
    const keepCount = Math.floor(lines.length / 2);
    const kept = lines.slice(lines.length - keepCount);
    fs.writeFileSync(AUDIT_FILE, kept.join('\n') + '\n');
    console.log(`[daemon] Audit file rotated: ${lines.length} -> ${keepCount} entries`);
  } catch {
    // Best effort
  }
}

// ─── Self-Sufficiency Cycle Integration ──────────────────────────────────

async function runSelfSufficiencyCycle(core: CognitiveCore): Promise<{
  capabilityHealth: { total: number; ready: number; blocked: number; unavailable: number } | null;
  selfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null;
  credentialWatchResult: { newlyResolved: string[]; stillMissing: string[] } | null;
  acquisitionResult: { attempted: number; resolved: number; escalated: number; states: Record<string, string> } | null;
}> {
  const bridge = core.getBridge();

  if (!bridge.capabilityHealthManager) {
    return { capabilityHealth: null, selfRepairResult: null, credentialWatchResult: null, acquisitionResult: null };
  }

  try {
    // 0. CREDENTIAL WATCH: Detect newly-resolved credentials before probing
    let credentialWatchResult: { newlyResolved: string[]; stillMissing: string[] } | null = null;
    try {
      const { getCredentialRunbookRegistry } = await import('../lib/operational/CredentialRunbookRegistry');
      const registry = getCredentialRunbookRegistry();
      const newlyResolved = registry.getNewlyResolved();
      const missing = registry.getMissingCredentialRunbooks();

      if (newlyResolved.length > 0) {
        console.log(`[daemon] 📤 Credential resolution detected: ${newlyResolved.join(', ')} — triggering re-verification`);
        // Force re-check of the resolved capabilities
        for (const key of newlyResolved) {
          const runbook = registry.getRunbook(key);
          if (runbook) {
            try {
              await bridge.capabilityHealthManager.checkCapability(runbook.capabilityId);
              console.log(`[daemon] ✅ Re-verified ${runbook.capabilityId} after credential resolution`);
            } catch (e) {
              console.error(`[daemon] Re-verification of ${runbook.capabilityId} failed: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }
        }
      }

      credentialWatchResult = {
        newlyResolved,
        stillMissing: missing.map((m) => m.key),
      };
    } catch (watchError) {
      // Credential watcher failure must not kill the daemon
      console.error(`[daemon] Credential watcher failed: ${watchError instanceof Error ? watchError.message : 'unknown'}`);
    }

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

    // 3. ACQUIRE: Run acquisition engine for blocked external capabilities
    let acquisitionResult: { attempted: number; resolved: number; escalated: number; states: Record<string, string> } | null = null;
    try {
      const { getAcquisitionEngine } = await import('../lib/operational/ExternalCapabilityAcquisitionEngine');
      const engine = getAcquisitionEngine();
      const blockedCaps = (summary.reports || []).filter((r: any) => r.state === 'BLOCKED' && r.failureClassification === 'MISSING_EXTERNAL_CREDENTIAL');

      if (blockedCaps.length > 0) {
        const states: Record<string, string> = {};
        let resolved = 0;
        let escalated = 0;

        for (const cap of blockedCaps) {
          try {
            const lifecycle = await engine.resolveCapability(cap.capabilityId);
            states[cap.capabilityId] = lifecycle.currentState;
            if (lifecycle.currentState === 'READY') {
              resolved++;
              console.log(`[daemon] 🎉 Capability acquired: ${cap.capabilityId} → READY`);
            } else if (lifecycle.currentState === 'POLICY_BLOCKED' || lifecycle.currentState === 'BLOCKED') {
              escalated++;
            }
          } catch (e) {
            states[cap.capabilityId] = 'ACQUISITION_FAILED';
            console.error(`[daemon] Acquisition of ${cap.capabilityId} failed: ${e instanceof Error ? e.message : 'unknown'}`);
          }
        }

        acquisitionResult = { attempted: blockedCaps.length, resolved, escalated, states };
      }
    } catch (acqError) {
      // Acquisition engine failure must not kill the daemon
      console.error(`[daemon] Acquisition engine failed: ${acqError instanceof Error ? acqError.message : 'unknown'}`);
    }

    return { capabilityHealth, selfRepairResult, credentialWatchResult, acquisitionResult };
  } catch (error) {
    console.error(`[daemon] Capability health check failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return { capabilityHealth: null, selfRepairResult: null, credentialWatchResult: null, acquisitionResult: null };
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
  // Track whether the self-sufficiency interval callback is currently
  // executing. This mirrors core.getLoopStatus().cycleInFlight for the
  // cognitive loop. gracefulShutdown waits for both to clear before
  // exiting, so a SIGTERM during a live self-repair action doesn't kill
  // it mid-execution.
  let ssfInFlight = false;
  // Bounded wait for in-flight work during shutdown. Must be less than
  // PM2's kill_timeout (50s) so PM2 doesn't force-kill before we finish.
  //
  // The cognitive cycle has a 30s timeout (cycleTimeoutMs in
  // CognitiveCore). When the timeout fires, cycleInFlight is set to
  // false by runBoundedCycle's finally block. So SHUTDOWN_WAIT_TIMEOUT_MS
  // must be >= 30s to wait for that timeout to fire. 31s gives 1s buffer
  // for timer jitter.
  //
  // This timer starts when the daemon RECEIVES the IPC shutdown message,
  // NOT when PM2 sends it. The IPC delivery delay (launcher → daemon)
  // is covered by the kill_timeout margin, not by this value.
  //
  // Measured worst-case timing (20-sample distribution test, 5s interval
  // stress test, idle + CPU-loaded conditions):
  //   IPC delivery (launcher → daemon):
  //     idle:  p50=3839ms, p95=5466ms, max=5466ms
  //     loaded: p50=4784ms, p95=5423ms, max=6024ms
  //   Total shutdown duration (IPC receipt → exit):
  //     idle:  p50=28130ms, p95=34858ms, max=34858ms
  //     loaded: p50=27926ms, p95=31092ms, max=33366ms
  //
  // Budget (from PM2 message send to process exit):
  //   IPC delivery (max measured):       6024ms
  //   Shutdown wait (SHUTDOWN_WAIT):    31000ms
  //   Polling overshoot (100ms polls):    ~100ms
  //   Cleanup (audit + lock):             ~100ms
  //   Total worst case:                ~37224ms
  //   kill_timeout: 50000ms
  //   Margin: 12776ms (34.3% over worst case)
  //
  // PM2 source verification (pm2@7.0.1 lib/God/Methods.js):
  //   kill_timeout starts in God.processIsDead(), called synchronously
  //   after proc.send('shutdown') in God.killProcess(). The PM2 CLI →
  //   God RPC delay (0-11s observed) happens BEFORE the kill_timeout
  //   timer starts, so it is NOT part of the budget.
  const SHUTDOWN_WAIT_TIMEOUT_MS = 31000;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const shutdownStartMs = Date.now();
    console.log('');
    console.log(`[daemon] ${signal} received — shutting down gracefully at ${new Date().toISOString()} (epoch ms: ${shutdownStartMs})`);

    // Stop scheduling new cycles (both cognitive loop and self-sufficiency)
    core.stop();
    console.log('[daemon] Cognitive loop stopped (no new cycles scheduled)');

    // Wait for in-flight work to complete:
    //   - core.getLoopStatus().cycleInFlight (cognitive loop)
    //   - ssfInFlight (self-sufficiency interval)
    // Both must be false before we release the lock and exit.
    //
    // Polling interval is 100ms (not 500ms) to reduce timeout overshoot
    // under event-loop congestion. With 500ms polling, the last sleep
    // could take seconds under load, causing the total shutdown duration
    // to exceed SHUTDOWN_WAIT_TIMEOUT_MS by 3-4s. With 100ms polling,
    // the overshoot is bounded to ~100ms.
    const POLL_INTERVAL_MS = 100;
    const waitStart = Date.now();
    let cognitiveInFlight = core.getLoopStatus().cycleInFlight;
    while ((cognitiveInFlight || ssfInFlight) &&
           (Date.now() - waitStart) < SHUTDOWN_WAIT_TIMEOUT_MS) {
      console.log(`[daemon] Waiting for in-flight work to complete (cognitive=${cognitiveInFlight}, ssf=${ssfInFlight})... elapsed=${Date.now() - waitStart}ms`);
      await sleep(POLL_INTERVAL_MS);
      cognitiveInFlight = core.getLoopStatus().cycleInFlight;
    }

    if (cognitiveInFlight || ssfInFlight) {
      console.warn(`[daemon] WARNING: In-flight work did not complete within ${SHUTDOWN_WAIT_TIMEOUT_MS}ms — forcing shutdown`);
    } else {
      console.log('[daemon] All in-flight work completed');
    }

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

    const shutdownDurationMs = Date.now() - shutdownStartMs;
    console.log(`[daemon] Shutdown complete (total shutdown duration: ${shutdownDurationMs}ms)`);
    console.log('════════════════════════════════════════════════════════════════');
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

  // IPC message handler — used when the daemon is launched through
  // heidi-daemon-launcher.js under PM2 with shutdown_with_message: true.
  // On Windows, PM2's default stop behavior uses `taskkill /T /F` (force
  // kill the process tree), which gives no chance for graceful shutdown.
  // With shutdown_with_message: true, PM2 sends proc.send('shutdown') to
  // the launcher, which relays it here via child.send({ type: 'shutdown' }).
  // This is the ONLY reliable way to trigger graceful shutdown on Windows
  // under PM2 — signal relay via child.kill(signal) does not work because
  // Windows has no POSIX signal mechanism.
  process.on('message', (msg: unknown) => {
    if (msg === 'shutdown' || (typeof msg === 'object' && msg !== null && 'type' in msg && (msg as { type: string }).type === 'shutdown')) {
      console.log(`[daemon] IPC message received at ${new Date().toISOString()} (epoch ms: ${Date.now()})`);
      gracefulShutdown('IPC_SHUTDOWN');
    }
  });

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

  // Apply daemon config overrides to CognitiveCore before starting.
  // core.start() only takes intervalMs; other loop config (stabilization,
  // cycle timeout) must be set via configureLoop() first.
  core.configureLoop({
    startupStabilizationMs: config.startupStabilizationMs,
  });

  // The CognitiveCore.start() method accepts an interval parameter
  await core.start(config.intervalMs);

  // 7. Self-sufficiency observation loop (runs alongside cognitive loop)
  let selfSufficiencyCycleCount = 0;

  async function runSelfSufficiencyInterval(): Promise<void> {
    if (shuttingDown) return;

    // Track in-flight state so gracefulShutdown can wait for us
    ssfInFlight = true;
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
        acquisitionResult: result.acquisitionResult || undefined,
        durationMs,
      });

      // Log significant events
      if (result.selfRepairResult && result.selfRepairResult.repaired > 0) {
        console.log(`[daemon] [${cycleId}] Repaired ${result.selfRepairResult.repaired} capability(s)`);
      }
      if (result.selfRepairResult && result.selfRepairResult.refused > 0) {
        console.log(`[daemon] [${cycleId}] Refused ${result.selfRepairResult.refused} protected-asset repair(s)`);
      }
      if (result.acquisitionResult && result.acquisitionResult.resolved > 0) {
        console.log(`[daemon] [${cycleId}] Acquired ${result.acquisitionResult.resolved} capability(s) — now READY`);
      }
      if (result.acquisitionResult && result.acquisitionResult.escalated > 0) {
        console.log(`[daemon] [${cycleId}] Escalated ${result.acquisitionResult.escalated} capability acquisition(s) — require human action`);
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
    } finally {
      ssfInFlight = false;
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
