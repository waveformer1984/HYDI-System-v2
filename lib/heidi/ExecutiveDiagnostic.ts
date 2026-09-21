/**
 * HEIDI Executive Diagnostic — the self-observation collector behind
 * `ops.executive_diagnostic`.
 *
 * One pass gathers the dimensions a healthy autonomous runtime must know
 * about itself — loop liveness, goal staleness, mission cadence, memory
 * recency, authorization backlog, escalation signal, deployment drift, and
 * capability posture — and classifies each as
 * HEALTHY / DEGRADED / BLOCKED / FAILED / UNKNOWN.
 *
 * Two rules are load-bearing:
 *   - UNKNOWN never collapses into HEALTHY. If a dimension could not be
 *     observed, the report says so; `overallStatus` ranks UNKNOWN above
 *     HEALTHY so an unobservable subsystem can never be reported as fine.
 *   - Everything here is a READ of durable state plus one git invocation.
 *     The only write is the caller's heidi_events insert — the diagnostic
 *     does not repair, restart, or suppress anything.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type DiagnosticStatus = 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'FAILED' | 'UNKNOWN';

export interface DiagnosticDimension {
  name: string;
  status: DiagnosticStatus;
  detail: string;
  metrics?: Record<string, unknown>;
}

export interface ExecutiveDiagnosticReport {
  generatedAt: string;
  overall: DiagnosticStatus;
  dimensions: DiagnosticDimension[];
}

/** Structural deps — the daemon passes the live pool/registry; tests pass fakes. */
export interface ExecutiveDiagnosticDeps {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
  goals?: {
    getPendingWork: () => Promise<
      Array<{ status: string; title?: string; updatedAt: string; createdAt: string; context?: Record<string, unknown> }>
    >;
  } | null;
  registry?: { getSummary: () => { total: number; available: number; unavailable: number } } | null;
  /** Repo root for drift detection. Defaults to process.cwd(). */
  repoDir?: string;
  /** Qualified-deployment evidence file (autonomy-live.json). */
  deploymentEvidencePath?: string;
  /** Owner-authorization journal. */
  ownerAuthJournalPath?: string;
  /** Test seam: supply git identity instead of spawning `git`. */
  gitInfo?: () => { head: string; branch: string } | null;
  /** Test seam: supply the qualified-deployment baseline in memory. */
  expectedDeployment?: { deployedHead?: string; branch?: string } | null;
  now?: () => number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const SEVERITY: Record<DiagnosticStatus, number> = {
  FAILED: 4,
  BLOCKED: 3,
  DEGRADED: 2,
  UNKNOWN: 1,
  HEALTHY: 0,
};

/**
 * Worst-of rollup. UNKNOWN outranks HEALTHY by construction: an
 * unobservable dimension is reported, never silently upgraded.
 */
export function overallStatus(dimensions: DiagnosticDimension[]): DiagnosticStatus {
  if (dimensions.length === 0) return 'UNKNOWN';
  let worst: DiagnosticStatus = 'HEALTHY';
  for (const d of dimensions) {
    if (SEVERITY[d.status] > SEVERITY[worst]) worst = d.status;
  }
  return worst;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? now - t : null;
}

async function safeQuery(
  deps: ExecutiveDiagnosticDeps,
  sql: string,
  params?: unknown[],
): Promise<Array<Record<string, unknown>> | null> {
  try {
    return (await deps.pool.query(sql, params)).rows;
  } catch {
    return null;
  }
}

async function databaseDimension(deps: ExecutiveDiagnosticDeps): Promise<DiagnosticDimension> {
  const rows = await safeQuery(deps, 'SELECT 1 AS ok');
  if (rows === null) {
    return { name: 'database', status: 'FAILED', detail: 'pool query failed' };
  }
  return { name: 'database', status: 'HEALTHY', detail: 'pool responsive' };
}

async function cognitiveLoopDimension(
  deps: ExecutiveDiagnosticDeps,
  now: number,
): Promise<DiagnosticDimension> {
  const rows = await safeQuery(
    deps,
    `SELECT max(created_at) AS latest,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours'
                             AND payload->>'outcome' = 'timeout') AS timeouts_24h,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS cycles_24h
     FROM heidi_events WHERE event_type = 'cognitive_cycle'`,
  );
  if (rows === null) {
    return { name: 'cognitive_loop', status: 'UNKNOWN', detail: 'heidi_events query failed' };
  }
  const latest = rows[0]?.latest as string | null;
  const age = ageMs(latest, now);
  const metrics = {
    lastCycleAgeMs: age,
    cycles24h: Number(rows[0]?.cycles_24h ?? 0),
    timeouts24h: Number(rows[0]?.timeouts_24h ?? 0),
  };
  if (age === null) {
    return { name: 'cognitive_loop', status: 'UNKNOWN', detail: 'no cognitive_cycle events recorded', metrics };
  }
  const timeouts = metrics.timeouts24h as number;
  if (age <= 15 * MINUTE) {
    return timeouts > 0
      ? { name: 'cognitive_loop', status: 'DEGRADED', detail: `loop live; ${timeouts} timeout(s) in last 24h`, metrics }
      : { name: 'cognitive_loop', status: 'HEALTHY', detail: 'loop heartbeat fresh', metrics };
  }
  if (age <= 2 * HOUR) {
    return { name: 'cognitive_loop', status: 'DEGRADED', detail: `last cycle ${Math.round(age / MINUTE)}m ago`, metrics };
  }
  return { name: 'cognitive_loop', status: 'FAILED', detail: `no cycle in ${Math.round(age / HOUR)}h`, metrics };
}

async function goalDimension(
  deps: ExecutiveDiagnosticDeps,
  now: number,
): Promise<DiagnosticDimension> {
  if (!deps.goals) {
    return { name: 'goals', status: 'UNKNOWN', detail: 'goal system not wired' };
  }
  let open;
  try {
    open = await deps.goals.getPendingWork();
  } catch {
    return { name: 'goals', status: 'UNKNOWN', detail: 'getPendingWork failed' };
  }
  const stale = open.filter((g) => {
    const age = ageMs(g.updatedAt ?? g.createdAt, now);
    return age !== null && age > 24 * HOUR;
  });
  const metrics = { open: open.length, stale24h: stale.length, staleTitles: stale.slice(0, 5).map((g) => g.title) };
  if (stale.length > 0) {
    return {
      name: 'goals',
      status: 'DEGRADED',
      detail: `${stale.length} open goal(s) untouched for >24h`,
      metrics,
    };
  }
  return { name: 'goals', status: 'HEALTHY', detail: `${open.length} open goal(s), none stale`, metrics };
}

async function missionDimension(
  deps: ExecutiveDiagnosticDeps,
  now: number,
): Promise<DiagnosticDimension> {
  const rows = await safeQuery(deps, `SELECT max(run_at) AS latest FROM protoforge_mission_runs`);
  if (rows === null) {
    return { name: 'missions', status: 'UNKNOWN', detail: 'protoforge_mission_runs query failed' };
  }
  const age = ageMs(rows[0]?.latest as string | null, now);
  if (age === null) {
    return { name: 'missions', status: 'UNKNOWN', detail: 'no ProtoForge mission runs recorded' };
  }
  const metrics = { lastRunAgeMs: age };
  // Scout cadence is 24h; allow a full missed run before degrading.
  if (age <= 48 * HOUR) {
    return { name: 'missions', status: 'HEALTHY', detail: `last mission ${Math.round(age / HOUR)}h ago`, metrics };
  }
  return { name: 'missions', status: 'DEGRADED', detail: `no mission run in ${Math.round(age / HOUR)}h`, metrics };
}

async function memoryDimension(
  deps: ExecutiveDiagnosticDeps,
  now: number,
): Promise<DiagnosticDimension> {
  const rows = await safeQuery(deps, `SELECT max(created_at) AS latest FROM memories`);
  if (rows === null) {
    return { name: 'memory', status: 'UNKNOWN', detail: 'memories query failed' };
  }
  const age = ageMs(rows[0]?.latest as string | null, now);
  if (age === null) {
    return { name: 'memory', status: 'UNKNOWN', detail: 'no episodic memories stored' };
  }
  const metrics = { lastMemoryAgeMs: age };
  if (age <= 24 * HOUR) {
    return { name: 'memory', status: 'HEALTHY', detail: `last memory ${Math.round(age / MINUTE)}m ago`, metrics };
  }
  return { name: 'memory', status: 'DEGRADED', detail: `no memory stored in ${Math.round(age / HOUR)}h`, metrics };
}

function authorizationDimension(deps: ExecutiveDiagnosticDeps): DiagnosticDimension {
  const journalPath =
    deps.ownerAuthJournalPath ??
    path.join(deps.repoDir ?? process.cwd(), '.hydi-operational', 'owner-authorizations.jsonl');
  let pending = 0;
  let decided = 0;
  try {
    if (!fs.existsSync(journalPath)) {
      return { name: 'authorizations', status: 'HEALTHY', detail: 'no authorization journal — nothing pending', metrics: { pending: 0 } };
    }
    // Append-only journal: the last record per id is the current state.
    const latestById = new Map<string, { status: string; expiresAt: string | null }>();
    for (const line of fs.readFileSync(journalPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed) as { id?: string; status?: string; expiresAt?: string | null };
        if (rec.id) latestById.set(rec.id, { status: rec.status ?? '', expiresAt: rec.expiresAt ?? null });
      } catch {
        // Skip malformed lines rather than failing the diagnostic.
      }
    }
    const now = Date.now();
    for (const rec of latestById.values()) {
      if (rec.status === 'PENDING' && (!rec.expiresAt || new Date(rec.expiresAt).getTime() > now)) pending += 1;
      else decided += 1;
    }
  } catch {
    return { name: 'authorizations', status: 'UNKNOWN', detail: 'authorization journal unreadable' };
  }
  if (pending > 0) {
    return {
      name: 'authorizations',
      status: 'BLOCKED',
      detail: `${pending} owner authorization(s) pending — human action required`,
      metrics: { pending, decided },
    };
  }
  return { name: 'authorizations', status: 'HEALTHY', detail: 'no pending owner authorizations', metrics: { pending: 0, decided } };
}

