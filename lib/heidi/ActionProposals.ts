/**
 * HEIDI ACTION PROPOSALS — governed human-approval surface.
 *
 * A proposal is Heidi recommending ONE bounded local action. It is stored
 * server-side in heidi_action_proposals; the browser can only submit a
 * proposal id + a decision. Capability and parameters are resolved from
 * the stored row — never from the client — and validated AGAIN inside the
 * consume transaction, so a proposal that changed after display cannot
 * execute under the approval given for the displayed version.
 *
 * Approve is consume-once and race-safe: a single conditional UPDATE
 * (status='pending' AND expires_at>now() AND params_hash=<exact>) flips
 * the row to 'approved' and, in the same transaction, inserts a pending
 * heidi_goals mission row. The daemon's existing planner -> MissionRunner
 * -> MissionLedger path then executes and durably settles it — this
 * module adds no parallel execution path.
 *
 * Reject and expiry are non-executing by construction: neither path
 * creates a goal row.
 */

import { createHash, randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson } from '../governance/approval-signing';

/* ─── Allowlist ────────────────────────────────────────────────────
 * Local-only, low-risk capabilities wired in CognitiveCore. Params must
 * be '{}'-equivalent for ops.* entries; tool.create_task accepts a
 * bounded {title, description} — both are plain text, no paths/URLs.
 * Anything not in this table can never be proposed, let alone run.
 */
interface AllowlistEntry {
  label: string;
  params: 'none' | 'task' | 'offer_advance';
}
// ops.agent_supervise was dropped after code review (2026-10-02): it is
// NOT an observational pass — superviseAgents retries FAILED missions via
// runAgent (real handler side effects), writes STALE/FAILED transitions,
// inserts operator_escalations, and tickPersistentTeam dispatches queued
// team work. Those are repeatable real effects, out of scope for v1.
export const PROPOSAL_ALLOWLIST: Record<string, AllowlistEntry> = {
  'ops.coo_state': {
    label: 'Refresh the COO operating state',
    params: 'none',
  },
  'ops.model_catalog': {
    label: 'Refresh the local model catalog',
    params: 'none',
  },
  // self_sufficiency.check_all_capabilities removed (2026-10-02 safety
  // review): chm.checkAll() runs EVERY registered probe — including
  // Stripe api.stripe.com, Twilio, SendGrid/SMTP, Google Places verifiers
  // that send live credentials to cloud endpoints when envs are set.
  // External network + funded accounts = not local-only. Never allowlist.
  'world.sync': {
    label: 'Synchronize the world model',
    params: 'none',
  },
  // revenue.advance_offer is R2, admitted deliberately: the proposal path
  // is the human-approved dispatch surface for the already-governed
  // RevenueRuntime chain. Approving creates a goal bound to this
  // capability — the existing R2 gate (autonomy>=3) then decides whether
  // it executes or remains human_required. Admission ≠ execution.
  'revenue.advance_offer': {
    label: 'Advance a commercial offer one governed step toward checkout/reconcile',
    params: 'offer_advance',
  },
  // Other R1+ capabilities remain deliberately absent: at the daemon's
  // current autonomy level an approved goal would be refused as
  // human_required again — approving it would churn, not execute.
};

interface AllowlistEntry {
  label: string;
  params: 'none' | 'task' | 'offer_advance';
}

const PARAM_BYTES_LIMIT = 4096;
const FORBIDDEN_PARAM_KEY =
  /^(secret|token|key|password|path|file|dir|url|uri|command|cmd|sql|query|script)$/i;

export interface ProposalRow {
  id: string;
  version: number;
  capability_id: string;
  params: Record<string, unknown>;
  params_hash: string;
  title: string;
  reason: string;
  expected_effects: string | null;
  risks: string | null;
  prerequisites: string | null;
  rollback: string | null;
  reversible: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'retracted';
  producer_key: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  approved_hash: string | null;
  goal_id: string | null;
  created_at: string;
  // Joined at list time — the mission the daemon ran for this proposal.
  mission_id?: string | null;
  mission_status?: string | null;
  mission_stage?: string | null;
}

