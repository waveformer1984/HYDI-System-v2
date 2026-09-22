/**
 * SelfRepairR0 — the first bounded self-repair loop:
 *
 *   OBSERVE → RECONCILE → CLASSIFY → R0-eligible? → RECOVER → RECONCILE → VERIFY
 *
 * Exactly one recovery class is authorized:
 *
 *   daemon_unavailable  →  restart_daemon (pm2 restart hydi-daemon)
 *
 * Eligibility is proven from the reconciliation report, not from vibes:
 *   PM2 knows the app AND it is not online (or its tracked pid is dead)
 *   AND no singleton lock is held by a live process.
 *
 * Anything else is never recovered here:
 *   - lock held by a live process not descended from PM2 (stale orphan)
 *     → HUMAN_REQUIRED. We do not kill processes or steal locks.
 *   - unobservable state → HUMAN_REQUIRED.
 *   - healthy runtime, even with degraded application health → NO_ACTION.
 *
 * Success is never "restart returned 0" — only a post-recovery
 * reconciliation verdict of QUALIFIED produces VERIFIED.
 *
 * Single-flight: an atomic recovery lease (.heidi-recovery.lock, pid +
 * liveness, same pattern as the daemon lock) prevents concurrent attempts.
 * Cooldown: one attempt per failure class per window, enforced by reading
 * back persisted recovery_attempt rows — no restart storms.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import {
  collectReconciliation,
  type ReconcileDeps,
  type ReconciliationReport,
} from './DeploymentReconciliation';

// ─── The only authorized recovery actions ────────────────────────────────

export const R0_RECOVERY_ALLOWLIST = {
  daemon_unavailable: { action: 'restart_daemon' as const },
} as const;

export type R0FailureClass = keyof typeof R0_RECOVERY_ALLOWLIST;

export type RecoveryState =
  | 'DETECTED'         // initial state before classification
  | 'NO_ACTION'        // healthy or application-degraded only
  | 'ELIGIBLE'         // classified R0-recoverable (intermediate)
  | 'RECOVERY_STARTED'
  | 'RECOVERY_COMPLETED'
  | 'RECONCILING'
  | 'VERIFIED'         // post-recovery reconciliation QUALIFIED
  | 'FAILED'           // restart errored, timed out, or reconciliation failed
  | 'HUMAN_REQUIRED'   // stale owner, ambiguous state, non-R0 class
  | 'REFUSED'          // unknown class/action or concurrent attempt
  | 'COOLDOWN';        // same failure class attempted within window

export interface RecoveryFinding {
  failureClass: string;
  evidence?: unknown;
}

export interface RecoveryReport {
  recoveryId: string;
  state: RecoveryState;
  failureClass: string | null;
  action: string | null;
  attemptRowId: string | null;
  startedAt: string;
  completedAt: string | null;
  preRecovery: ReconciliationReport | null;
  postRecovery: ReconciliationReport | null;
  detail: string;
}

export interface RecoveryDeps extends ReconcileDeps {
  pool: Pick<Pool, 'query'>;
  /** Canonical restart mechanism. Default: `pm2 restart <appName>`. */
  restartDaemon?: () => { ok: boolean; error?: string };
  /** Reconcile injector (tests). Default: collectReconciliation. */
  reconcile?: () => Promise<ReconciliationReport>;
  recoveryLockFile?: string;
  /** Cooldown between attempts for the same failure class. Default 15 min. */
  cooldownMs?: number;
  /** Settle delay after restart before reconciling. Default 45s; tests: 0. */
  settleMs?: number;
}

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_SETTLE_MS = 45 * 1000;

// ─── Recovery lease (single-flight) ──────────────────────────────────────

function acquireRecoveryLease(file: string): { acquired: boolean; heldBy?: number } {
  const data = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  try {
    fs.writeFileSync(file, data, { flag: 'wx' });
    return { acquired: true };
  } catch {
    // exists — is the holder alive?
  }
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (info?.pid) {
      try {
        process.kill(info.pid, 0);
        return { acquired: false, heldBy: info.pid }; // live holder
      } catch {
        // holder dead — stale lease, take it over
      }
    }
    fs.unlinkSync(file);
    try {
      fs.writeFileSync(file, data, { flag: 'wx' });
      return { acquired: true };
    } catch {
      return { acquired: false };
    }
  } catch {
    return { acquired: false };
  }
}

