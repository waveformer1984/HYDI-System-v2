/**
 * HumanActionQueue — one normalized, read-only view of everything that
 * needs a human.
 *
 * Sources (all read-only, writers untouched):
 *   - human_intervention_requests   → status pending/expired → OPEN/EXPIRED
 *   - heidi_events 'authorization_escalation' → durable refusal records,
 *     aggregated per capabilityId+reason (a pending authorization DECISION)
 *   - operator_escalations unresolved → rows <24h itemized (fresh incidents);
 *     older rows aggregated per category as backlog entries
 *
 * EscalationManager (in-memory, superseded by EscalationNotifier) is
 * deliberately excluded: it persists nothing, so nothing can be read.
 *
 * Determinism: every id is `source:sourceKey` — the same underlying row
 * always produces the same queue identity (dedup by construction).
 * Backlog aggregates never count as open work and never select actions.
 */

import type { Pool } from 'pg';

export type HumanActionStatus =
  | 'OPEN' | 'ACKNOWLEDGED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'EXPIRED' | 'BLOCKED';

export type HumanActionSource =
  | 'intervention' | 'authorization_escalation' | 'operator_escalation';

export interface HumanAction {
  id: string;
  source: HumanActionSource;
  category: string;
  /** 1 = most urgent. */
  priority: number;
  status: HumanActionStatus;
  reason: string;
  requestedAction: string;
  evidence: Record<string, unknown>;
  authorizationLevel: string;
  /** True for aggregated historical rows — reported, never selected. */
  backlog: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HumanActionQueue {
  generatedAt: string;
  /** OPEN items that are not backlog — real pending human decisions. */
  open: number;
  /** Raw row count inside backlog aggregates (the human-owned pile). */
  backlogRowCount: number;
  items: HumanAction[];
}

const FRESH_WINDOW_SQL = `now() - interval '24 hours'`;

async function q(pool: Pick<Pool, 'query'>, sql: string): Promise<Record<string, unknown>[]> {
  try {
    return (await pool.query(sql)).rows;
  } catch {
    return []; // missing table/permission → that source contributes nothing, never fabricates
  }
}

export async function collectHumanActionQueue(
  pool: Pick<Pool, 'query'>,
): Promise<HumanActionQueue> {
  const items: HumanAction[] = [];

  // ── Interventions: the only channel with real lifecycle statuses ──────
  for (const r of await q(pool, `
    SELECT id, request_id, objective, blocker, required_action, intervention_type,
           status, created_at, updated_at
    FROM human_intervention_requests
    WHERE status IN ('pending', 'expired', 'blocked')
    ORDER BY created_at DESC LIMIT 50`)) {
    const status = r.status === 'pending' ? 'OPEN' : r.status === 'expired' ? 'EXPIRED' : 'BLOCKED';
    items.push({
      id: `intervention:${r.request_id ?? r.id}`,
      source: 'intervention',
      category: String(r.intervention_type ?? 'intervention'),
      priority: 1,
      status,
      reason: String(r.blocker ?? r.objective ?? 'intervention requested'),
      requestedAction: String(r.required_action ?? 'review'),
      evidence: { goalId: r.goal_id ?? null, expectedState: r.expected_state ?? null },
      authorizationLevel: 'R3',
      backlog: false,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date((r.updated_at ?? r.created_at) as string).toISOString(),
    });
  }

  // ── Authorization escalations: durable refusal records = pending
  //    capability-authorization decisions, aggregated per capability ────
  for (const r of await q(pool, `
    SELECT payload->>'capabilityId' AS cap,
           payload->>'reason' AS reason,
           payload->>'riskLevel' AS risk,
           count(*) AS n,
           min(created_at) AS earliest,
           max(created_at) AS latest
    FROM heidi_events
    WHERE event_type = 'authorization_escalation'
    GROUP BY 1, 2, 3
    ORDER BY latest DESC LIMIT 20`)) {
    items.push({
      id: `authz:${r.cap ?? 'unknown'}:${r.reason ?? ''}`,
      source: 'authorization_escalation',
      category: 'capability_authorization',
      priority: 2,
      status: 'OPEN',
      reason: String(r.reason ?? 'capability requires higher authorization'),
      requestedAction: `grant or dismiss authorization for ${r.cap ?? 'unknown capability'}`,
      evidence: { occurrences: Number(r.n), earliest: r.earliest, latest: r.latest },
      authorizationLevel: String(r.risk ?? 'R3'),
      backlog: false,
      createdAt: new Date(r.earliest as string).toISOString(),
      updatedAt: new Date(r.latest as string).toISOString(),
    });
  }

  // ── Operator escalations: fresh (<24h) itemized, older aggregated ─────
  for (const r of await q(pool, `
    SELECT id, category, severity, title, body, action_required, metadata, created_at
    FROM operator_escalations
    WHERE resolved = false AND created_at > ${FRESH_WINDOW_SQL}
    ORDER BY created_at DESC LIMIT 50`)) {
    items.push({
      id: `escalation:${r.id}`,
      source: 'operator_escalation',
      category: String(r.category ?? 'unknown'),
      priority: 2,
      status: 'OPEN',
      reason: String(r.title ?? r.body ?? 'operator escalation'),
      requestedAction: String(r.action_required ?? 'review and resolve'),
      evidence: { severity: r.severity ?? null, metadata: r.metadata ?? null },
      authorizationLevel: 'R3',
      backlog: false,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date(r.created_at as string).toISOString(),
    });
  }

  let backlogRowCount = 0;
  for (const r of await q(pool, `
    SELECT category, count(*) AS n, min(created_at) AS oldest, max(created_at) AS newest
    FROM operator_escalations
    WHERE resolved = false AND created_at <= ${FRESH_WINDOW_SQL}
    GROUP BY category`)) {
    const n = Number(r.n) || 0;
    backlogRowCount += n;
    items.push({
      id: `escalation-backlog:${r.category}`,
      source: 'operator_escalation',
      category: String(r.category),
      priority: 9,
      status: 'OPEN',
      reason: `${n} unresolved ${r.category} escalation(s) — historical human-owned backlog`,
      requestedAction: 'human decision: bulk resolve, investigate, or leave',
      evidence: { count: n, oldest: r.oldest, newest: r.newest },
      authorizationLevel: 'R3',
      backlog: true,
      createdAt: new Date(r.oldest as string).toISOString(),
      updatedAt: new Date(r.newest as string).toISOString(),
    });
  }

  items.sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
  return {
    generatedAt: new Date().toISOString(),
    open: items.filter((i) => i.status === 'OPEN' && !i.backlog).length,
    backlogRowCount,
    items,
  };
}
