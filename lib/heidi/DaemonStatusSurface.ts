/**
 * DAEMON STATUS SURFACE
 *
 * The daemon's truth channel to anything that is NOT the daemon. It exists
 * because of a measured failure (2026-10-12): Supabase's host port bindings
 * died while every PM2 process stayed "online". PM2 liveness said green for
 * ~6 hours while every cognitive cycle returned RECOVERABLE_FAILURE — the
 * only honest signals were buried in the daemon's own log. Nothing an
 * operator (or /api/health, or heidi-health) could read said so.
 *
 * Contract: the daemon writes a small JSON snapshot — loop status plus the
 * last persistence probe verdict — to `.heidi-daemon-status.json` at the
 * repo root on its status cadence (~30s) and once at startup. Health
 * surfaces read the file and judge; they never trust PID liveness alone.
 *
 * Why a file and not a table: the surface exists precisely for the moment
 * the database is unreachable. A verdict stored in the dead store would be
 * the same false green this file replaces.
 */

import * as fs from 'fs';
import * as path from 'path';

export const DAEMON_STATUS_FILE = '.heidi-daemon-status.json';

/**
 * A snapshot older than this cannot represent a 60s-cadence loop. Three
 * status ticks (~90s of writes) plus jitter — the same order of magnitude
 * heidi-health already uses for audit-file activity (120s), rounded up so
 * one skipped write doesn't flap the verdict.
 */
export const DAEMON_STATUS_STALE_MS = 180000;

export type PersistenceVerdict = 'ok' | 'down' | 'unknown';

export interface PersistenceTruth {
  /** Direct Postgres reachability (the daemon's PG pool target). */
  pg: PersistenceVerdict;
  /** Supabase REST gateway reachability (Kong). */
  rest: PersistenceVerdict;
  /** When the probe last ran. */
  checkedAt: string;
}

/** Code identity captured at process start. Absent on snapshots from older daemons. */
export interface RuntimeProvenanceStamp {
  name: string;
  pid: number;
  gitSha: string | null;
  gitDirty: boolean | null;
  branch: string | null;
  startedAt: string;
  node: string;
  cwd: string;
  source?: string;
}

export interface DaemonStatusSnapshot {
  pid: number;
  state: string;
  cycleCount: number;
  lastCycleAt: string | null;
  lastSuccessfulCycleAt: string | null;
  lastCycleOutcome: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  persistence: PersistenceTruth;
  updatedAt: string;
  provenance?: RuntimeProvenanceStamp | null;
}

export type DaemonVerdictState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'STALE'
  | 'NOT_RUNNING'
  | 'CORRUPT';

export interface DaemonHealthVerdict {
  healthy: boolean;
  state: DaemonVerdictState;
  reasons: string[];
  details: {
    pid?: number;
    state?: string;
    cycleCount?: number;
    lastCycleAt?: string | null;
    lastCycleOutcome?: string | null;
    consecutiveFailures?: number;
    lastError?: string | null;
    lastErrorAt?: string | null;
    persistence?: PersistenceTruth;
    updatedAt?: string;
    ageMs?: number;
    provenance?: RuntimeProvenanceStamp | null;
  };
}

export function statusPath(root: string): string {
  return path.join(root, DAEMON_STATUS_FILE);
}

/**
 * Atomic write via tmp+rename — a reader never sees a torn snapshot.
 * Never throws: a health-surface write must not kill the thing it monitors.
 * Returns an error string on failure, null on success.
 */
export function writeDaemonStatus(root: string, snapshot: DaemonStatusSnapshot): string | null {
  try {
    const target = statusPath(root);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, target);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'status write failed';
  }
}

/**
 * Read the snapshot. Returns null for missing OR corrupt — callers that
 * need to distinguish use assessDaemonHealth, which reports CORRUPT.
 */
export function readDaemonStatus(root: string): DaemonStatusSnapshot | null {
  try {
    const raw = fs.readFileSync(statusPath(root), 'utf8');
    return JSON.parse(raw) as DaemonStatusSnapshot;
  } catch {
    return null;
  }
}

/**
 * Judge the snapshot. Reads only the file — no daemon, no DB — so the
 * verdict is still available when both are dead. `now` is injectable for
 * tests; `staleAfterMs` defaults to DAEMON_STATUS_STALE_MS.
 *
 * Verdict precedence: absence → corruption → staleness → failure evidence
 * → healthy. Staleness outranks a recorded SUCCESS because an old SUCCESS
 * proves nothing about now.
 */
export function assessDaemonHealth(
  root: string,
  opts: { now?: number; staleAfterMs?: number } = {},
): DaemonHealthVerdict {
  const now = opts.now ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? DAEMON_STATUS_STALE_MS;
  const file = statusPath(root);

  if (!fs.existsSync(file)) {
    return { healthy: false, state: 'NOT_RUNNING', reasons: ['no daemon status file — daemon has not reported'], details: {} };
  }

  let snapshot: DaemonStatusSnapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as DaemonStatusSnapshot;
  } catch (e) {
    return {
      healthy: false,
      state: 'CORRUPT',
      reasons: [`daemon status file unreadable: ${e instanceof Error ? e.message : 'parse error'}`],
      details: {},
    };
  }

  const updatedAtMs = Date.parse(snapshot.updatedAt);
  const ageMs = Number.isFinite(updatedAtMs) ? now - updatedAtMs : Infinity;
  const details: DaemonHealthVerdict['details'] = {
    pid: snapshot.pid,
    state: snapshot.state,
    cycleCount: snapshot.cycleCount,
    lastCycleAt: snapshot.lastCycleAt,
    lastCycleOutcome: snapshot.lastCycleOutcome,
    consecutiveFailures: snapshot.consecutiveFailures,
    lastError: snapshot.lastError,
    lastErrorAt: snapshot.lastErrorAt,
    persistence: snapshot.persistence,
    updatedAt: snapshot.updatedAt,
    ageMs: Number.isFinite(ageMs) ? ageMs : undefined,
  };
  if (snapshot.provenance !== undefined) details.provenance = snapshot.provenance;

  if (!Number.isFinite(updatedAtMs) || ageMs > staleAfterMs) {
    return {
      healthy: false,
      state: 'STALE',
      reasons: [`daemon status is ${Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s` : 'unparseably'} old (limit ${Math.round(staleAfterMs / 1000)}s)`],
      details,
    };
  }

  const reasons: string[] = [];
  if (snapshot.lastCycleOutcome === 'RECOVERABLE_FAILURE' || snapshot.lastCycleOutcome === 'HARD_FAILURE') {
    reasons.push(`last cycle outcome ${snapshot.lastCycleOutcome}${snapshot.lastError ? ` (${snapshot.lastError})` : ''}`);
  }
  if (snapshot.consecutiveFailures > 0) {
    reasons.push(`${snapshot.consecutiveFailures} consecutive loop failure(s)`);
  }
  if (snapshot.state === 'failed' || snapshot.state === 'stopped') {
    reasons.push(`loop state is '${snapshot.state}'`);
  }
  if (snapshot.persistence) {
    if (snapshot.persistence.pg === 'down') reasons.push('persistence: postgres unreachable at last probe');
    if (snapshot.persistence.rest === 'down') reasons.push('persistence: supabase REST unreachable at last probe');
  }

  if (reasons.length > 0) {
    return { healthy: false, state: 'DEGRADED', reasons, details };
  }
  return { healthy: true, state: 'HEALTHY', reasons: [], details };
}
