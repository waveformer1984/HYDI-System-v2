/**
 * HEIDI Mission Ledger — mission integrity slice 1.
 *
 * Durable mission identity + atomic claim. A mission row in
 * `heidi_missions` is the execution-instance record of a piece of work;
 * heidi_goals remains intent. The claim transaction is the authority —
 * an in-process in-flight map is only a fast-path guard.
 *
 * Claim semantics:
 *   INSERT … ON CONFLICT (idempotency_key) DO NOTHING
 *     → fresh row: claimed, generation 1
 *   conflict → locked (FOR UPDATE) conditional re-claim allowed ONLY
 *     from: 'planned' (never dispatched) or the terminal-retriable set
 *     'cancelled' | 'timed_out' | 'failed'.
 *   NOT re-claimable: 'succeeded' (terminal-done), 'waiting_human'
 *   (governed resume — separate slice), and ANY transitional status
 *   ('claimed'/'running'/'verifying') — even with an expired lease.
 *   An expired lease does not prove the old worker stopped producing
 *   side effects; expired transitional rows refuse as 'stale_claim' and
 *   are left for the supervised-recovery sweep.
 *   The initial execution receipt (DISPATCHED, stream 'execution') is
 *   written in the SAME transaction as the claim — both durable or neither.
 *
 * Receipt compatibility: receipt missionId is the mission row id — an
 * independent UUID. goal_id joins to intent; legacy receipts keyed by
 * goal id remain valid historical evidence for pre-table missions.
 * Receipts carry claim_generation and attempt so evidence is
 * attributable per claim.
 */

import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';

export type MissionClaimReason =
  | 'already_claimed'
  | 'stale_claim'   // transitional status with expired lease — needs
  // supervised recovery (sweep slice), NOT re-claimable
  | 'awaiting_human'
  | 'terminal'
  | 'invalid_input'  // caller bug (e.g. non-uuid goalId) — not a DB state
  | 'unavailable';

export type MissionStatus =
  | 'planned' | 'claimed' | 'running' | 'verifying'
  | 'waiting_human'
  | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export const TERMINAL_STATUSES: readonly MissionStatus[] =
  ['succeeded', 'failed', 'cancelled', 'timed_out'];

/**
 * Allowed predecessor statuses per transition() target. The claim
 * transaction owns 'claimed' (via the idempotency-key UPDATE), so it is
 * deliberately absent here — a plain transition can never mint a claim.
 * Anything not listed (or not matching the current status) is fenced.
 */
export const LEGAL_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  claimed: [],                                    // claim() owns this
  running: ['claimed'],
  verifying: ['running'],
  succeeded: ['verifying'],
  failed: ['running', 'verifying'],
  planned: ['claimed', 'running'],                // claim-release, transient requeue
  waiting_human: ['running'],
  cancelled: ['planned', 'claimed', 'running', 'verifying', 'waiting_human'],
  timed_out: ['claimed', 'running', 'verifying'], // lease sweep only
};

export interface TransitionInput {
  toStatus: MissionStatus;
  toStage: string;
  fromStage?: string | null;
  fromStatus?: MissionStatus | null;
  failureClass?: 'transient' | 'deterministic' | 'governance';
  attempt?: number;
  resultSummary?: string;
  evidence?: unknown;
  /** Extend the lease on this transition (heartbeat-style write). */
  leaseExtendMs?: number;
}

export interface TransitionResult {
  ok: boolean;
  /**
   * 'fenced' — claim_generation or status guard rejected the write: the
   * writer is stale and must stop producing effects.
   * 'error' — infrastructure failure (DB down, constraint violation):
   * also stops effects, but is NOT a staleness verdict and is surfaced
   * separately in telemetry.
   */
  reason?: 'fenced' | 'error';
  error?: string;
}

export interface MissionClaimResult {
  claimed: boolean;
  missionId: string | null;
  claimGeneration: number | null;
  attempt: number | null;
  reason?: MissionClaimReason;
}