function releaseRecoveryLease(file: string): void {
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (info?.pid === process.pid) fs.unlinkSync(file);
  } catch { /* best effort */ }
}

// ─── Classification ──────────────────────────────────────────────────────

/**
 * The ONLY R0-eligible condition: PM2 knows the daemon, it is not online
 * (or its tracked pid is dead), and no live process holds the singleton.
 * A live lock owner that is not a PM2 descendant is the orphan case —
 * detection only, human remediation. Never recoverable here.
 */
function classify(r: ReconciliationReport): { cls: R0FailureClass | null; reason: string } {
  if (r.verdict === 'QUALIFIED') {
    return { cls: null, reason: 'runtime already qualified' };
  }
  // Stale/orphan owner: a live lock holder that is not a PM2 descendant.
  if (r.actual.lockAlive === true) {
    return { cls: null, reason: 'singleton lock held by a live process — human remediation required' };
  }
  const pm2Known = r.expected.pm2Pid !== null || r.expected.pm2Status !== null;
  const pm2Down =
    (r.expected.pm2Status !== null && r.expected.pm2Status !== 'online') ||
    r.predicates.PROCESS_EXISTS === false;
  const lockFree = r.actual.lockPid === null || r.actual.lockAlive === false;
  if (pm2Known && pm2Down && lockFree) {
    return { cls: 'daemon_unavailable', reason: 'daemon absent and no live executor holds the singleton' };
  }
  if (r.expected.pm2Pid === null && r.expected.pm2Status === null) {
    return { cls: null, reason: 'PM2 has no record of the app — cannot drive canonical restart' };
  }
  return { cls: null, reason: 'ambiguous runtime state — not an R0-recoverable class' };
}

// ─── Main entry ──────────────────────────────────────────────────────────

