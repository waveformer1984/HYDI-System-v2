/**
 * DeploymentReconciliation — proves or disproves that the deployment PM2
 * believes is running is the same process actually executing HYDI cycles.
 *
 * Motivating incident (2026-09-21): `pm2 restart hydi-daemon` killed the
 * launcher but the fork'd tsx daemon child survived as an orphan holding
 * .heidi-daemon.lock. Every respawn exited on the lock, PM2 sat in
 * waiting-restart, and the OLD code kept writing cycles — PM2 "online"
 * and actual execution had silently diverged.
 *
 * The reconciler is verification-first and observational only: it never
 * kills processes, never steals locks, never writes qualified-deployment.
 * A failed predicate produces DEPLOYMENT_DRIFT (or UNKNOWN when a
 * predicate cannot be observed at all); both refuse qualification.
 *
 * Identity sources, weakest to strongest:
 *   PM2 jlist        — what PM2 believes is running (untrusted alone)
 *   .heidi-daemon.lock — who owns the singleton lease (pid + commit + cwd)
 *   latest cognitive_cycle.runtimeIdentity — durable proof written by the
 *     process that actually executed a cycle
 *   qualified-deployment.json — the expected commit baseline
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Pool } from 'pg';

export interface Pm2Proc {
  pid: number;
  name: string;
  status: string;
  cwd: string | null;
  restarts: number;
}

export interface RuntimeIdentity {
  pid: number;
  commit: string | null;
  cwd?: string;
}

export interface ReconcileDeps {
  pool: Pick<Pool, 'query'>;
  /** Canonical repo root the daemon must be running from. */
  repoDir: string;
  pm2List?: () => Promise<Pm2Proc[]>;
  parentPid?: (pid: number) => number | null;
  lockFile?: string;
  qualifiedFile?: string;
  /** Daemon app name in PM2. Default 'hydi-daemon'. */
  appName?: string;
  /** Max age of the live-cycle proof in ms. Default 5 minutes. */
  maxCycleAgeMs?: number;
  /**
   * Expected commit override. Default: qualified-deployment.json's
   * deployedHead (drift detection). The qualification gate passes the
   * canonical tree's git HEAD instead — the file it writes can't be
   * its own baseline.
   */
  expectedCommit?: string;
  now?: () => number;
}

export interface ReconciliationReport {
  verdict: 'QUALIFIED' | 'DEPLOYMENT_DRIFT' | 'UNKNOWN';
  deploymentIdentity: 'VALID' | 'INVALID' | 'UNPROVEN';
  applicationHealth: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  predicates: Record<string, boolean | null>;
  failures: string[];
  expected: {
    commit: string | null;
    pm2Pid: number | null;
    pm2Status: string | null;
    pm2Cwd: string | null;
    pm2Restarts: number | null;
  };
  actual: {
    lockPid: number | null;
    lockCommit: string | null;
    lockCwd: string | null;
    lockStartedAt: string | null;
    cyclePid: number | null;
    cycleCommit: string | null;
    cycleAt: string | null;
  };
}

// ─── Default OS-backed providers ─────────────────────────────────────────

function defaultPm2List(): Promise<Pm2Proc[]> {
  const out = execSync('pm2 jlist', { timeout: 30000, encoding: 'utf8' });
  const list = JSON.parse(out) as Array<{
    name: string; pid: number;
    pm2_env?: { status?: string; pm_cwd?: string; restart_time?: number };
  }>;
  return Promise.resolve(list.map((p) => ({
    pid: p.pid,
    name: p.name,
    status: p.pm2_env?.status ?? 'unknown',
    cwd: p.pm2_env?.pm_cwd ?? null,
    restarts: p.pm2_env?.restart_time ?? 0,
  })));
}

