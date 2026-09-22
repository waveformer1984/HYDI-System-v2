/**
 * HEIDI Diagnostic Follow-up — the investigator behind
 * `ops.diagnostic_followup`.
 *
 * Reads the most recent `executive_diagnostic` event and turns each
 * non-HEALTHY dimension into a bounded INVESTIGATION: a small set of
 * read-only aggregate queries plus a verdict and a suggested next step.
 *
 * Hard rules:
 *   - Investigates, never repairs. No writes except the caller's single
 *     heidi_events row.
 *   - Findings must carry evidence (the numbers that produced them), not
 *     adjectives.
 *   - A dimension that cannot be investigated produces an UNKNOWN finding,
 *     not silence.
 *   - Suggested follow-ups come from a fixed vocabulary; the investigator
 *     proposes, governance disposes.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { DiagnosticDimension, DiagnosticStatus } from './ExecutiveDiagnostic';

export interface DiagnosticFinding {
  dimension: string;
  severity: DiagnosticStatus;
  summary: string;
  /** The measurements that justify the summary. */
  evidence: Record<string, unknown>;
  /**
   * Fixed vocabulary only:
   *   monitor        — worth watching, no action yet
   *   bounded_task   — a known-shape investigation/repair task exists
   *   human_review   — a human must look; never auto-repair
   *   none           — nothing to do
   */
  suggestedFollowup: 'monitor' | 'bounded_task' | 'human_review' | 'none';
  taskTemplate?: string;
  humanRequired: boolean;
}

export interface FollowupReport {
  generatedAt: string;
  diagnosticEventId: string | null;
  diagnosticAgeMs: number | null;
  findings: DiagnosticFinding[];
  /** Same 5-state vocabulary as the diagnostic. */
  verdict: DiagnosticStatus;
}

export interface FollowupDeps {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
  repoDir?: string;
  /** Test seam: git identity + dirty-file count instead of spawning git. */
  gitInfo?: () => { head: string; branch: string; dirtyFiles: number } | null;
  now?: () => number;
}

const HOUR = 60 * 60 * 1000;

async function q(deps: FollowupDeps, sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>> | null> {
  try {
    return (await deps.pool.query(sql, params)).rows;
  } catch {
    return null;
  }
}

function unknownFinding(dimension: string, reason: string): DiagnosticFinding {
  return {
    dimension,
    severity: 'UNKNOWN',
    summary: `could not investigate: ${reason}`,
    evidence: { reason },
    suggestedFollowup: 'human_review',
    humanRequired: true,
  };
}

// ---------------------------------------------------------------------------
// Per-dimension investigators — bounded, read-only, evidence-carrying
// ---------------------------------------------------------------------------

async function investigateCognitiveLoop(deps: FollowupDeps): Promise<DiagnosticFinding> {
  const timeouts = await q(
    deps,
    `SELECT date_trunc('hour', created_at) AS hr, count(*) AS n
     FROM heidi_events
     WHERE event_type = 'cognitive_cycle' AND payload->>'outcome' = 'timeout'
       AND created_at > now() - interval '24 hours'
     GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
  );
  const outcomeSplit = await q(
    deps,
    `SELECT payload->>'outcome' AS outcome, count(*) AS n,
            avg((payload->>'durationMs')::numeric) AS avg_ms
     FROM heidi_events
     WHERE event_type = 'cognitive_cycle' AND created_at > now() - interval '24 hours'
     GROUP BY 1`,
  );
  const lastTimeout = await q(
    deps,
    `SELECT created_at, payload->>'consecutiveFailures' AS consecutive_failures,
            payload->>'cycleTimeoutMs' AS cycle_timeout_ms
     FROM heidi_events
     WHERE event_type = 'cognitive_cycle' AND payload->>'outcome' = 'timeout'
     ORDER BY created_at DESC LIMIT 1`,
  );
  if (!timeouts || !outcomeSplit) return unknownFinding('cognitive_loop', 'timeout queries failed');

  const timeoutCount = timeouts.reduce((a, r) => a + Number(r.n), 0);
  const split = Object.fromEntries(outcomeSplit.map((r) => [r.outcome ?? 'null', Number(r.n)]));
  const avgSuccessMs = outcomeSplit.find((r) => r.outcome === 'success')?.avg_ms;
  const evidence = {
    timeouts24h: timeoutCount,
    outcomeSplit24h: split,
    avgSuccessDurationMs: avgSuccessMs ? Math.round(Number(avgSuccessMs)) : null,
    lastTimeout: lastTimeout?.[0] ?? null,
    timeoutHours: timeouts.map((r) => ({ hour: r.hr, count: Number(r.n) })).slice(0, 8),
  };

  // Interpretation, not repair: timeouts that are followed by successful
  // cycles are probe-overrun telemetry, not a dead loop.
  const succeeding = (split['success'] ?? 0) > 0;
  return {
    dimension: 'cognitive_loop',
    severity: 'DEGRADED',
    summary: succeeding
      ? `${timeoutCount} cycle timeout(s) in 24h while successful cycles continue — consistent with serial probe work exceeding the cycle bound, not loop failure`
      : `${timeoutCount} cycle timeout(s) in 24h with NO successful cycles — the loop may actually be wedged`,
    evidence,
    suggestedFollowup: succeeding ? 'bounded_task' : 'human_review',
    taskTemplate: 'ops.investigate_cognitive_timeouts',
    humanRequired: !succeeding,
  };
}

async function investigateEscalations(deps: FollowupDeps): Promise<DiagnosticFinding> {
  const byCategory = await q(
    deps,
    `SELECT category, count(*) AS n
     FROM operator_escalations
     WHERE NOT resolved AND created_at > now() - interval '24 hours'
     GROUP BY 1 ORDER BY 2 DESC`,
  );
  const topTitles = await q(
    deps,
    `SELECT category, title, count(*) AS n
     FROM operator_escalations
     WHERE NOT resolved AND created_at > now() - interval '24 hours'
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
  );
  const distinctKeys = await q(
    deps,
    `SELECT count(DISTINCT COALESCE(metadata->>'jobId', metadata->>'eventId', title)) AS distinct_keys,
            count(*) AS total
     FROM operator_escalations
     WHERE NOT resolved AND created_at > now() - interval '24 hours'`,
  );
  if (!byCategory || !distinctKeys) return unknownFinding('escalations', 'escalation queries failed');

  const total = Number(distinctKeys[0]?.total ?? 0);
  const distinct = Number(distinctKeys[0]?.distinct_keys ?? 0);
  const evidence = {
    newOpen24h: total,
    distinctKeys24h: distinct,
    duplicationRatio: distinct > 0 ? Math.round((total / distinct) * 100) / 100 : null,
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category, Number(r.n)])),
    topTitles: (topTitles ?? []).map((r) => ({ category: r.category, title: r.title, count: Number(r.n) })),
  };
  // Rows per distinct key > 1 means dedup is still letting repeats through
  // for some category — that is a candidate bounded investigation, not a
  // deletion job.
  const dupSuspected = distinct > 0 && total / distinct > 2;
  return {
    dimension: 'escalations',
    severity: 'DEGRADED',
    summary: `${total} new open escalation(s) in 24h across ${distinct} distinct key(s)` +
      (dupSuspected ? ' — repeat-per-key ratio suggests residual dedup gaps' : ''),
    evidence,
    suggestedFollowup: 'bounded_task',
    taskTemplate: 'ops.investigate_escalation_growth',
    humanRequired: false,
  };
}

