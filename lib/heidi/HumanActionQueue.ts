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
 *   - lib/human-actions durable store → verifier-gated external
 *     prerequisites (credentials, funding, public endpoints). These are
 *     the only queue items whose resolution is machine-checkable: they
 *     carry their verifier identity + last-check evidence so the COO can
 *     distinguish "waiting on you to click approve" from "waiting on the
 *     external world to change".
 *
 * EscalationManager (in-memory, superseded by EscalationNotifier) is
 * deliberately excluded: it persists nothing, so nothing can be read.
 *
 * Determinism: every id is `source:sourceKey` — the same underlying row
 * always produces the same queue identity (dedup by construction).
 * Backlog aggregates never count as open work and never select actions.
 */

import type { Pool } from 'pg';
import { getCapabilityRegistry } from './CapabilityRegistry';
import { collectOffers } from './CommercialBridge';
import { load as loadHaStore } from '../human-actions/store';

/** Durable human-action records (schema v2). A read failure contributes
 *  zero items — the queue never fabricates pending human work. */
function loadHumanActionStore(): Array<Record<string, any>> {
  try {
    const db = loadHaStore();
    return Array.isArray(db?.actions) ? db.actions.filter(
      (a: Record<string, any>) => !['RESOLVED', 'REJECTED', 'CANCELLED'].includes(a.status),
    ) : [];
  } catch {
    return [];
  }
}

export type HumanActionStatus =
  | 'OPEN' | 'ACKNOWLEDGED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'EXPIRED' | 'BLOCKED';

export type HumanActionSource =
  | 'intervention' | 'authorization_escalation' | 'operator_escalation' | 'action_proposal'
  | 'commercial_offer' | 'human_action';

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

async function q(pool: Pick<Pool, 'query'>, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  try {
    return (await pool.query(sql, params)).rows;
  } catch {
    return []; // missing table/permission → that source contributes nothing, never fabricates
  }
}

const ACK_EVENT = 'human_action_ack';

/** Durable acknowledgement overlay — applied after item collection. */
async function loadAcknowledgements(
  pool: Pick<Pool, 'query'>,
): Promise<Map<string, { id: string; actor: string; createdAt: string }>> {
  const rows = await q(pool, `
    SELECT payload->>'queueItemId' AS qid, max(created_at) AS latest
    FROM heidi_events
    WHERE event_type = '${ACK_EVENT}'
    GROUP BY 1`);
  const map = new Map<string, { id: string; actor: string; createdAt: string }>();
  for (const r of rows) {
    if (r.qid) map.set(String(r.qid), { id: String(r.qid), actor: '', createdAt: new Date(r.latest as string).toISOString() });
  }
  return map;
}

export interface AckResult {
  ok: boolean;
  outcome: 'acknowledged' | 'already_acknowledged' | 'not_found' | 'expired' | 'not_open';
  acknowledgementId?: string;
  queueItemId?: string;
  reason?: string;
}

/**
 * Governed acknowledgement of one queue item. Read/write ONLY — records
 * the human's "I've seen this"; never executes, never authorizes, never
 * mutates the underlying source record.
 *
 *   - item must exist in the current normalized queue (fail-closed)
 *   - EXPIRED items refuse with 'expired'
 *   - repeat ack is idempotent (returns the existing record)
 */
