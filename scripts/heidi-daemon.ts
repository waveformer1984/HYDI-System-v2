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
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { buildCognitiveCore } from '../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore, LoopStatus } from '../lib/heidi/CognitiveCore';
import { getGoalSystem } from '../lib/heidi/GoalSystem';
import { OperatorLeaseSupervisor } from '../lib/heidi/OperatorLease';
import { writeDaemonStatus } from '../lib/heidi/DaemonStatusSurface';
import type { PersistenceTruth } from '../lib/heidi/DaemonStatusSurface';
import {
  acquireHeidiDaemonLock,
  isProcessAlive,
  releaseHeidiDaemonLock,
} from './lib/heidi-daemon-lock';
import { releaseDaemonOwnership } from './lib/daemon-ownership';

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
const STATUS_ROOT = path.resolve(__dirname, '..');

/**
 * Persistence truth the snapshot reports. 'unknown' until the first probe
 * lands — a probe that never ran is not evidence either way.
 */
let persistenceTruth: PersistenceTruth = { pg: 'unknown', rest: 'unknown', checkedAt: '' };

/**
 * Probe the two persistence paths the daemon depends on, independently:
 * the PG pool target (DB_CONFIG — goals, missions, cycle evidence) and the
 * Supabase REST gateway (bridges — memory, action executor, checkpoints).
 * Both bounded at 4s; a probe failure is a verdict, never a thrown error.
 * 2026-10-12: both were dead for ~6h while PM2 showed green — this probe is
 * what turns that into a visible DEGRADED instead of silent failure.
 */
async function probePersistence(): Promise<PersistenceTruth> {
  const checkedAt = new Date().toISOString();
  let pg: PersistenceTruth['pg'] = 'down';
  try {
    const probe = new Pool({ ...DB_CONFIG, max: 1, connectionTimeoutMillis: 4000, statement_timeout: 4000 });
    try {
      await probe.query('select 1');
      pg = 'ok';
    } finally {
      await probe.end().catch(() => { });
    }
  } catch { /* down */ }

  let rest: PersistenceTruth['rest'] = 'down';
  const restUrl = process.env.SUPABASE_URL;
  if (restUrl) {
    try {
      // Any HTTP status — including 401/404 — proves Kong is reachable.
      await fetch(`${restUrl}/rest/v1/`, { signal: AbortSignal.timeout(4000) });
      rest = 'ok';
    } catch { /* down */ }
  } else {
    rest = 'unknown';
  }

  return { pg, rest, checkedAt };
}

let processProvenance: Record<string, unknown> | null = null;

function writeStatusSnapshot(status: LoopStatus): void {
  writeDaemonStatus(STATUS_ROOT, {
    pid: process.pid,
    state: status.state,
    cycleCount: status.cycleCount,
    lastCycleAt: status.lastCycleAt,
    lastSuccessfulCycleAt: status.lastSuccessfulCycleAt,
    lastCycleOutcome: status.lastCycleOutcome,
    consecutiveFailures: status.consecutiveFailures,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt,
    persistence: persistenceTruth,
    updatedAt: new Date().toISOString(),
    provenance: processProvenance as import('../lib/heidi/DaemonStatusSurface').RuntimeProvenanceStamp | null,
  });
}

interface DaemonConfig {
  intervalMs: number;
  startupStabilizationMs: number;
  once: boolean;
  // Skip the one-time initial self-sufficiency sweep at startup (probes +
  // self-repair + acquisition). The periodic interval still runs afterwards.
  // Intended for tests and cold environments where external-capability
  // resolution would stall startup — mirroring --no-stabilization.
  skipInitialSelfCheck: boolean;
}