function investigateRuntimeDrift(deps: FollowupDeps): DiagnosticFinding {
  const repoDir = deps.repoDir ?? process.cwd();
  let info: { head: string; branch: string; dirtyFiles: number } | null = null;
  if (deps.gitInfo) {
    info = deps.gitInfo();
  } else {
    try {
      const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, encoding: 'utf8', timeout: 10_000 }).trim();
      const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoDir, encoding: 'utf8', timeout: 10_000 }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8', timeout: 15_000 })
        .split('\n').filter((l) => l.trim().length > 0).length;
      info = { head, branch, dirtyFiles: dirty };
    } catch {
      return unknownFinding('runtime_drift', 'git unreadable');
    }
  }
  if (!info) return unknownFinding('runtime_drift', 'git info unavailable');

  let baseline: { deployedHead?: string; branch?: string } | null = null;
  for (const name of ['qualified-deployment.json', 'autonomy-live.json']) {
    const p = path.join(repoDir, '.hydi-operational', name);
    try {
      if (fs.existsSync(p)) { baseline = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
    } catch { /* unreadable evidence — reported below */ }
  }

  const drifted = baseline?.deployedHead ? info.head !== baseline.deployedHead : null;
  return {
    dimension: 'runtime_drift',
    severity: drifted ? 'DEGRADED' : drifted === false ? 'HEALTHY' : 'UNKNOWN',
    summary: drifted
      ? `runtime ${info.branch}@${info.head} differs from qualified ${baseline?.branch}@${baseline?.deployedHead}; ${info.dirtyFiles} uncommitted path(s) in working tree`
      : drifted === false
        ? `runtime matches qualified deployment ${info.head}; ${info.dirtyFiles} uncommitted path(s)`
        : 'no qualified-deployment baseline to compare against',
    evidence: {
      head: info.head,
      branch: info.branch,
      dirtyFiles: info.dirtyFiles,
      qualifiedHead: baseline?.deployedHead ?? null,
      qualifiedBranch: baseline?.branch ?? null,
      note: 'dirtyFiles includes operational state dirs and pre-existing uncommitted work — not proof of unauthorized change',
    },
    suggestedFollowup: drifted ? 'bounded_task' : 'monitor',
    taskTemplate: 'ops.investigate_runtime_drift',
    humanRequired: false,
  };
}