export function proposalParamsHash(capabilityId: string, params: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${capabilityId}:${canonicalJson(params)}`)
    .digest('hex');
}

/** Validate capability + params against the allowlist. Returns an error
 *  string, or null when the pair is legal. */
export function validateProposalSpec(
  capabilityId: string,
  params: Record<string, unknown>,
): string | null {
  const entry = PROPOSAL_ALLOWLIST[capabilityId];
  if (!entry) return `capability '${capabilityId}' is not on the approval allowlist`;

  const bytes = Buffer.byteLength(JSON.stringify(params));
  if (bytes > PARAM_BYTES_LIMIT) return 'params exceed size limit';

  for (const k of Object.keys(params)) {
    if (FORBIDDEN_PARAM_KEY.test(k)) return `param '${k}' is forbidden in proposals`;
  }

  if (entry.params === 'none') {
    return Object.keys(params).length === 0 ? null : `capability '${capabilityId}' takes no parameters`;
  }

  if (entry.params === 'offer_advance') {
    // revenue.advance_offer contract (RevenueRuntime.advance):
    //   offerId? — target one offer (bounded identifier, never a URL/SQL)
    //   customerEmail? — customer identity for the checkout boundary
    //   advanceAll? — advance all non-terminal offers instead
    const ALLOWED = new Set(['offerId', 'customerEmail', 'advanceAll']);
    for (const k of Object.keys(params)) {
      if (!ALLOWED.has(k)) return `param '${k}' is not permitted for '${capabilityId}'`;
    }
    if ('offerId' in params &&
      (typeof params.offerId !== 'string' || !/^[\w:-]{1,120}$/.test(params.offerId))) {
      return 'offerId must be a bounded identifier string (1-120 word chars)';
    }
    if ('customerEmail' in params &&
      (typeof params.customerEmail !== 'string' ||
        params.customerEmail.length > 254 ||
        !params.customerEmail.includes('@'))) {
      return 'customerEmail must be a valid email address';
    }
    if ('advanceAll' in params && typeof params.advanceAll !== 'boolean') {
      return 'advanceAll must be a boolean';
    }
    if (params.offerId !== undefined && params.advanceAll === true) {
      return 'offerId and advanceAll are mutually exclusive';
    }
    return null;
  }

  return `unknown params spec for '${capabilityId}'`;
}

export interface CreateProposalInput {
  capabilityId: string;
  params?: Record<string, unknown>;
  title: string;
  reason: string;
  expectedEffects?: string;
  risks?: string;
  prerequisites?: string;
  rollback?: string;
  reversible?: boolean;
  producerKey: string;
  expiresInMs?: number;
}

/** Server-side only — producers (daemon/core) call this, never the
 *  browser. Idempotent per (producer_key, params_hash) while pending. */
export async function createActionProposal(
  pool: Pool,
  input: CreateProposalInput,
): Promise<{ id: string; existing: boolean }> {
  const params = input.params ?? {};
  const specError = validateProposalSpec(input.capabilityId, params);
  if (specError) throw new Error(`Proposal refused: ${specError}`);
  const paramsHash = proposalParamsHash(input.capabilityId, params);
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? 24 * 60 * 60 * 1000));

  // Reject-cooldown dedupe: the unique index only covers 'pending', so a
  // rejected or expired proposal would let the escalation hook re-propose
  // the identical action every cycle — a prompt-churn loop. A declined
  // (key,hash) blocks re-proposal for 24h.
  const recent = await pool.query(
    `SELECT id, status FROM heidi_action_proposals
     WHERE producer_key=$1 AND params_hash=$2
       AND status IN ('pending','rejected','expired','approved')
       AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [input.producerKey, paramsHash],
  );
  if (recent.rows[0]) return { id: recent.rows[0].id as string, existing: true };

  try {
    const res = await pool.query(
      `INSERT INTO heidi_action_proposals
         (capability_id, params, params_hash, title, reason,
          expected_effects, risks, prerequisites, rollback, reversible,
          producer_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [input.capabilityId, JSON.stringify(params), paramsHash,
      input.title, input.reason,
      input.expectedEffects ?? null, input.risks ?? null,
      input.prerequisites ?? null, input.rollback ?? null,
      input.reversible ?? false, input.producerKey, expiresAt.toISOString()],
    );
    const id = res.rows[0].id as string;
    await pool.query(
      `INSERT INTO heidi_events (event_type, division, payload, created_at)
       VALUES ('action_proposal', 'missions', $1, now())`,
      [JSON.stringify({
        receiptId: randomUUID(), event: 'proposed', proposalId: id,
        capabilityId: input.capabilityId, paramsHash, producerKey: input.producerKey,
        expiresAt: expiresAt.toISOString(), at: new Date().toISOString(),
      })],
    );
    return { id, existing: false };
  } catch (e) {
    // Pending-dedupe unique index → fetch the existing proposal id.
    if ((e as { code?: string }).code === '23505') {
      const existing = await pool.query(
        `SELECT id FROM heidi_action_proposals
         WHERE producer_key=$1 AND params_hash=$2 AND status='pending'`,
        [input.producerKey, paramsHash],
      );
      if (existing.rows[0]) return { id: existing.rows[0].id as string, existing: true };
    }
    throw e;
  }
}

/** Lazy expiry + read. Returns the two panels: Recommended (pending &
 *  unexpired) and History (everything else, with mission join). */
export async function listProposals(pool: Pool): Promise<{
  recommended: ProposalRow[];
  history: ProposalRow[];
}> {
  await pool.query(
    `UPDATE heidi_action_proposals SET status='expired'
     WHERE status='pending' AND expires_at < now()`,
  );
  const res = await pool.query(
    `SELECT p.*, m.id AS mission_id, m.status AS mission_status, m.stage AS mission_stage
     FROM heidi_action_proposals p
     LEFT JOIN LATERAL (
       SELECT id, status, stage FROM heidi_missions
       WHERE goal_id = p.goal_id ORDER BY created_at DESC LIMIT 1
     ) m ON true
     ORDER BY p.created_at DESC LIMIT 100`,
  );
  const rows = res.rows as ProposalRow[];
  return {
    recommended: rows.filter(r => r.status === 'pending'),
    history: rows.filter(r => r.status !== 'pending'),
  };
}

export interface ResolveResult {
  ok: boolean;
  status?: 'approved' | 'rejected';
  goalId?: string;
  error?: string;
}

/** Approve or reject — consume-once, race-safe, expiry- and
 *  tamper-checked, transactionally bound to goal creation. */
export async function resolveProposal(
  pool: Pool,
  opts: { id: string; decision: 'approve' | 'reject'; decidedBy: string },
): Promise<ResolveResult> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (e) {
    return { ok: false, error: `database unavailable: ${e instanceof Error ? e.message : 'unknown'}` };
  }
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM heidi_action_proposals WHERE id=$1 FOR UPDATE`,
      [opts.id],
    );
    const row = cur.rows[0] as ProposalRow | undefined;
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Proposal not found' };
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, error: `Proposal already ${row.status} — approvals are consume-once` };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE heidi_action_proposals SET status='expired' WHERE id=$1`,
        [opts.id],
      );
      await client.query('COMMIT');
      return { ok: false, error: 'Proposal expired' };
    }
    // Recompute the binding from stored data — a row mutated after
    // proposal time fails here even before the conditional UPDATE.
    const recomputed = proposalParamsHash(row.capability_id, row.params ?? {});
    if (recomputed !== row.params_hash) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Proposal content changed — requires fresh approval' };
    }
    // The allowlist is re-checked at consume time, not just at create.
    const specError = validateProposalSpec(row.capability_id, row.params ?? {});
    if (specError) {
      await client.query('ROLLBACK');
      return { ok: false, error: `Proposal refused at consume time: ${specError}` };
    }

    if (opts.decision === 'reject') {
      const upd = await client.query(
        `UPDATE heidi_action_proposals
         SET status='rejected', decided_by=$2, decided_at=now()
         WHERE id=$1 AND status='pending' AND expires_at > now()
         RETURNING id`,
        [opts.id, opts.decidedBy],
      );
      if (!upd.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'Proposal no longer pending or has expired' };
      }
      await client.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at)
         VALUES ('action_proposal', 'missions', $1, now())`,
        [JSON.stringify({
          receiptId: randomUUID(), event: 'rejected', proposalId: opts.id,
          decidedBy: opts.decidedBy, paramsHash: row.params_hash,
          at: new Date().toISOString(),
        })],
      );
      await client.query('COMMIT');
      return { ok: true, status: 'rejected' };
    }

    // approve — atomic consume bound to the exact displayed hash
    const upd = await client.query(
      `UPDATE heidi_action_proposals
       SET status='approved', decided_by=$2, decided_at=now(), approved_hash=$3
       WHERE id=$1 AND status='pending' AND expires_at > now() AND params_hash=$3
       RETURNING id`,
      [opts.id, opts.decidedBy, row.params_hash],
    );
    if (!upd.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Approval lost the race or the proposal changed — fresh approval required' };
    }
    // Spawn the governed goal — the daemon's existing planner dispatches
    // it; nothing in this tx executes the capability itself.
    const goal = await client.query(
      `INSERT INTO heidi_goals
         (goal_type, title, description, purpose, priority, status, context)
       VALUES ('mission', $1, $2, $3, 4, 'pending', $4)
       RETURNING id`,
      [
        row.title,
        `Approved proposal ${row.id}. ${row.reason}`,
        row.expected_effects ?? row.reason,
        JSON.stringify({
          capabilityId: row.capability_id,
          capabilityParams: row.params ?? {},
          producerKey: `proposal:${row.id}`,
          proposalId: row.id,
          producedBy: 'heidi-action-proposals',
          producedAt: new Date().toISOString(),
          humanApproved: true,
          approvedBy: opts.decidedBy,
          approvedHash: row.params_hash,
          completeOnVerify: true,
          reason: `Human-approved proposal: ${row.reason}`,
        }),
      ],
    );
    const goalId = goal.rows[0].id as string;
    await client.query(
      `UPDATE heidi_action_proposals SET goal_id=$2 WHERE id=$1`,
      [opts.id, goalId],
    );
    await client.query(
      `INSERT INTO heidi_events (event_type, division, payload, created_at)
       VALUES ('action_proposal', 'missions', $1, now())`,
      [JSON.stringify({
        receiptId: randomUUID(), event: 'approved', proposalId: opts.id,
        decidedBy: opts.decidedBy, paramsHash: row.params_hash,
        goalId, capabilityId: row.capability_id,
        at: new Date().toISOString(),
      })],
    );
    await client.query('COMMIT');
    return { ok: true, status: 'approved', goalId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  } finally {
    client.release();
  }
}