async function escalationDimension(deps: ExecutiveDiagnosticDeps): Promise<DiagnosticDimension> {
  const rows = await safeQuery(
    deps,
    `SELECT count(*) FILTER (WHERE NOT resolved) AS open_total,
            count(*) FILTER (WHERE NOT resolved AND created_at > now() - interval '24 hours') AS open_24h
     FROM operator_escalations`,
  );
  if (rows === null) {
    return { name: 'escalations', status: 'UNKNOWN', detail: 'operator_escalations query failed' };
  }
  const open24h = Number(rows[0]?.open_24h ?? 0);
  const openTotal = Number(rows[0]?.open_total ?? 0);
  const metrics = { openTotal, open24h };
  // The backlog is historical; the *signal* is new escalations. Report both,
  // classify on the new ones only — a legacy backlog cannot mark a healthy
  // day degraded forever.
  if (open24h > 0) {
    return { name: 'escalations', status: 'DEGRADED', detail: `${open24h} new open escalation(s) in 24h`, metrics };
  }
  return { name: 'escalations', status: 'HEALTHY', detail: `no new escalations in 24h (${openTotal} legacy open)`, metrics };
}

function runtimeDriftDimension(deps: ExecutiveDiagnosticDeps): DiagnosticDimension {
  const repoDir = deps.repoDir ?? process.cwd();
  // The baseline is the last QUALIFIED deployment: the pointer file written
  // at deploy time first, falling back to the live-qualification record.
  // Both carry { deployedHead, branch }.
  const candidates = deps.deploymentEvidencePath
    ? [deps.deploymentEvidencePath]
    : [
      path.join(repoDir, '.hydi-operational', 'qualified-deployment.json'),
      path.join(repoDir, '.hydi-operational', 'autonomy-live.json'),
    ];

  let head: string | null = null;
  let branch: string | null = null;
  if (deps.gitInfo) {
    const info = deps.gitInfo();
    head = info?.head ?? null;
    branch = info?.branch ?? null;
  } else {
    try {
      head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, encoding: 'utf8', timeout: 10_000 }).trim();
      branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoDir, encoding: 'utf8', timeout: 10_000 }).trim();
    } catch {
      return { name: 'runtime_drift', status: 'UNKNOWN', detail: 'git HEAD unreadable', metrics: { repoDir } };
    }
  }
  if (!head) {
    return { name: 'runtime_drift', status: 'UNKNOWN', detail: 'git HEAD unreadable', metrics: { repoDir } };
  }

  let expected: { deployedHead?: string; branch?: string } | null = null;
  if (deps.expectedDeployment !== undefined) {
    expected = deps.expectedDeployment;
  } else {
    try {
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          expected = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          break;
        }
      }
    } catch {
      return { name: 'runtime_drift', status: 'UNKNOWN', detail: 'deployment evidence unreadable', metrics: { head, branch } };
    }
  }

  const metrics = { head, branch, expectedHead: expected?.deployedHead ?? null, expectedBranch: expected?.branch ?? null };
  if (!expected?.deployedHead) {
    return { name: 'runtime_drift', status: 'UNKNOWN', detail: 'no qualified deployment baseline recorded', metrics };
  }
  if (head !== expected.deployedHead || (expected.branch && branch !== expected.branch)) {
    return {
      name: 'runtime_drift',
      status: 'DEGRADED',
      detail: `running ${branch}@${head}, qualified deployment was ${expected.branch}@${expected.deployedHead}`,
      metrics,
    };
  }
  return { name: 'runtime_drift', status: 'HEALTHY', detail: `runtime matches qualified deployment ${head}`, metrics };
}