async function investigateGoals(deps: FollowupDeps): Promise<DiagnosticFinding> {
  const stale = await q(
    deps,
    `SELECT id, title, status, context->>'producerKey' AS producer_key,
            updated_at, now() - updated_at AS age
     FROM heidi_goals
     WHERE status IN ('pending','active','in_progress','blocked')
       AND updated_at < now() - interval '24 hours'
     ORDER BY updated_at ASC LIMIT 20`,
  );
  if (!stale) return unknownFinding('goals', 'goal query failed');
  return {
    dimension: 'goals',
    severity: 'DEGRADED',
    summary: `${stale.length} open goal(s) untouched for >24h`,
    evidence: {
      staleGoals: stale.map((r) => ({
        id: r.id, title: r.title, status: r.status, producerKey: r.producer_key,
        ageHours: r.age ? Math.round(Number((r.age as { hours?: number }).hours ?? 0)) : null,
      })),
    },
    suggestedFollowup: 'bounded_task',
    taskTemplate: 'ops.investigate_stale_goals',
    humanRequired: false,
  };
}

/**
 * Generic investigator for dimensions without a dedicated deep-dive:
 * carries the diagnostic's own metrics forward so the finding is still
 * evidence-backed rather than a bare restatement of the status.
 */
function genericFinding(d: DiagnosticDimension): DiagnosticFinding {
  return {
    dimension: d.name,
    severity: d.status,
    summary: `${d.name}: ${d.detail}`,
    evidence: { diagnosticDetail: d.detail, metrics: d.metrics ?? {} },
    suggestedFollowup: d.status === 'FAILED' || d.status === 'BLOCKED' ? 'human_review' : 'monitor',
    humanRequired: d.status === 'FAILED' || d.status === 'BLOCKED',
  };
}

const INVESTIGATORS: Record<
  string,
  (deps: FollowupDeps, d: DiagnosticDimension) => Promise<DiagnosticFinding> | DiagnosticFinding
> = {
  cognitive_loop: (deps) => investigateCognitiveLoop(deps),
  escalations: (deps) => investigateEscalations(deps),
  runtime_drift: (deps) => investigateRuntimeDrift(deps),
  goals: (deps) => investigateGoals(deps),
};

/**
 * Run a single dimension's investigator — the executor path for
 * `ops.investigate_finding`. An unknown dimension is an UNKNOWN finding,
 * never a crash and never a fabricated result.
 */
export async function investigateDimension(
  deps: FollowupDeps,
  dimensionName: string,
): Promise<DiagnosticFinding> {
  const investigator = INVESTIGATORS[dimensionName];
  if (!investigator) {
    return {
      dimension: dimensionName,
      severity: 'UNKNOWN',
      summary: `no investigator registered for dimension "${dimensionName}"`,
      evidence: { dimension: dimensionName },
      suggestedFollowup: 'human_review',
      humanRequired: true,
    };
  }
  const synthetic: DiagnosticDimension = {
    name: dimensionName,
    status: 'DEGRADED',
    detail: 'investigation target',
  };
  try {
    return await investigator(deps, synthetic);
  } catch {
    return unknownFinding(dimensionName, 'investigator threw');
  }
}

/**
 * Collect a follow-up report from the most recent executive diagnostic.
 * A missing diagnostic is itself a finding — the follow-up cannot invent
 * a baseline it never observed.
 */
export async function collectDiagnosticFollowup(deps: FollowupDeps): Promise<FollowupReport> {
  const now = deps.now ? deps.now() : Date.now();

  const diagRows = await q(
    deps,
    `SELECT id, payload, created_at FROM heidi_events
     WHERE event_type = 'executive_diagnostic' ORDER BY created_at DESC LIMIT 1`,
  );
  const diag = diagRows?.[0] ?? null;
  const diagnosticAgeMs = diag?.created_at ? now - new Date(diag.created_at as string).getTime() : null;

  const findings: DiagnosticFinding[] = [];
  if (!diag) {
    findings.push({
      dimension: 'executive_diagnostic',
      severity: 'UNKNOWN',
      summary: 'no executive_diagnostic event exists — nothing to follow up on',
      evidence: {},
      suggestedFollowup: 'monitor',
      humanRequired: false,
    });
  } else {
    const dimensions = ((diag.payload as { dimensions?: DiagnosticDimension[] })?.dimensions ?? []);
    for (const d of dimensions) {
      if (d.status === 'HEALTHY') continue;
      const investigator = INVESTIGATORS[d.name];
      if (!investigator) {
        findings.push(genericFinding(d));
        continue;
      }
      try {
        findings.push(await investigator(deps, d));
      } catch {
        findings.push(unknownFinding(d.name, 'investigator threw'));
      }
    }
  }

  const severities: DiagnosticStatus[] = findings.map((f) => f.severity);
  const verdict: DiagnosticStatus =
    findings.length === 0
      ? 'HEALTHY'
      : severities.includes('FAILED')
        ? 'FAILED'
        : findings.some((f) => f.humanRequired)
          ? 'BLOCKED'
          : severities.includes('UNKNOWN')
            ? 'UNKNOWN'
            : 'DEGRADED';

  return {
    generatedAt: new Date(now).toISOString(),
    diagnosticEventId: (diag?.id as string) ?? null,
    diagnosticAgeMs,
    findings,
    verdict,
  };
}