function parseArgs(): DaemonConfig {
  const args = process.argv.slice(2);
  const config: DaemonConfig = {
    intervalMs: 60000,
    startupStabilizationMs: 120000,
    once: false,
    skipInitialSelfCheck: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--interval=')) {
      config.intervalMs = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--no-stabilization') {
      config.startupStabilizationMs = 0;
    } else if (arg === '--once') {
      config.once = true;
    } else if (arg === '--skip-self-check') {
      config.skipInitialSelfCheck = true;
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
 * If the lock exists, its PID must be alive and its command line must identify
 * a hydi-daemon process. Dead or unrelated PID owners are stale and reclaimed.
 * An unverifiable live PID fails closed rather than risking two daemons.
 */
/**
 * Resolve the commit this daemon was launched from by inspecting the
 * working tree — never an env var. Deployment reconciliation compares
 * this against qualified-deployment.json; an orphan running old code
 * will carry the OLD commit, making stale execution visible.
 */
function resolveRuntimeCommit(): string | null {
  try {
    const head = execSync('git rev-parse --short HEAD', {
      cwd: path.resolve(__dirname, '..'),
      timeout: 10000,
      encoding: 'utf8',
    }).trim();
    return head || null;
  } catch {
    return null;
  }
}

function acquireLock(): boolean {
  return acquireHeidiDaemonLock(LOCK_FILE, {
    cwd: process.cwd(),
    commit: resolveRuntimeCommit(),
  });
}

function releaseLock(): void {
  releaseHeidiDaemonLock(LOCK_FILE);
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
      // 0a. DYNAMIC CREDENTIAL DETECTION: Re-read .env.local to detect
      // credentials that the owner has added since daemon startup.
      // This allows credential provisioning without a daemon restart.
      // Only NEW keys are added — existing values are NOT overwritten.
      // Secret values are never logged, printed, or stored in audit.
      try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            // Only set if not already in process.env (don't override runtime changes)
            if (key && value && !process.env[key]) {
              process.env[key] = value;
            }
          }
        }
      } catch {
        // .env.local re-read is best effort — don't kill the daemon
      }

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

      // Refresh authorizations from the durable store so HEIDI notices
      // when the owner grants authorization without requiring a daemon restart
      engine.refreshAuthorizationsFromStore();

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
  const { recordProcessProvenance } = require('../lib/runtime/provenance') as {
    recordProcessProvenance: (name: string) => Promise<Record<string, unknown> | null>;
  };
  processProvenance = await recordProcessProvenance('hydi-daemon');

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
  process.once('exit', releaseLock);
  console.log(`[daemon] Lock acquired: ${LOCK_FILE}`);

  try {
    const { startBoardListener } = require('../lib/forge-board/listener') as {
      startBoardListener: (opts: { sender: string }) => { started: boolean };
    };
    startBoardListener({ sender: 'hydi-daemon' });
  } catch (error) {
    console.error(`[daemon] board listener skipped: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  // 1b. Shared Supabase client — wires the memory bridge (episodic
  //     experience storage with real row ids) and ActionExecutor in the
  //     cognitive core, and is reused below for delegated-operator
  //     persistence restore. Absent env vars leave those bridges unwired,
  //     which the core reports honestly rather than failing.
  let supabase: import('@supabase/supabase-js').SupabaseClient | undefined;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    } catch (err) {
      // Fail-soft: @supabase/realtime-js requires native WebSocket (Node 22+)
      // and its constructor throws on Node 20. Treat the same as missing
      // config — bridges stay unwired rather than crashing the daemon.
      console.warn(`[daemon] Supabase client init failed — memory/actionExecutor bridges unwired: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  } else {
    console.warn('[daemon] Supabase not configured — memory/actionExecutor bridges unwired');
  }

  // 2. Probe persistence truth before the loop starts. The daemon still
  // runs when persistence is down — its cycles degrade honestly — but the
  // verdict is now recorded on the status surface instead of buried in
  // cycle outcomes.
  persistenceTruth = await probePersistence();
  console.log(`[daemon] persistence pg=${persistenceTruth.pg} rest=${persistenceTruth.rest}`);

  // 3. Build production CognitiveCore with self-sufficiency wired
  console.log('[daemon] Building production CognitiveCore...');
  const core = await buildCognitiveCore({ dbConfig: DB_CONFIG, supabase });
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

  // Durable operator lease (heidi_operator_lease). The file lock guards
  // same-host exclusivity; this row is the DB-visible claim — which
  // instance owns the loop, heartbeating, expiring on schedule if it dies.
  // Refusal is logged loudly, not fatal: the file lock is still the
  // authoritative same-host guard and a refused daemon reporting itself
  // beats a daemon that silently vanished. The supervisor re-claims every
  // tick until it holds — a restart that races a predecessor's unexpired
  // lease self-heals instead of running leaseless forever.
  const leasePool = new Pool({ ...DB_CONFIG, max: 1 });
  const operatorLease = new OperatorLeaseSupervisor(leasePool, { ttlMs: 120_000 });
  await operatorLease.tick();
  const leaseInterval = setInterval(() => {
    if (shuttingDown) return;
    void operatorLease.tick();
  }, 30000);

  // 3. Set up graceful shutdown
  let shuttingDown = false;
  let ownershipReleased = false;
  async function releaseOwnership(): Promise<void> {
    if (ownershipReleased) return;
    ownershipReleased = true;
    clearInterval(leaseInterval);
    await releaseDaemonOwnership({
      releaseLease: () => operatorLease.release(),
      closeLeasePool: () => leasePool.end(),
      releaseLock: () => {
        releaseLock();
        console.log('[daemon] Lock released');
      },
    });
  }

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
  // PM2 sends shutdown directly to this process. The 31s in-flight ceiling
  // plus at most 3s of bounded lease/pool cleanup stays below kill_timeout.
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

    // Release the durable operator lease before the file lock — a successor's
    // claim should see a clean handoff. DB cleanup is bounded inside this call.
    await releaseOwnership();

    const shutdownDurationMs = Date.now() - shutdownStartMs;
    console.log(`[daemon] Shutdown complete (total shutdown duration: ${shutdownDurationMs}ms)`);
    console.log('════════════════════════════════════════════════════════════════');
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

  // IPC message handler — PM2 owns this process and sends directly to it
  // when shutdown_with_message is true.
  // On Windows, PM2's default stop behavior uses `taskkill /T /F` (force
  // kill the process tree), which gives no chance for graceful shutdown.
  // The direct IPC message is the reliable graceful-shutdown path on Windows.
  process.on('message', (msg: unknown) => {
    if (msg === 'shutdown' || (typeof msg === 'object' && msg !== null && 'type' in msg && (msg as { type: string }).type === 'shutdown')) {
      console.log(`[daemon] IPC message received at ${new Date().toISOString()} (epoch ms: ${Date.now()})`);
      gracefulShutdown('IPC_SHUTDOWN');
    }
    if (typeof msg === 'object' && msg !== null && 'type' in msg) {
      const m = msg as { type: string; reason?: string };
      if (m.type === 'kill_switch') {
        console.log(`[daemon] Kill switch activated via IPC: ${m.reason || 'manual'}`);
        core.activateKillSwitch(m.reason || 'IPC kill_switch');
      }
      if (m.type === 'kill_switch_off') {
        console.log('[daemon] Kill switch deactivated via IPC');
        core.deactivateKillSwitch();
      }
    }
  });

  // If the PM2 IPC channel closes, its ownership is gone too.
  process.on('disconnect', () => {
    console.log(`[daemon] PM2 IPC channel closed — shutting down at ${new Date().toISOString()}`);
    gracefulShutdown('IPC_DISCONNECT');
  });

  // Belt-and-suspenders guard for a vanished PM2 supervisor.
  const supervisorPid = process.ppid;
  if (supervisorPid > 1) {
    const parentCheck = setInterval(() => {
      if (shuttingDown) { clearInterval(parentCheck); return; }
      if (!isProcessAlive(supervisorPid)) {
        console.error(`[daemon] Supervisor (pid ${supervisorPid}) is gone — shutting down at ${new Date().toISOString()}`);
        gracefulShutdown('PARENT_GONE');
        clearInterval(parentCheck);
      }
    }, Math.max(30000, config.intervalMs));
    parentCheck.unref();
  }

  // 4. Run initial self-sufficiency observation
  let initialResult: Awaited<ReturnType<typeof runSelfSufficiencyCycle>>;
  if (config.skipInitialSelfCheck) {
    console.log('[daemon] Skipping initial capability health check (--skip-self-check)');
    initialResult = { capabilityHealth: null, selfRepairResult: null, credentialWatchResult: null, acquisitionResult: null };
  } else {
    console.log('[daemon] Running initial capability health check...');
    initialResult = await runSelfSufficiencyCycle(core);
  }
  if (initialResult.capabilityHealth) {
    console.log(`[daemon] Capabilities: ${initialResult.capabilityHealth.total} total, ${initialResult.capabilityHealth.ready} READY, ${initialResult.capabilityHealth.blocked} BLOCKED, ${initialResult.capabilityHealth.unavailable} UNAVAILABLE`);
  }
  if (initialResult.selfRepairResult) {
    const r = initialResult.selfRepairResult;
    console.log(`[daemon] Self-repair: ${r.totalIssues} issues, ${r.repaired} repaired, ${r.workedAround} worked around, ${r.escalated} escalated, ${r.refused} refused`);
  }

  // 4b. Delegated operator recovery — restore interventions and checkpoints
  //     from Supabase persistence so they survive daemon restart.
  try {
    const { initializePersistence, restoreFromPersistence } = await import('../lib/delegated-operator');
    if (supabase) {
      initializePersistence(supabase);
      const restored = await restoreFromPersistence();
      if (restored.interventionsRestored > 0) {
        console.log(`[daemon] Restored ${restored.interventionsRestored} pending intervention(s) from Supabase`);
      } else {
        console.log('[daemon] No pending interventions to restore');
      }
    } else {
      console.log('[daemon] Supabase not configured — intervention persistence disabled');
    }
  } catch (err) {
    console.warn(`[daemon] Delegated operator recovery skipped: ${err instanceof Error ? err.message : 'unknown'}`);
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
    await releaseOwnership();
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
  let lastEscalationSignature: string | null = null;

  async function runSelfSufficiencyInterval(): Promise<void> {
    if (shuttingDown) return;

    // Kill switch check: if the cognitive core's kill switch is active,
    // do not perform autonomous self-sufficiency actions (repair, acquisition).
    // The daemon continues to observe and report status, but does not
    // execute any autonomous actions that could modify the system.
    const loopStatus = core.getLoopStatus();
    if (loopStatus.killSwitchActive) {
      // Log periodically but don't act
      if (selfSufficiencyCycleCount % 10 === 0) {
        console.log(`[daemon] Kill switch active — self-sufficiency actions suspended (cycle ${selfSufficiencyCycleCount})`);
      }
      selfSufficiencyCycleCount++;
      return;
    }

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

      // Log significant events. Escalation lines are deduped by
      // signature — a still-blocked capability escalates every cycle
      // (was: 4 identical lines/minute forever); log the first time and
      // whenever the escalated set changes, then stay quiet.
      if (result.selfRepairResult && result.selfRepairResult.repaired > 0) {
        console.log(`[daemon] [${cycleId}] Repaired ${result.selfRepairResult.repaired} capability(s)`);
      }
      if (result.selfRepairResult && result.selfRepairResult.refused > 0) {
        console.log(`[daemon] [${cycleId}] Refused ${result.selfRepairResult.refused} protected-asset repair(s)`);
      }
      if (result.acquisitionResult && result.acquisitionResult.resolved > 0) {
        console.log(`[daemon] [${cycleId}] Acquired ${result.acquisitionResult.resolved} capability(s) — now READY`);
      }

      const escalatedCaps = Object.entries(result.acquisitionResult?.states ?? {})
        .filter(([, s]) => s === 'POLICY_BLOCKED' || s === 'BLOCKED')
        .map(([id]) => id)
        .sort()
        .join(',');
      const acqEscalated = result.acquisitionResult?.escalated ?? 0;
      const repairEscalated = result.selfRepairResult?.escalated ?? 0;
      const escalationSignature = `${acqEscalated}|${repairEscalated}|${escalatedCaps}`;
      if (escalationSignature !== lastEscalationSignature) {
        if (acqEscalated > 0) {
          console.log(`[daemon] [${cycleId}] Escalated ${acqEscalated} capability acquisition(s) — require human action: ${escalatedCaps}`);
        }
        if (repairEscalated > 0) {
          console.log(`[daemon] [${cycleId}] Escalated ${repairEscalated} blocker(s) to human`);
        }
        if (acqEscalated === 0 && repairEscalated === 0 && lastEscalationSignature !== null) {
          console.log(`[daemon] [${cycleId}] All previous escalations cleared`);
        }
        lastEscalationSignature = escalationSignature;
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

  // Stale-mission sweep — bounded, idempotent, worker-verified. Reclaims
  // expired claims whose recorded worker is confirmed dead; never
  // replays capability work. Runs on the daemon cadence.
  const sweepInterval = setInterval(() => {
    if (shuttingDown) return;
    core.sweepStaleMissions().catch(() => { });
  }, config.intervalMs);

  // Human Action Resolution cadence — the standing 'resolver' agent's
  // sweep (detect → classify → resolver-or-human-path → verify → resume).
  // Bounded interval (HYDI_RESOLVER_SWEEP_MS, default 60s), in-flight
  // guard prevents overlap in this process; the hourly coordinator
  // mission + advisory-lock claim dedupe concurrent invocations across
  // restarts/processes. The sweep reports via the daemon log; failures
  // are recorded in durable sweep/attempt evidence, never thrown.
  const resolverPool = new Pool({ ...DB_CONFIG, max: 1 });
  const resolverGoals = getGoalSystem(DB_CONFIG); // parked goals can only resume if the sweep sees them
  const RESOLVER_SWEEP_MS = Math.max(15000, parseInt(process.env.HYDI_RESOLVER_SWEEP_MS || '60000', 10) || 60000);
  let resolverInFlight = false;
  const runResolverSweep = () => {
    if (shuttingDown || resolverInFlight) return;
    resolverInFlight = true;
    import('../lib/human-actions/resolver-agent.js')
      .then((m) => {
        const run = (m as { runHumanActionResolverAgent?: Function; default?: { runHumanActionResolverAgent?: Function } }).runHumanActionResolverAgent
          ?? (m as { default?: { runHumanActionResolverAgent?: Function } }).default?.runHumanActionResolverAgent;
        if (!run) throw new Error('resolver-agent export missing');
        return run({ pool: resolverPool, goals: resolverGoals, leaseHeld: () => operatorLease.held });
      })
      .then((r) => {
        const s = r?.summary;
        console.log(`[daemon] resolver-sweep via=${r?.via} mission=${r?.missionId ?? 'none'} open=${s?.detected ? s.detected.requested + s.detected.alreadyOpen : '?'} human=${s?.resolve?.human ?? '?'} attempted=${s?.resolve?.attempted ?? '?'} resolved=${s?.verify?.resolved ?? '?'} resumed=${s?.resumed ?? '?'} mirror=${s?.mirror ? `${s.mirror.synced}ok/${s.mirror.failed}err${s.mirror.error ? ' ' + s.mirror.error : ''}` : 'off'} stale=${s?.staleBaseUrl ? s.staleBaseUrl.stale : 'n/a'}`);
      })
      .catch(() => { })
      .finally(() => { resolverInFlight = false; });
  };
  const resolverInterval = setInterval(runResolverSweep, RESOLVER_SWEEP_MS);
  const resolverKick = setTimeout(runResolverSweep, 15000); // first pass after startup settles

  // 8. Status reporting — console line for the log, snapshot file for the
  // health surface. The probe re-runs each tick so a restored (or newly
  // dead) persistence layer changes the verdict within one interval.
  let statusProbeInFlight = false;
  const statusInterval = setInterval(() => {
    if (shuttingDown || statusProbeInFlight) return;
    statusProbeInFlight = true;
    const status = core.getLoopStatus();
    const memUsage = process.memoryUsage();
    console.log(`[daemon] state=${status.state} cycles=${status.cycleCount} failures=${status.consecutiveFailures} outcome=${status.lastCycleOutcome || 'none'} mem=${Math.round(memUsage.rss / 1024 / 1024)}MB kill=${status.killSwitchActive}${status.lastError ? ' lastError=' + status.lastError : ''}${status.lastErrorAt ? ' lastErrorAt=' + status.lastErrorAt : ''}`);
    probePersistence()
      .then((truth) => {
        const changed = truth.pg !== persistenceTruth.pg || truth.rest !== persistenceTruth.rest;
        persistenceTruth = truth;
        if (changed) console.log(`[daemon] persistence changed: pg=${truth.pg} rest=${truth.rest}`);
      })
      .catch(() => { /* probe is fail-soft; keep last known truth */ })
      .finally(() => {
        writeStatusSnapshot(core.getLoopStatus());
        statusProbeInFlight = false;
      });
  }, 30000);

  // 9. Wait for shutdown
  console.log('[daemon] Daemon is running. Press Ctrl+C to stop.');
  console.log('');
  writeStatusSnapshot(core.getLoopStatus());

  // Keep the process alive
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (shuttingDown) {
        clearInterval(checkInterval);
        clearInterval(ssfInterval);
        clearInterval(sweepInterval);
        clearInterval(resolverInterval);
        clearTimeout(resolverKick);
        resolverPool.end().catch(() => { });
        clearInterval(leaseInterval);
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