export async function acknowledgeHumanAction(
  pool: Pick<Pool, 'query'>,
  queueItemId: string,
  actor: string,
): Promise<AckResult> {
  if (!queueItemId || typeof queueItemId !== 'string') {
    return { ok: false, outcome: 'not_found', reason: 'queue item id required' };
  }
  const queue = await collectHumanActionQueue(pool);
  const item = queue.items.find((i) => i.id === queueItemId);
  if (!item) {
    return { ok: false, outcome: 'not_found', reason: `no queue item '${queueItemId}'` };
  }
  if (item.status === 'EXPIRED') {
    return { ok: false, outcome: 'expired', queueItemId, reason: 'item is expired — acknowledge is fail-closed' };
  }
  if (item.status === 'ACKNOWLEDGED') {
    const existing = await q(pool, `
      SELECT id FROM heidi_events
      WHERE event_type = '${ACK_EVENT}' AND payload->>'queueItemId' = $1
      ORDER BY created_at DESC LIMIT 1`, [queueItemId]);
    return {
      ok: true, outcome: 'already_acknowledged', queueItemId,
      acknowledgementId: existing[0]?.id as string | undefined,
      reason: 'idempotent — existing acknowledgement returned',
    };
  }

  const inserted = await pool.query(
    `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
     VALUES ($1, 'heidi', $2, 'ACKNOWLEDGED', now()) RETURNING id`,
    [ACK_EVENT, JSON.stringify({
      queueItemId,
      actor,
      status: 'ACKNOWLEDGED',
      evidence: { source: item.source, category: item.category, reason: item.reason },
    })],
  );
  return {
    ok: true, outcome: 'acknowledged', queueItemId,
    acknowledgementId: inserted.rows[0]?.id as string | undefined,
  };
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

  // ── Action proposals: pending governed-action decisions. Read-only
  //    here — approval/rejection happens only via the proposals
  //    endpoint (consume-once, params-hash bound). This surface reports
  //    them; it cannot resolve them. ─────────────────────────────────
  const registry = getCapabilityRegistry();
  for (const r of await q(pool, `
    SELECT id, capability_id, title, reason, expires_at, status,
           created_at, updated_at, params->>'offerId' AS offer_id
    FROM heidi_action_proposals
    WHERE status = 'pending'
    ORDER BY created_at DESC LIMIT 50`)) {
    const expired = new Date(r.expires_at as string).getTime() <= Date.now();
    const cap = registry.get(String(r.capability_id));
    items.push({
      id: `proposal:${r.id}`,
      source: 'action_proposal',
      category: String(r.capability_id ?? 'unknown'),
      priority: 1,
      status: expired ? 'EXPIRED' : 'OPEN',
      reason: String(r.title ?? 'action proposal awaiting decision'),
      requestedAction: 'review and decide in the ACTIONS tab — approve or reject via the governed endpoint',
      evidence: {
        proposalId: r.id,
        capabilityId: r.capability_id,
        offerId: r.offer_id ?? null,
        expiresAt: r.expires_at,
      },
      authorizationLevel: cap?.riskLevel ?? 'R2',
      backlog: false,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date((r.updated_at ?? r.created_at) as string).toISOString(),
    });
  }

  // ── Durable Human Actions (lib/human-actions) — verifier-gated
  //    external prerequisites. File-backed store; a read failure means
  //    the store contributes nothing (never fabricates items).
  //    VERIFYING/CLAIMED/OPEN map to OPEN — still waiting on the human.
  //    Terminal states are omitted: RESOLVED/REJECTED/CANCELLED items no
  //    longer need a human; EXPIRED stays visible as EXPIRED. ────────
  for (const a of loadHumanActionStore()) {
    const status: HumanActionStatus =
      a.status === 'EXPIRED' ? 'EXPIRED'
        : a.status === 'BLOCKED' ? 'BLOCKED'
          : 'OPEN'; // OPEN | CLAIMED | VERIFYING — all still need the human
    const failedChecks = (a.verification?.checks ?? []).filter((c: { passed?: boolean }) => !c.passed).map((c: { name?: string }) => c.name);
    items.push({
      id: `human-action:${a.id}`,
      source: 'human_action',
      category: String(a.type ?? 'general'),
      priority: a.priority === 'high' ? 1 : a.priority === 'low' ? 4 : 2,
      status,
      reason: String(a.title ?? 'human action'),
      requestedAction: Array.isArray(a.instructions) && a.instructions.length
        ? String(a.instructions[0])
        : 'complete the documented prerequisite, then request verification',
      evidence: {
        actionId: a.id,
        blockerKey: a.blockerKey ?? null,
        // Canonical boundary contract (boundary.js) — small vocabulary,
        // derived from type on legacy records.
        boundaryCategory: a.boundary?.category ?? null,
        externalSystem: a.boundary?.externalSystem ?? null,
        verifier: a.verifier?.name ?? null,
        verifierStatus: a.verification?.status ?? (a.verification ? (a.verification.passed ? 'VERIFIED' : 'FAILED') : null),
        resumeCapability: a.resumeCapability ?? null,
        instructions: a.instructions ?? [],
        lastCheck: a.verification?.checkedAt ?? null,
        lastCheckPassed: a.verification?.passed ?? null,
        stillFailing: failedChecks,
        linkedMissionId: a.sourceMissionId ?? null,
        linkedGoalId: a.sourceGoalId ?? null,
        attempts: a.attempts ?? 0,
        claimable: a.status === 'OPEN' || a.status === 'BLOCKED',
        verifiable: (a.verifier?.name ?? 'manual') !== 'manual',
      },
      authorizationLevel: 'R3',
      backlog: false,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
  }

  // ── Commercial offers at a human boundary: AUTHORIZATION_REQUIRED
  //    (e.g. missing customer identity) or OFFER_BLOCKED. Read-only —
  //    resolution requires governed proposal/customer identity, never
  //    this surface. ────────────────────────────────────────────────
  const offers = await collectOffers(pool).catch(() => []);
  for (const o of offers) {
    // Test-fixture offers are durable evidence, not sellable inventory —
    // they never become a human customer boundary.
    if (o.isTest) continue;
    // CHECKOUT_READY is also a human boundary: no customer identity has
    // been supplied yet, and the system does not invent one. PAYMENT_PENDING
    // and beyond are awaiting external payment, not operator input.
    if (o.stage !== 'AUTHORIZATION_REQUIRED' && o.stage !== 'OFFER_BLOCKED' && o.stage !== 'CHECKOUT_READY') continue;
    const needsCustomer = o.stage === 'CHECKOUT_READY';
    items.push({
      id: `offer:${o.offerId}`,
      source: 'commercial_offer',
      category: needsCustomer ? 'customer_required' : 'payment_boundary',
      priority: needsCustomer ? 1 : 2,
      status: 'OPEN',
      reason: needsCustomer
        ? `${o.offerId} CHECKOUT_READY — cannot advance: no legitimate customer identity has been supplied ($${(o.priceCents / 100).toFixed(2)} ${o.currency})`
        : `${o.offerId} ${o.stage} — ${o.stageReason ?? 'no reason recorded'} ($${(o.priceCents / 100).toFixed(2)} ${o.currency})`,
      requestedAction: 'provide customer identity and approve via a governed revenue.advance_offer proposal',
      evidence: { offerId: o.offerId, stage: o.stage, stageReason: o.stageReason, priceCents: o.priceCents, currency: o.currency },
      authorizationLevel: 'R2',
      backlog: false,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }

  // Overlay durable acknowledgements — acknowledged items keep their
  // provenance but no longer count as open.
  const acks = await loadAcknowledgements(pool);
  for (const item of items) {
    if (item.status === 'OPEN' && acks.has(item.id)) {
      item.status = 'ACKNOWLEDGED';
      item.evidence = { ...item.evidence, acknowledgedAt: acks.get(item.id)!.createdAt };
    }
  }

  items.sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
  return {
    generatedAt: new Date().toISOString(),
    open: items.filter((i) => i.status === 'OPEN' && !i.backlog).length,
    backlogRowCount,
    items,
  };
}