function capabilityDimension(deps: ExecutiveDiagnosticDeps): DiagnosticDimension {
  if (!deps.registry) {
    return { name: 'capabilities', status: 'UNKNOWN', detail: 'capability registry not wired' };
  }
  const summary = deps.registry.getSummary();
  const metrics = { total: summary.total, available: summary.available, unavailable: summary.unavailable };
  if (summary.total === 0) {
    return { name: 'capabilities', status: 'UNKNOWN', detail: 'registry empty', metrics };
  }
  if (summary.available === 0) {
    return { name: 'capabilities', status: 'FAILED', detail: 'no executable capabilities', metrics };
  }
  if (summary.unavailable > 0) {
    return { name: 'capabilities', status: 'DEGRADED', detail: `${summary.unavailable}/${summary.total} capabilities unavailable`, metrics };
  }
  return { name: 'capabilities', status: 'HEALTHY', detail: `${summary.available}/${summary.total} capabilities available`, metrics };
}

/**
 * Collect one diagnostic report. Individual dimension failures degrade that
 * dimension, never the collection — a diagnostic that throws would be a
 * monitor that can itself fail silently.
 */
export async function collectExecutiveDiagnostic(
  deps: ExecutiveDiagnosticDeps,
): Promise<ExecutiveDiagnosticReport> {
  const now = deps.now ? deps.now() : Date.now();
  const dimensions = await Promise.all([
    databaseDimension(deps),
    cognitiveLoopDimension(deps, now),
    goalDimension(deps, now),
    missionDimension(deps, now),
    memoryDimension(deps, now),
    escalationDimension(deps),
    Promise.resolve(authorizationDimension(deps)),
    Promise.resolve(runtimeDriftDimension(deps)),
    Promise.resolve(capabilityDimension(deps)),
  ]);
  return { generatedAt: new Date(now).toISOString(), overall: overallStatus(dimensions), dimensions };
}