export interface ClaimInput {
  /** Optional caller-provided id. Defaults to a fresh UUID — mission rows
   *  are execution instances with independent identity; one goal can own
   *  several missions whose logical work keys differ. */
  missionId?: string;
  /** heidi_goals.id — must be a uuid or omitted (infra/operational
   *  missions are allowed without a goal). A non-uuid value is rejected
   *  up-front rather than hitting a Postgres 22P02 mid-transaction. */
  goalId?: string;
  producerKey: string;
  capabilityId?: string;
  params?: Record<string, unknown>;
  /**
   * Stable identity of the logical work (e.g. opportunity_id, cycle_id).
   * Retries share it; an intentional new run must supply a new slot.
   */
  workSlot: string;
  claimedBy: string;
  leaseMs?: number;
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic key sort so {a:1,b:2} and {b:2,a:1} hash identically. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function computeIdempotencyKey(input: {
  goalId?: string;
  producerKey: string;
  capabilityId?: string;
  params?: Record<string, unknown>;
  workSlot: string;
}): string {
  const identity = [
    input.goalId ?? input.producerKey,
    input.capabilityId ?? '',
    input.params ? stableStringify(input.params) : '',
    input.workSlot,
  ].join('|');
  return createHash('sha256').update(identity).digest('hex');
}

export class MissionLedger {
  private pool: Pool;
  private actor: string;

  constructor(pool: Pool, actor = 'heidi-daemon') {
    this.pool = pool;
    this.actor = actor;
  }