export async function runR0Recovery(deps: RecoveryDeps): Promise<RecoveryReport> {
  const appName = deps.appName ?? 'hydi-daemon';
  const leaseFile = deps.recoveryLockFile ?? path.join(deps.repoDir, '.heidi-recovery.lock');
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const reconcile = deps.reconcile ?? (() => collectReconciliation(deps));
  const restart = deps.restartDaemon ?? (() => {
    try {
      execSync(`pm2 restart ${appName}`, { timeout: 30000, encoding: 'utf8' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'restart failed' };
    }
  });

  const report: RecoveryReport = {
    recoveryId: randomUUID(),
    state: 'DETECTED',
    failureClass: null,
    action: null,
    attemptRowId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    preRecovery: null,
    postRecovery: null,
    detail: '',
  };

  // Single-flight: refuse if another recovery attempt is in progress.
  const lease = acquireRecoveryLease(leaseFile);
  if (!lease.acquired) {
    report.state = 'REFUSED';
    report.detail = `recovery lease held by live pid ${lease.heldBy ?? 'unknown'} — concurrent attempt refused`;
    report.completedAt = new Date().toISOString();
    return report;
  }

  try {
    // ── OBSERVE + RECONCILE (pre) ──────────────────────────────────────
    const pre = await reconcile();
    report.preRecovery = pre;

    // ── CLASSIFY ───────────────────────────────────────────────────────
    const finding = classify(pre);
    if (!finding.cls) {
      // QUALIFIED → nothing to do (semantic WARNING stays NO_ACTION too —
      // runtime identity is valid). Anything else unrecovered → human.
      report.state = pre.verdict === 'QUALIFIED' ? 'NO_ACTION' : 'HUMAN_REQUIRED';
      report.detail = finding.reason;
      report.completedAt = new Date().toISOString();
      await persistAttempt(deps, report, null);
      return report;
    }
    report.failureClass = finding.cls;
    report.state = 'ELIGIBLE';

    const binding = R0_RECOVERY_ALLOWLIST[finding.cls];
    if (!binding) {
      // unreachable in practice — classify only emits allowlisted classes —
      // but the catalog is the authority, not the classifier.
      report.state = 'REFUSED';
      report.detail = `failure class ${finding.cls} not in R0 allowlist`;
      report.completedAt = new Date().toISOString();
      await persistAttempt(deps, report, null);
      return report;
    }
    report.action = binding.action;

    // ── Cooldown: one attempt per failure class per window ─────────────
    const lastAttempt = await lastAttemptAt(deps, finding.cls);
    if (lastAttempt !== null && Date.now() - lastAttempt < cooldownMs) {
      report.state = 'COOLDOWN';
      report.detail = `${finding.cls} attempted ${Math.round((Date.now() - lastAttempt) / 1000)}s ago`;
      report.completedAt = new Date().toISOString();
      await persistAttempt(deps, report, null);
      return report;
    }

    // ── RECOVER ────────────────────────────────────────────────────────
    // Evidence lands BEFORE the action — a crashed recovery still leaves
    // the attempt row proving what was started.
    report.state = 'RECOVERY_STARTED';
    await persistAttempt(deps, report, null);

    const res = restart();
    if (!res.ok) {
      report.state = 'FAILED';
      report.detail = `restart failed: ${res.error ?? 'unknown'}`;
      report.completedAt = new Date().toISOString();
      await persistAttempt(deps, report, null);
      return report;
    }
    report.state = 'RECOVERY_COMPLETED';

    // ── RECONCILE (post) ───────────────────────────────────────────────
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    report.state = 'RECONCILING';
    const post = await reconcile();
    report.postRecovery = post;

    if (post.verdict === 'QUALIFIED') {
      report.state = 'VERIFIED';
      report.detail = 'post-recovery reconciliation QUALIFIED';
    } else if (post.actual.lockAlive === true && post.predicates.PID_MATCHES === false) {
      // Restart produced a stale/foreign runtime owner — do not kill it.
      report.state = 'HUMAN_REQUIRED';
      report.detail = 'post-recovery runtime has a non-PM2 lock owner';
    } else {
      report.state = 'FAILED';
      report.detail = `post-recovery reconciliation: ${post.verdict} (${post.failures.join(', ') || 'unobservable predicates'})`;
    }

    report.completedAt = new Date().toISOString();
    await persistAttempt(deps, report, report.postRecovery);
    return report;
  } finally {
    releaseRecoveryLease(leaseFile);
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────

async function lastAttemptAt(deps: RecoveryDeps, failureClass: string): Promise<number | null> {
  try {
    const rows = await deps.pool.query(
      `SELECT created_at FROM heidi_events
       WHERE event_type = 'recovery_attempt'
         AND payload->>'failureClass' = $1
         AND payload->>'state' IN ('VERIFIED','FAILED','RECOVERY_STARTED','HUMAN_REQUIRED')
       ORDER BY created_at DESC LIMIT 1`,
      [failureClass],
    );
    const r = rows.rows[0];
    return r ? new Date(r.created_at).getTime() : null;
  } catch {
    return null; // unobservable history → no cooldown record; recovery still gated by eligibility
  }
}

async function persistAttempt(
  deps: RecoveryDeps,
  report: RecoveryReport,
  post: ReconciliationReport | null,
): Promise<string | null> {
  try {
    const verdict =
      report.state === 'VERIFIED' || report.state === 'NO_ACTION' || report.state === 'COOLDOWN' ? 'HEALTHY'
        : report.state === 'HUMAN_REQUIRED' || report.state === 'REFUSED' ? 'BLOCKED'
          : report.state === 'FAILED' ? 'FAILED'
            : 'UNKNOWN';
    const rows = await deps.pool.query(
      `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [
        'recovery_attempt',
        'heidi',
        JSON.stringify({
          recoveryId: report.recoveryId,
          failureClass: report.failureClass,
          action: report.action,
          state: report.state,
          startedAt: report.startedAt,
          completedAt: report.completedAt,
          detail: report.detail,
          preRecoveryRuntimeIdentity: report.preRecovery
            ? { expected: report.preRecovery.expected, actual: report.preRecovery.actual }
            : null,
          postRecoveryRuntimeIdentity: post
            ? { expected: post.expected, actual: post.actual, predicates: post.predicates }
            : null,
        }),
        verdict,
      ],
    );
    report.attemptRowId = rows.rows[0]?.id ?? null;
    return report.attemptRowId;
  } catch {
    return null;
  }
}