/* ─── Approval → authorization bridge ───────────────────────────────
 * The daemon's authorization gate calls this when a capability is refused
 * human_required and the selected goal claims a proposal. Goal context
 * only carries the HINT (proposalId); every binding is re-verified
 * against the durable row — capability, exact params (hash recomputed
 * from the action's params, never the context's approvedHash), and the
 * goal the proposal itself minted. Consumption is a single conditional
 * UPDATE, so concurrent attempts can never both succeed and an approval
 * can never authorize twice.
 *
 * APPROVED ≠ AUTHORIZED: status stays 'approved'; authorization_consumed_at
 * is the once-only authorization marker, with a heidi_events receipt.
 */

export type ProposalAuthorizationRefusal =
  | 'not_found' | 'not_approved' | 'already_consumed'
  | 'capability_mismatch' | 'params_mismatch' | 'goal_mismatch' | 'unavailable';

export interface ProposalAuthorizationResult {
  authorized: boolean;
  reason: string;
  proposalId: string;
  refusal?: ProposalAuthorizationRefusal;
  consumedAt?: string;
  decidedBy?: string | null;
}

export async function consumeProposalAuthorization(
  pool: Pool,
  opts: { proposalId: string; capabilityId: string; params: Record<string, unknown>; goalId: string },
): Promise<ProposalAuthorizationResult> {
  // Recompute the binding from the ACTION's actual parameters — the
  // durable params_hash is the approval contract, not a browser- or
  // context-supplied value.
  const paramsHash = proposalParamsHash(opts.capabilityId, opts.params);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (e) {
    return { authorized: false, reason: `database unavailable: ${e instanceof Error ? e.message : 'unknown'}`, proposalId: opts.proposalId, refusal: 'unavailable' };
  }
  try {
    await client.query('BEGIN');
    // One atomic statement enforces every binding + consume-once.
    const res = await client.query(
      `UPDATE heidi_action_proposals
         SET authorization_consumed_at = now()
       WHERE id=$1 AND status='approved'
         AND capability_id=$2 AND params_hash=$3 AND goal_id=$4
         AND authorization_consumed_at IS NULL
       RETURNING id, decided_by, authorization_consumed_at`,
      [opts.proposalId, opts.capabilityId, paramsHash, opts.goalId],
    );
    if (!res.rows[0]) {
      await client.query('ROLLBACK');
      // Read-only classification of the refusal — honest reason, no guess.
      const cur = await client.query(
        `SELECT status, capability_id, params_hash, goal_id, authorization_consumed_at
         FROM heidi_action_proposals WHERE id=$1`,
        [opts.proposalId],
      );
      const row = cur.rows[0] as { status?: string; capability_id?: string; params_hash?: string; goal_id?: string; authorization_consumed_at?: string | null } | undefined;
      let refusal: ProposalAuthorizationRefusal; let reason: string;
      if (!row) {
        refusal = 'not_found'; reason = 'proposal not found in durable store';
      } else if (row.status !== 'approved') {
        refusal = 'not_approved'; reason = `proposal status is '${row.status}' — only an approved proposal can authorize`;
      } else if (row.authorization_consumed_at) {
        refusal = 'already_consumed'; reason = 'approval already consumed — a proposal authorizes once';
      } else if (row.capability_id !== opts.capabilityId) {
        refusal = 'capability_mismatch'; reason = `proposal approved '${row.capability_id}', not '${opts.capabilityId}'`;
      } else if (row.params_hash !== paramsHash) {
        refusal = 'params_mismatch'; reason = 'requested parameters differ from the approved parameters';
      } else {
        refusal = 'goal_mismatch'; reason = 'proposal is bound to a different goal';
      }
      return { authorized: false, reason, proposalId: opts.proposalId, refusal };
    }
    const row = res.rows[0] as { id: string; decided_by: string | null; authorization_consumed_at: string };
    await client.query(
      `INSERT INTO heidi_events (event_type, division, payload, created_at)
       VALUES ('action_proposal', 'missions', $1, now())`,
      [JSON.stringify({
        receiptId: randomUUID(), event: 'authorization_consumed',
        proposalId: opts.proposalId, goalId: opts.goalId,
        capabilityId: opts.capabilityId, paramsHash,
        decidedBy: row.decided_by, authorizedAt: row.authorization_consumed_at,
        at: new Date().toISOString(),
      })],
    );
    await client.query('COMMIT');
    return {
      authorized: true,
      reason: `human-authorized via durable proposal (approval consumed once)`,
      proposalId: opts.proposalId,
      consumedAt: row.authorization_consumed_at,
      decidedBy: row.decided_by,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    return { authorized: false, reason: e instanceof Error ? e.message : 'unknown', proposalId: opts.proposalId, refusal: 'unavailable' };
  } finally {
    client.release();
  }
}

/** Shared pool for the API surface — same env convention as
 *  lib/orchestrator.ts (PG_HOST/PG_PORT/PG_DATABASE/PG_USER/PG_PASSWORD,
 *  defaults to the local Supabase Postgres). */
let _pool: Pool | null = null;
export function getProposalPool(): Pool {
  if (!_pool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as typeof import('pg');
    _pool = new Pool({
      host: process.env.PG_HOST || '127.0.0.1',
      port: parseInt(process.env.PG_PORT || '54322', 10),
      database: process.env.PG_DATABASE || 'postgres',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      max: 2,
      idleTimeoutMillis: 5000,
    });
  }
  return _pool;
}