function defaultParentPid(pid: number): number | null {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`,
      { timeout: 15000, encoding: 'utf8' },
    ).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is `ancestorPid` in the parent chain of `pid`? On Windows the daemon is
 * several generations below the PM2-tracked process:
 *   pm2 pid (ProcessContainerFork) → tsx cli → daemon (lock owner)
 * so a direct equality check is wrong; walk ancestors, bounded hops.
 */
function isDescendantOf(
  pid: number,
  ancestorPid: number,
  parentPid: (p: number) => number | null,
  maxHops = 8,
): boolean {
  let cur: number | null = pid;
  for (let i = 0; i < maxHops; i++) {
    cur = cur === null ? null : parentPid(cur);
    if (cur === null) return false;
    if (cur === ancestorPid) return true;
  }
  return false;
}

function normDir(p: string | null): string | null {
  if (!p) return null;
  try {
    return fs.realpathSync(path.resolve(p)).toLowerCase();
  } catch {
    return path.resolve(p).toLowerCase();
  }
}

/**
 * Resolve the current HEAD commit of a working tree by inspecting the
 * repo itself — never an env var, never PM2 metadata.
 */
export function resolveGitHead(repoDir: string): string | null {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoDir, timeout: 10000, encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

// ─── Reconciliation ──────────────────────────────────────────────────────

export async function collectReconciliation(deps: ReconcileDeps): Promise<ReconciliationReport> {
  const appName = deps.appName ?? 'hydi-daemon';
  const lockFile = deps.lockFile ?? path.join(deps.repoDir, '.heidi-daemon.lock');
  const qualifiedFile = deps.qualifiedFile ?? path.join(deps.repoDir, '.hydi-operational', 'qualified-deployment.json');
  const pm2List = deps.pm2List ?? defaultPm2List;
  const parentPid = deps.parentPid ?? defaultParentPid;
  const now = deps.now ?? (() => Date.now());
  const maxCycleAge = deps.maxCycleAgeMs ?? 5 * 60 * 1000;

  const report: ReconciliationReport = {
    verdict: 'UNKNOWN',
    deploymentIdentity: 'UNPROVEN',
    applicationHealth: 'UNKNOWN',
    predicates: {},
    failures: [],
    expected: { commit: null, pm2Pid: null, pm2Status: null, pm2Cwd: null, pm2Restarts: null },
    actual: { lockPid: null, lockCommit: null, lockCwd: null, lockStartedAt: null, cyclePid: null, cycleCommit: null, cycleAt: null },
  };
  const P = report.predicates;

  // ── Expected deployment baseline ───────────────────────────────────────
  if (deps.expectedCommit) {
    report.expected.commit = deps.expectedCommit;
  } else {
    try {
      const q = JSON.parse(fs.readFileSync(qualifiedFile, 'utf8')) as { deployedHead?: string };
      report.expected.commit = q.deployedHead ?? null;
    } catch {
      report.expected.commit = null;
    }
  }

  // ── PM2 belief ─────────────────────────────────────────────────────────
  let pm2Proc: Pm2Proc | null = null;
  try {
    pm2Proc = (await pm2List()).find((p) => p.name === appName) ?? null;
  } catch {
    pm2Proc = null;
  }
  if (pm2Proc) {
    report.expected.pm2Pid = pm2Proc.pid;
    report.expected.pm2Status = pm2Proc.status;
    report.expected.pm2Cwd = pm2Proc.cwd;
    report.expected.pm2Restarts = pm2Proc.restarts;
  }
  P.PM2_EXPECTED = pm2Proc !== null && pm2Proc.status === 'online';

  // ── Singleton lock ─────────────────────────────────────────────────────
  let lock: { pid?: number; commit?: string; cwd?: string; startedAt?: string } | null = null;
  try {
    if (fs.existsSync(lockFile)) {
      lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    }
  } catch {
    lock = null; // corrupt lock is unobservable, not healthy
  }
  if (lock) {
    report.actual.lockPid = lock.pid ?? null;
    report.actual.lockCommit = lock.commit ?? null;
    report.actual.lockCwd = lock.cwd ?? null;
    report.actual.lockStartedAt = lock.startedAt ?? null;
  }

  // ── Live execution proof: the latest cycle's runtime identity ──────────
  let cycle: { pid: number | null; commit: string | null; createdAt: string | null } =
    { pid: null, commit: null, createdAt: null };
  try {
    const rows = await deps.pool.query(
      `SELECT created_at, payload->'runtimeIdentity'->>'pid' AS pid,
              payload->'runtimeIdentity'->>'commit' AS commit
       FROM heidi_events
       WHERE event_type = 'cognitive_cycle'
         AND payload ? 'runtimeIdentity'
       ORDER BY created_at DESC LIMIT 1`,
    );
    const r = rows.rows[0];
    if (r) {
      cycle = {
        pid: r.pid !== null && r.pid !== undefined ? parseInt(r.pid, 10) : null,
        commit: r.commit ?? null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      };
    }
  } catch {
    cycle = { pid: null, commit: null, createdAt: null }; // table unreadable
  }
  report.actual.cyclePid = cycle.pid;
  report.actual.cycleCommit = cycle.commit;
  report.actual.cycleAt = cycle.createdAt;

  // ── Predicates ─────────────────────────────────────────────────────────
  const pm2Alive = pm2Proc ? processAlive(pm2Proc.pid) : false;
  const lockAlive = lock?.pid ? processAlive(lock.pid) : false;
  P.PROCESS_EXISTS = pm2Proc === null || lock === null ? null : pm2Alive && lockAlive;

  // PM2's pid is an ANCESTOR of the daemon (fork chain), not the daemon
  // itself. A stale orphan's parent chain leads to a dead process, not PM2.
  P.PID_MATCHES =
    pm2Proc === null || lock?.pid == null ? null
      : lock.pid === pm2Proc.pid || isDescendantOf(lock.pid, pm2Proc.pid, parentPid);

  const canonical = normDir(deps.repoDir);
  P.CWD_CANONICAL =
    pm2Proc === null ? null
      : normDir(pm2Proc.cwd) === canonical &&
      (lock?.cwd == null || normDir(lock.cwd) === canonical);

  P.SINGLETON_OWNER_MATCHES =
    lock === null ? null
      : lockAlive && P.PID_MATCHES === true;

  P.COMMIT_MATCHES_EXPECTED =
    report.expected.commit === null || !lock?.commit || !cycle.commit ? null
      : lock.commit === report.expected.commit && cycle.commit === report.expected.commit;

  // The proof that distinguishes "PM2 online" from "actually executing":
  // a fresh cycle row must carry the identity of the process holding the
  // lock, at the expected commit.
  const cycleFresh = cycle.createdAt !== null && now() - new Date(cycle.createdAt).getTime() < maxCycleAge;
  P.LIVE_RUNTIME_IDENTITY_MATCHES =
    report.expected.commit === null || lock?.pid == null
      ? null
      : cycleFresh &&
      cycle.pid === lock.pid &&
      cycle.commit === report.expected.commit;

  // Application health is a SEPARATE dimension: a degraded system dashboard
  // (e.g. human-owned escalation backlog) does not invalidate deployment
  // identity, and a healthy dashboard cannot rescue a stale runtime.
  try {
    const h = await deps.pool.query(`SELECT current_status FROM system_dashboard LIMIT 1`);
    const s = h.rows[0]?.current_status as string | undefined;
    report.applicationHealth =
      s === 'OK' ? 'HEALTHY'
        : s === 'WARNING' || s === 'CRITICAL' ? 'DEGRADED'
          : 'UNKNOWN';
  } catch {
    report.applicationHealth = 'UNKNOWN';
  }

  // ── Verdict ────────────────────────────────────────────────────────────
  const identityKeys = [
    'PM2_EXPECTED', 'PROCESS_EXISTS', 'PID_MATCHES', 'CWD_CANONICAL',
    'SINGLETON_OWNER_MATCHES', 'COMMIT_MATCHES_EXPECTED', 'LIVE_RUNTIME_IDENTITY_MATCHES',
  ];
  for (const k of identityKeys) {
    if (P[k] === false) report.failures.push(k);
  }
  const anyFalse = report.failures.length > 0;
  const anyNull = identityKeys.some((k) => P[k] === null);

  if (anyFalse) {
    report.verdict = 'DEPLOYMENT_DRIFT';
    report.deploymentIdentity = 'INVALID';
  } else if (anyNull) {
    report.verdict = 'UNKNOWN';
    report.deploymentIdentity = 'UNPROVEN';
  } else {
    report.verdict = 'QUALIFIED';
    report.deploymentIdentity = 'VALID';
  }
  return report;
}