  /**
   * Atomically claim a mission and write its first execution receipt.
   * Throws if the transaction fails; callers decide whether that degrades
   * dispatch (fail-open legacy path) or fails the dispatch (fail-closed).
   */
  async claim(input: ClaimInput): Promise<MissionClaimResult> {
    // Validate uuid-typed columns before touching the DB — a malformed
    // goalId/missionId is a caller bug, not a claim conflict; refuse
    // honestly instead of surfacing a raw 22P02.
    if (input.goalId !== undefined && !UUID_RE.test(input.goalId)) {
      return { claimed: false, missionId: null, claimGeneration: null, attempt: null, reason: 'invalid_input' };
    }
    if (input.missionId !== undefined && !UUID_RE.test(input.missionId)) {
      return { claimed: false, missionId: null, claimGeneration: null, attempt: null, reason: 'invalid_input' };
    }
    const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
    const missionId = input.missionId ?? randomUUID();
    const key = computeIdempotencyKey(input);
    const paramsHash = input.params
      ? createHash('sha256').update(stableStringify(input.params)).digest('hex')
      : null;
    const receiptId = randomUUID();
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Fast path: fresh mission row.
      const ins = await client.query(
        `INSERT INTO heidi_missions
           (id, goal_id, idempotency_key, producer_key, capability_id, params_hash,
            status, stage, attempt, claim_generation, claimed_by, claimed_at, lease_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'claimed','DISPATCHED',1,1,$7,now(),now()+($8||' milliseconds')::interval)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, attempt, claim_generation`,
        [missionId, input.goalId ?? null, key, input.producerKey,
          input.capabilityId ?? null, paramsHash, input.claimedBy, String(leaseMs)],
      );

      let claimed = ins.rows[0] as { id: string; attempt: number; claim_generation: number } | undefined;
      let prior: { status: string; stage: string | null; attempt: number; claim_generation: number } | null = null;

      if (!claimed) {
        // Same logical work — lock the row and read its ACTUAL prior
        // state before re-claiming. FOR UPDATE serializes concurrent
        // claimants; the receipt below records where it came from, not a
        // fabricated PLANNED baseline.
        const locked = await client.query(
          `SELECT id, status, stage, attempt, claim_generation, lease_expires_at
           FROM heidi_missions WHERE idempotency_key=$1 FOR UPDATE`,
          [key],
        );
        const row = locked.rows[0] as
          | {
            id: string; status: string; stage: string | null; attempt: number;
            claim_generation: number; lease_expires_at: string | null
          }
          | undefined;

        // Re-claim ONLY from safe states:
        //   planned (never dispatched) or a terminal-retriable state.
        // Transitional states are NEVER re-claimed here — an expired lease
        // does not imply the old worker stopped producing side effects, and
        // fencing of capability effects is not yet in place. Expired
        // transitional rows are reported ('stale_claim') for the supervised
        // recovery sweep instead of silently handed to a new executor.
        if (row && ['planned', 'cancelled', 'timed_out', 'failed'].includes(row.status)) {
          const upd = await client.query(
            `UPDATE heidi_missions SET
               status='claimed', stage='DISPATCHED',
               attempt=attempt+1, claim_generation=claim_generation+1,
               claimed_by=$2, claimed_at=now(),
               lease_expires_at=now()+($3||' milliseconds')::interval
             WHERE idempotency_key=$1
               AND status IN ('planned','cancelled','timed_out','failed')
             RETURNING id, attempt, claim_generation`,
            [key, input.claimedBy, String(leaseMs)],
          );
          claimed = upd.rows[0];
          if (claimed) {
            prior = {
              status: row.status, stage: row.stage,
              attempt: row.attempt, claim_generation: row.claim_generation,
            };
          }
        }

        if (!claimed) {
          // Honest refusal reason for the caller — computed from the
          // row we already locked and read.
          await client.query('ROLLBACK');
          const status = row?.status;
          const leaseExpired = row?.lease_expires_at
            ? new Date(row.lease_expires_at).getTime() < Date.now()
            : false;
          const reason: MissionClaimReason =
            status === 'waiting_human' ? 'awaiting_human'
              : status === 'succeeded' ? 'terminal'
                // terminal-retriable states reaching refusal means a
                // concurrent claim won the race — honestly 'already_claimed'
                : status && leaseExpired && !TERMINAL_STATUSES.includes(status as MissionStatus)
                  ? 'stale_claim'
                  : status ? 'already_claimed'
                    : 'unavailable';
          return { claimed: false, missionId: null, claimGeneration: null, attempt: null, reason };
        }
      }

      // Initial execution receipt in the same transaction. On a re-claim
      // this is a RETRY transition: the prior attempt's status/stage are
      // preserved as the from-state so retry history isn't rewritten —
      // a failed→claimed receipt reads as a retry of failed work, not a
      // fresh mission.
      const missionStatusToReceipt: Record<string, string> = {
        planned: 'pending', cancelled: 'cancelled',
        timed_out: 'cancelled', failed: 'failed', succeeded: 'completed',
        waiting_human: 'escalated',
      };
      await client.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at)
         VALUES ('mission_transition', 'missions', $1, now())`,
        [JSON.stringify({
          receiptId,
          missionId: claimed.id,
          fromStatus: prior ? (missionStatusToReceipt[prior.status] ?? prior.status) : 'pending',
          toStatus: 'in_progress',
          fromStage: prior ? prior.stage : 'PLANNED',
          toStage: 'DISPATCHED',
          stream: 'execution',
          attempt: claimed.attempt,
          claimGeneration: claimed.claim_generation,
          actor: this.actor,
          evidence: {
            capabilityId: input.capabilityId,
            producerKey: input.producerKey,
            goalId: input.goalId ?? null,
            workSlot: input.workSlot,
            ...(prior ? {
              retryOf: {
                status: prior.status, stage: prior.stage,
                attempt: prior.attempt, claimGeneration: prior.claim_generation,
              },
            } : {}),
          },
          at: new Date().toISOString(),
        })],
      );

      await client.query('COMMIT');
      return {
        claimed: true,
        missionId: claimed.id,
        claimGeneration: claimed.claim_generation,
        attempt: claimed.attempt,
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { });
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Fenced lifecycle write: update the mission row AND append the
   * transition receipt in one transaction — both or neither.
   *
   * Conditional on (missionId, claim_generation) AND the transition being
   * LEGAL_TRANSITIONS-legal from the current status — which also implies
   * non-terminal, since terminal states are legal predecessors of
   * nothing. A stale generation, an already-settled mission, or an
   * illegal jump (e.g. claimed→succeeded) gets {ok:false, reason:'fenced'}
   * and the writer must stop producing effects.
   */
  async transition(
    missionId: string,
    claimGeneration: number,
    t: TransitionInput,
  ): Promise<TransitionResult> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE heidi_missions SET
           status=$1, stage=$2,
           failure_class=COALESCE($3, failure_class),
           result_summary=COALESCE($4, result_summary),
           lease_expires_at=CASE WHEN $5::bigint IS NULL THEN lease_expires_at
                                 ELSE now()+($5||' milliseconds')::interval END
         WHERE id=$6 AND claim_generation=$7
           AND status = ANY($8::text[])
         RETURNING attempt, claim_generation`,
        [t.toStatus, t.toStage, t.failureClass ?? null, t.resultSummary ?? null,
        t.leaseExtendMs != null ? String(t.leaseExtendMs) : null,
          missionId, claimGeneration,
        [...(LEGAL_TRANSITIONS[t.toStatus] ?? [])]],
      );
      if (!upd.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'fenced' };
      }
      const gen = upd.rows[0].claim_generation as number;
      const attempt = upd.rows[0].attempt as number;
      await client.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at)
         VALUES ('mission_transition', 'missions', $1, now())`,
        [JSON.stringify({
          receiptId: randomUUID(),
          missionId,
          fromStatus: t.fromStatus ?? 'in_progress',
          toStatus: t.toStatus === 'succeeded' ? 'completed'
            : t.toStatus === 'waiting_human' ? 'escalated'
              : t.toStatus === 'failed' ? 'failed'
                : t.toStatus === 'planned' ? 'pending' : 'in_progress',
          fromStage: t.fromStage ?? null,
          toStage: t.toStage,
          stream: 'execution',
          attempt: t.attempt ?? attempt,
          claimGeneration: gen,
          failureClass: t.failureClass,
          actor: this.actor,
          evidence: t.evidence,
          at: new Date().toISOString(),
        })],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { });
      // Infrastructure failure — distinct from a stale-generation fence.
      // The caller stops producing effects either way, but telemetry and
      // diagnostics must not mislabel a DB outage as staleness.
      return {
        ok: false, reason: 'error',
        error: e instanceof Error ? e.message : 'unknown',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Terminal or waiting settle — same fencing semantics as transition().
   * After this succeeds with a terminal status, no further write can
   * alter the mission row (the status guard closes it).
   */
  async finalize(
    missionId: string,
    claimGeneration: number,
    t: TransitionInput,
  ): Promise<TransitionResult> {
    return this.transition(missionId, claimGeneration, t);
  }

  /**
   * Stale-claim sweep — bounded, idempotent, worker-verified.
   *
   * Eligible: transitional ('claimed'|'running'|'verifying') with an
   * expired lease. For each candidate the recorded worker identity
   * (`claimed_by = "<actor>@<host>:<pid>"`) is checked BEFORE settling:
   *   - pid alive            → leave untouched (worker legitimately busy)
   *   - pid dead (same host) → fence + settle 'timed_out'/'INTERRUPTED'
   *     with the recovery receipt in ONE transaction
   *   - unparseable / foreign host → AMBIGUOUS: row untouched, surfaced
   *     in `suspects` + one batched `mission_sweep` evidence event.
   *
   * Fencing: the settle increments claim_generation, so a zombie worker
   * that somehow wakes up can never write a valid transition afterwards
   * (and 'timed_out' is terminal anyway — legal predecessor of nothing).
   *
   * Never re-executes. Any DB error aborts that row's settle — the
   * mission stays transitional-pending for the next sweep rather than
   * being silently dropped or mis-settled.
   */
  async reconcileExpiredClaims(opts: SweepOptions): Promise<SweepResult> {
    const maxRows = opts.maxRows ?? 25;
    const result: SweepResult = {
      scanned: 0, interrupted: 0, alive: 0, ambiguous: 0, errors: 0,
      suspects: [],
    };

    // Eligibility scan — point-in-time snapshot; each settle re-verifies
    // the predicates inside its own transaction.
    let candidates: Array<{
      id: string; claim_generation: number; claimed_by: string | null;
      capability_id: string | null; status: string;
    }>;
    try {
      const scan = await this.pool.query(
        `SELECT id, claim_generation, claimed_by, capability_id, status
         FROM heidi_missions
         WHERE status IN ('claimed','running','verifying')
           AND lease_expires_at < now()
         ORDER BY lease_expires_at ASC
         LIMIT $1`,
        [maxRows],
      );
      candidates = scan.rows;
      result.scanned = candidates.length;
    } catch {
      result.errors++;
      return result;
    }

    for (const row of candidates) {
      // Worker identity check — "claimed_by" must carry <actor>@<host>:<pid>
      // and the host must be THIS host before we trust a pid liveness
      // check. Anything else is ambiguous: never settle on a guess.
      const m = /^(.+)@([^:@]+):(\d+)$/.exec(row.claimed_by ?? '');
      if (!m || m[2] !== opts.hostname) {
        result.ambiguous++;
        result.suspects.push(row.id);
        continue;
      }
      const pid = Number(m[3]);
      if (opts.isAlive(pid)) {
        result.alive++;   // lease expired but worker provably running — leave it
        continue;
      }

      // Worker confirmed dead on this host → fence + interrupt in one tx.
      let client: PoolClient;
      try {
        client = await this.pool.connect();
      } catch {
        result.errors++;
        continue;
      }
      try {
        await client.query('BEGIN');
        const upd = await client.query(
          `UPDATE heidi_missions SET
             status='timed_out', stage='INTERRUPTED',
             claim_generation=claim_generation+1,
             result_summary=$2
           WHERE id=$1 AND claim_generation=$3
             AND status IN ('claimed','running','verifying')
             AND lease_expires_at < now()
           RETURNING claim_generation`,
          [row.id,
          `interrupted: worker ${row.claimed_by} confirmed dead (pid ${pid}); ` +
          `lease expired — no side-effect verdict`.slice(0, 300),
          row.claim_generation],
        );
        if (!upd.rows[0]) {
          // Settled/consumed concurrently — idempotent no-op.
          await client.query('ROLLBACK');
          continue;
        }
        await client.query(
          `INSERT INTO heidi_events (event_type, division, payload, created_at)
           VALUES ('mission_transition', 'missions', $1, now())`,
          [JSON.stringify({
            receiptId: randomUUID(),
            missionId: row.id,
            fromStatus: 'in_progress',
            toStatus: 'cancelled',
            fromStage: row.status === 'claimed' ? 'DISPATCHED'
              : row.status === 'verifying' ? 'VERIFYING' : 'RUNNING',
            toStage: 'INTERRUPTED',
            stream: 'execution',
            claimGeneration: upd.rows[0].claim_generation,
            actor: this.actor,
            evidence: {
              interrupted: true, sweep: true,
              priorClaimGeneration: row.claim_generation,
              deadWorker: row.claimed_by, capabilityId: row.capability_id,
              note: 'capability outcome unproven — never auto-replayed',
            },
            at: new Date().toISOString(),
          })],
        );
        await client.query('COMMIT');
        result.interrupted++;
      } catch {
        await client.query('ROLLBACK').catch(() => { });
        result.errors++;
      } finally {
        client.release();
      }
    }

    // Ambiguous rows get ONE batched evidence event per sweep — visible
    // pending-reconciliation without mutating the mission rows and
    // without per-run spam per row.
    if (result.suspects.length > 0) {
      await this.pool.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at)
         VALUES ('mission_sweep', 'missions', $1, now())`,
        [JSON.stringify({
          suspects: result.suspects,
          reason: 'worker identity unverifiable — pending reconciliation',
          actor: this.actor,
          at: new Date().toISOString(),
        })],
      ).catch(() => { });
    }

    return result;
  }
}

export interface SweepOptions {
  /** Max rows per run — bounded work per invocation. */
  maxRows?: number;
  /** This machine's hostname — only same-host worker pids are checkable. */
  hostname: string;
  /** Liveness probe — injectable for tests; production wraps
   *  `process.kill(pid, 0)` (throws ESRCH = dead, EPERM = alive). */
  isAlive: (pid: number) => boolean;
}

export interface SweepResult {
  /** Expired transitional rows considered this run. */
  scanned: number;
  /** Settled to timed_out/INTERRUPTED after dead-worker verification. */
  interrupted: number;
  /** Lease expired but the recorded pid is still alive — untouched. */
  alive: number;
  /** Worker identity unverifiable — untouched, surfaced in suspects. */
  ambiguous: number;
  /** Persistence/settle failures — row left transitional. */
  errors: number;
  /** Mission ids that need human/supervised reconciliation. */
  suspects: string[];
}
