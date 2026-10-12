/**
 * HEIDI Mission Runner — HYDI 4, Phase G
 *
 * Separates decision latency from execution latency. The cognitive cycle
 * dispatches a mission and returns immediately; the runner executes it in
 * the background, writes lifecycle receipts as it goes, and settles the
 * goal row when the work finishes.
 *
 *   cycle:  plan → authorize → dispatch → record   (<30s always)
 *   runner: DISPATCHED → RUNNING → SUCCEEDED|FAILED → classified
 *
 * Guarantees:
 *   - No duplicate execution: an in-flight goalId is never dispatched
 *     twice, and the goal row's in_progress status makes it invisible to
 *     the planner until it settles.
 *   - Bounded concurrency: maxConcurrent dispatches run at once; extras
 *     stay queued for future cycles (capacity is honest, not queued
 *     silently).
 *   - Restart honesty: on startup, goals left in_progress by a dead
 *     process are reconciled to blocked('interrupted') — never silently
 *     dropped, never assumed done.
 *   - Failure classification: transient failures retry (bounded attempts
 *     tracked in goal.context.attempt); deterministic and governance
 *     failures go terminal — governance failures escalate.
 */

import type { Pool } from 'pg';
import { hostname } from 'os';
import type { GoalSystem, GoalStatus } from './GoalSystem';
import type { CapabilityRegistry, CapabilityExecutionContext } from './CapabilityRegistry';
import { MissionLifecycle, classifyFailure, type MissionStage } from './MissionLifecycle';
import { MissionLedger } from './MissionLedger';

export interface DispatchResult {
  dispatched: boolean;
  goalId: string;
  reason?: string;
  missionId?: string;
  claimGeneration?: number;
}

export interface RunnerStats {
  running: number;
  maxConcurrent: number;
  inflightGoalIds: string[];
  /** True when the runner is explicitly configured to fall back to the
   *  legacy events-only claim path if heidi_missions is unavailable.
   *  Exposed so health/telemetry can show degraded-dedup posture. */
  legacyDispatchAllowed: boolean;
  /** Claim-layer health: refused claims and ledger errors are surfaced
   *  rather than hidden behind a healthy-looking dispatched:false. */
  claimRefusals: number;
  claimErrors: number;
  lastClaimError: string | null;
  /** Goals settled as reconciliation_pending because the mission-row
   *  write failed — work outcome unproven, needs operator eyes. */
  reconcilePending: number;
  /** Dispatches blocked before any capability effect could run — the
   *  mission could not be durably recorded as running, so work was
   *  refused rather than executed untracked. */
  dispatchBlocked: number;
  /** Reconciliation/goal persistence itself failed — nothing durable
   *  records the uncertainty. Highest-severity telemetry. */
  persistFailures: number;
  /** Stale-claim sweep counters — visibility into dead-worker
   *  reclamation without needing to query the DB. */
  sweepRuns: number;
  sweepInterrupted: number;
  sweepAmbiguous: number;
  sweepErrors: number;
  lastSweepAt: string | null;
}

export class MissionRunner {
  private pool: Pool;
  private goals: GoalSystem;
  private registry: CapabilityRegistry;
  private lifecycle: MissionLifecycle;
  private ledger: MissionLedger;
  private actor = 'heidi-daemon';
  private maxConcurrent: number;
  private maxAttempts: number;
  private allowLegacyDispatch: boolean;
  private inFlight = new Map<string, Promise<void>>();
  private claimRefusals = 0;
  private claimErrors = 0;
  private lastClaimError: string | null = null;
  private reconcilePending = 0;
  private dispatchBlocked = 0;
  private persistFailures = 0;
  private sweepRuns = 0;
  private sweepInterrupted = 0;
  private sweepAmbiguous = 0;
  private sweepErrors = 0;
  private lastSweepAt: string | null = null;
  private liveness: (pid: number) => boolean;

  constructor(opts: {
    pool: Pool;
    goals: GoalSystem;
    registry: CapabilityRegistry;
    lifecycle: MissionLifecycle;
    ledger?: MissionLedger;
    /**
     * Explicit opt-in: when true, a heidi_missions outage falls back to
     * the legacy events-only claim path (no durable dedup/fencing).
     * Default false — a claim failure refuses dispatch honestly.
     */
    allowLegacyDispatch?: boolean;
    maxConcurrent?: number;
    maxAttempts?: number;
    /** Worker liveness probe for the stale-claim sweep. Injectable for
     *  tests; default is process.kill(pid, 0) — ESRCH = dead. */
    isAlive?: (pid: number) => boolean;
  }) {
    this.pool = opts.pool;
    this.goals = opts.goals;
    this.registry = opts.registry;
    this.lifecycle = opts.lifecycle;
    this.ledger = opts.ledger ?? new MissionLedger(opts.pool);
    this.maxConcurrent = opts.maxConcurrent ?? 3;
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.allowLegacyDispatch = opts.allowLegacyDispatch ?? false;
    this.liveness = opts.isAlive ?? ((pid: number) => {
      try { process.kill(pid, 0); return true; }   // exists
      catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
    });
  }

  stats(): RunnerStats {
    return {
      running: this.inFlight.size,
      maxConcurrent: this.maxConcurrent,
      inflightGoalIds: [...this.inFlight.keys()],
      legacyDispatchAllowed: this.allowLegacyDispatch,
      claimRefusals: this.claimRefusals,
      claimErrors: this.claimErrors,
      lastClaimError: this.lastClaimError,
      reconcilePending: this.reconcilePending,
      dispatchBlocked: this.dispatchBlocked,
      persistFailures: this.persistFailures,
      sweepRuns: this.sweepRuns,
      sweepInterrupted: this.sweepInterrupted,
      sweepAmbiguous: this.sweepAmbiguous,
      sweepErrors: this.sweepErrors,
      lastSweepAt: this.lastSweepAt,
    };
  }

  /**
   * Dispatch a mission goal for background execution. Returns quickly —
   * the caller gets a DispatchResult, not the mission outcome.
   */
  async dispatch(
    goalId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    ctx: CapabilityExecutionContext,
    workSlot?: string,
  ): Promise<DispatchResult> {
    if (this.inFlight.has(goalId)) {
      return { dispatched: false, goalId, reason: 'already_running' };
    }
    if (this.inFlight.size >= this.maxConcurrent) {
      return { dispatched: false, goalId, reason: `concurrency_cap:${this.maxConcurrent}` };
    }

    // Synchronous reservation FIRST — the check-then-set window between
    // inFlight.has() above and a later inFlight.set() is where the
    // duplicate-execution race lived: two concurrent dispatches could both
    // pass the check before either awaited claim completed. The map is a
    // performance fast-path only; the durable claim below is the authority.
    let releaseSlot!: () => void;
    const slot = new Promise<void>((r) => { releaseSlot = r; });
    this.inFlight.set(goalId, slot);

    // Atomic durable claim: mission row + DISPATCHED receipt in one
    // transaction. FAIL CLOSED by default — a claim error refuses the
    // dispatch honestly rather than silently falling back to unfenced
    // execution. The legacy events-only path runs only when the operator
    // explicitly opts in via allowLegacyDispatch (visible in stats()).
    let missionId: string;
    let claimGeneration: number | undefined;
    try {
      const claim = await this.ledger.claim({
        goalId,
        producerKey: 'mission_runner',
        capabilityId,
        params,
        // workSlot distinguishes logical runs of the same goal's work:
        // default (goalId) = one mission per goal, retries re-claim the
        // row; a caller requesting a deliberate fresh run passes a new
        // slot → new idempotency key → new mission row.
        workSlot: workSlot ?? goalId,
        // Worker identity carries host+pid so the stale-claim sweep can
        // verify "dead worker" before interrupting — a bare actor name
        // would be ambiguous evidence.
        claimedBy: `${this.actor}@${hostname()}:${process.pid}`,
      });
      if (!claim.claimed || !claim.missionId) {
        this.claimRefusals++;
        this.lastClaimError = `refused:${claim.reason ?? 'unknown'}`;
        this.inFlight.delete(goalId);
        releaseSlot();
        return { dispatched: false, goalId, reason: `claim_refused:${claim.reason ?? 'unknown'}` };
      }
      missionId = claim.missionId;
      claimGeneration = claim.claimGeneration ?? undefined;
    } catch (e) {
      const code = (e as { code?: string }).code;
      this.claimErrors++;
      this.lastClaimError = code ?? (e instanceof Error ? e.message : 'unknown');
      if (!this.allowLegacyDispatch) {
        this.inFlight.delete(goalId);
        releaseSlot();
        return {
          dispatched: false, goalId,
          reason: `claim_unavailable:${code ?? (e instanceof Error ? e.message : 'unknown')}`,
        };
      }
      missionId = goalId;
      await this.lifecycle.recordTransition({
        missionId,
        fromStatus: 'pending',
        toStatus: 'in_progress',
        fromStage: 'PLANNED',
        toStage: 'DISPATCHED',
        evidence: { capabilityId, params, legacyClaim: true, claimError: code },
      }).catch(() => { });
    }

    // Claim the goal row (intent status) so the planner can't re-select it.
    // Protected path: if this write fails, the placeholder MUST leave
    // inFlight (else the goal is wedged 'already_running' forever) and the
    // claimed mission row must not be silently stranded — best-effort
    // release it back to 'planned' so a later claim can retry cleanly.
    const goalOk = await this.goals.updateGoal(goalId, { status: 'in_progress' })
      .then(() => true).catch(() => false);
    if (!goalOk) {
      this.dispatchBlocked++;
      this.lastClaimError = `goal-claim:updateGoal failed for ${goalId}`.slice(0, 300);
      // Release the durable claim — mission back to 'planned' (retryable).
      // Best-effort: if persistence is failing broadly this may also fail;
      // the mission lease then expires into stale_claim → supervised sweep.
      if (claimGeneration !== undefined) {
        const rel = await this.ledger.transition(missionId, claimGeneration, {
          toStatus: 'planned', toStage: 'RECOVERING', fromStage: 'DISPATCHED',
          evidence: { reason: 'goal_update_failed', goalId, dispatchBlocked: true },
        }).catch(() => ({ ok: false as const }));
        if (!rel.ok) {
          this.persistFailures++;
          this.lastClaimError = `goal-claim:claim release also failed for mission ${missionId}`.slice(0, 300);
        }
      }
      this.inFlight.delete(goalId);
      releaseSlot();
      return { dispatched: false, goalId, missionId, reason: 'goal_claim_failed' };
    }

    const work = this.run(missionId, goalId, capabilityId, params, ctx, claimGeneration);
    this.inFlight.set(goalId, work);
    releaseSlot();
    work.finally(() => this.inFlight.delete(goalId)).catch(() => { });
    return { dispatched: true, goalId, missionId, claimGeneration };
  }

  /**
   * The actual background execution. Failures are classified —
   * transient failures bounded-retry, deterministic/governance go
   * terminal. Never throws; every path writes a receipt.
   */
  private async run(
    missionId: string,
    goalId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    ctx: CapabilityExecutionContext,
    claimGeneration?: number,
  ): Promise<void> {
    // Ledger mode is on iff this dispatch holds a durable claim
    // (claimGeneration set). Legacy mode (explicit opt-in only) writes
    // event-only receipts and cannot be fenced — visible in stats().
    const ledgerMode = claimGeneration !== undefined;
    const claimCtx = { claimGeneration: claimGeneration ?? null, goalId };

    // A blocked lifecycle write stops the mission — fenced (stale
    // generation) or error (infrastructure) alike — distinguished in the
    // diagnostic receipt so a DB outage is never misreported as staleness.
    // 'pre_execution': capability work provably never ran → the goal is
    //   marked dispatch_blocked (a refused dispatch, not an uncertain
    //   outcome).
    // 'post_execution': capability work may already have produced side
    //   effects → the goal is marked reconciliation_pending (outcome
    //   unproven); if even that write fails, persistFailures records that
    //   NOTHING durable captures the uncertainty.
    const blockedWrite = async (
      reason: 'fenced' | 'error',
      phase: 'pre_execution' | 'post_execution',
      detail?: string,
    ): Promise<void> => {
      if (reason === 'error') {
        this.claimErrors++;
        this.lastClaimError = `transition:${detail ?? 'unknown'}`;
      }
      const receiptOk = await this.lifecycle.recordTransition({
        missionId,
        fromStatus: 'in_progress',
        toStatus: 'in_progress',
        fromStage: 'RUNNING',
        toStage: 'RUNNING',
        evidence: {
          [reason === 'fenced' ? 'fenced' : 'infraError']: true,
          detail, phase, ...claimCtx,
        },
      }).then(() => true).catch(() => false);
      if (!receiptOk) this.persistFailures++;

      if (phase === 'pre_execution') {
        this.dispatchBlocked++;
        const ok = await this.goals.updateGoal(goalId, {
          status: 'blocked',
          result: `dispatch_blocked: mission could not be durably recorded as running (${reason}${detail ? `: ${detail}` : ''}) — no capability effects produced`.slice(0, 500),
          evidence: [{ runner: 'mission_runner', missionId, dispatchBlocked: true, blockedReason: reason, at: new Date().toISOString() }],
        }).then(() => true).catch(() => false);
        if (!ok) {
          this.persistFailures++;
          this.lastClaimError = `goal-persist:dispatch_blocked write failed for ${goalId}`.slice(0, 300);
        }
      } else {
        this.reconcilePending++;
        const ok = await this.goals.updateGoal(goalId, {
          status: 'blocked',
          result: `reconciliation_pending: capability may have produced effects but mission state was not durably recorded (${reason}${detail ? `: ${detail}` : ''})`.slice(0, 500),
          evidence: [{ runner: 'mission_runner', missionId, reconciliationPending: true, blockedReason: reason, at: new Date().toISOString() }],
        }).then(() => true).catch(() => false);
        if (!ok) {
          this.persistFailures++;
          this.lastClaimError = `goal-persist:reconciliation_pending write failed for ${goalId}`.slice(0, 300);
        }
      }
    };

    if (ledgerMode) {
      const r = await this.ledger.transition(missionId, claimGeneration, {
        toStatus: 'running', toStage: 'RUNNING', fromStage: 'DISPATCHED',
        evidence: { capabilityId, goalId },
      });
      if (!r.ok) { await blockedWrite(r.reason ?? 'error', 'pre_execution', r.error); return; }
    } else {
      await this.lifecycle.recordTransition({
        missionId,
        fromStatus: 'in_progress',
        toStatus: 'in_progress',
        fromStage: 'DISPATCHED',
        toStage: 'RUNNING',
        evidence: { capabilityId, ...claimCtx },
      }).catch(() => { });
    }

    try {
      const result = await this.registry.execute(capabilityId, params, ctx);
      const succeeded = result.executed && result.outcome === 'success';

      if (succeeded) {
        if (ledgerMode) {
          const v = await this.ledger.transition(missionId, claimGeneration, {
            toStatus: 'verifying', toStage: 'VERIFYING', fromStage: 'RUNNING',
            evidence: { outcome: result.outcome, goalId },
          });
          if (!v.ok) { await blockedWrite(v.reason ?? 'error', 'post_execution', v.error); return; }
          // Terminal settle FIRST — the goal must not read 'completed'
          // unless the mission row + receipt committed. A failed finalize
          // marks the goal reconciliation-pending, never succeeded.
          const f = await this.ledger.finalize(missionId, claimGeneration, {
            toStatus: 'succeeded', toStage: 'SUCCEEDED', fromStage: 'VERIFYING',
            resultSummary: `success via ${capabilityId}`,
            evidence: { outcome: result.outcome, goalId },
          });
          if (!f.ok) {
            this.lastClaimError = `finalize:${f.reason}:${f.error ?? ''}`.slice(0, 300);
            await blockedWrite(f.reason ?? 'error', 'post_execution', `finalize failed: ${f.error ?? f.reason}`);
            return;
          }
        } else {
          await this.lifecycle.recordTransition({
            missionId,
            fromStatus: 'in_progress',
            toStatus: 'in_progress',
            fromStage: 'RUNNING',
            toStage: 'VERIFYING',
            evidence: { outcome: result.outcome, ...claimCtx },
          }).catch(() => { });
        }
        await this.goals.updateGoal(goalId, {
          status: 'completed',
          progress: 1.0,
          evidence: [{ runner: 'mission_runner', missionId, capabilityId, outcome: result.outcome, at: new Date().toISOString() }],
        });
      } else {
        await this.settleFailure(missionId, goalId, result.error ?? `outcome:${result.outcome}`, result.outcome === 'skipped', claimGeneration);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown';
      await this.settleFailure(missionId, goalId, reason, false, claimGeneration);
    }
  }

  /**
   * Settle a failed run per its classification:
   *   transient     → retry (pending) while attempts remain, else blocked
   *   deterministic → blocked (needs replan/repair, not a blind retry)
   *   governance    → escalated (human boundary)
   */
  private async settleFailure(
    missionId: string,
    goalId: string,
    reason: string,
    wasSkipped: boolean,
    claimGeneration?: number,
  ): Promise<void> {
    const cls = classifyFailure(reason);
    const goal = await this.goals.getGoal(goalId).catch(() => null);
    const attempt = ((goal?.context?.attempt as number) ?? 0) + 1;

    let toStatus: GoalStatus;
    let toStage: MissionStage;
    if (wasSkipped || cls === 'governance') {
      toStatus = 'escalated';
      toStage = 'ESCALATED';
    } else if (cls === 'transient' && attempt < this.maxAttempts) {
      toStatus = 'pending'; // back to the queue for a bounded retry
      toStage = 'RECOVERING';
    } else {
      toStatus = cls === 'transient' ? 'failed' : 'blocked';
      toStage = 'CLASSIFIED';
    }

    // Mission settle FIRST — the durable execution record commits before
    // the intent record moves. If it fails (fenced or infra), the goal is
    // marked reconciliation_pending, not the classified outcome — a later
    // reconciler can distinguish "the work failed" from "we can't prove
    // what the work did".
    let missionSettled = true;
    if (claimGeneration !== undefined) {
      const failureClass = wasSkipped ? 'governance' : cls;
      const settle =
        wasSkipped || cls === 'governance'
          ? this.ledger.finalize(missionId, claimGeneration, {
            toStatus: 'waiting_human', toStage: 'ESCALATED', fromStage: 'RUNNING',
            failureClass: 'governance', attempt,
            resultSummary: reason.slice(0, 300),
            evidence: { reason: reason.slice(0, 300), goalId },
          })
          : cls === 'transient' && attempt < this.maxAttempts
            ? this.ledger.transition(missionId, claimGeneration, {
              toStatus: 'planned', toStage: 'RECOVERING', fromStage: 'RUNNING',
              failureClass: 'transient', attempt,
              evidence: { reason: reason.slice(0, 300), goalId },
            })
            : this.ledger.finalize(missionId, claimGeneration, {
              toStatus: 'failed', toStage: 'FAILED', fromStage: 'RUNNING',
              failureClass, attempt,
              resultSummary: reason.slice(0, 300),
              evidence: { reason: reason.slice(0, 300), goalId },
            });
      const res = await settle;
      if (!res.ok) {
        missionSettled = false;
        this.reconcilePending++;
        this.lastClaimError = `settle:${res.reason}:${res.error ?? ''}`.slice(0, 300);
      }
    }

    const goalStatus: GoalStatus = missionSettled ? toStatus : 'blocked';
    const goalOk = await this.goals.updateGoal(goalId, {
      status: goalStatus,
      result: (missionSettled
        ? `${cls}: ${reason}`
        : `reconciliation_pending: mission settle failed — outcome unproven (${reason.slice(0, 200)})`
      ).slice(0, 500),
      context: { ...(goal?.context ?? {}), attempt, lastFailureClass: cls, lastFailureAt: new Date().toISOString() },
      evidence: [{
        runner: 'mission_runner', missionId, failureClass: cls, attempt,
        reason: reason.slice(0, 200),
        ...(missionSettled ? {} : { reconciliationPending: true }),
      }],
    }).then(() => true).catch(() => false);
    if (!goalOk) {
      // Even the honest-state write failed — the mission's end state is
      // now recorded nowhere durable. Highest-severity telemetry only.
      this.persistFailures++;
      this.lastClaimError = `goal-persist:settle write failed for ${goalId}`.slice(0, 300);
    }

    // Event-only status receipt — LEGACY MODE ONLY. In ledger mode the
    // mission row update already appended its receipt inside the same
    // transaction; a second recordTransition would double the terminal
    // event. When the ledger settle failed the diagnostic is the
    // reconciliation_pending goal row itself — emitting a receipt for a
    // settle that didn't commit would be false evidence.
    if (claimGeneration === undefined) {
      await this.lifecycle.recordTransition({
        missionId,
        fromStatus: 'in_progress',
        toStatus: missionSettled ? toStatus : 'blocked',
        fromStage: 'RUNNING',
        toStage: missionSettled ? toStage : 'CLASSIFIED',
        failureClass: wasSkipped ? 'governance' : cls,
        attempt,
        evidence: {
          reason: reason.slice(0, 300),
          claimGeneration: null, goalId,
        },
      }).catch(() => { });
    }
  }

  /**
   * Stale-claim sweep: find expired transitional mission claims, verify
   * the recorded worker (host+pid in claimed_by) is actually dead, then
   * fence + interrupt in one transaction. Never re-executes work; rows
   * with unverifiable worker identity stay untouched and are surfaced
   * via stats()/suspects for supervised reconciliation.
   * Safe to call on every daemon cycle — bounded by maxRows, idempotent.
   */
  async sweepStaleClaims(maxRows = 25): Promise<void> {
    try {
      const r = await this.ledger.reconcileExpiredClaims({
        maxRows,
        hostname: hostname(),
        isAlive: this.liveness,
      });
      this.sweepRuns++;
      this.sweepInterrupted += r.interrupted;
      this.sweepAmbiguous += r.ambiguous;
      this.sweepErrors += r.errors;
      this.lastSweepAt = new Date().toISOString();
      if (r.errors > 0 || r.ambiguous > 0) {
        this.lastClaimError =
          `sweep: ${r.interrupted} interrupted, ${r.ambiguous} ambiguous, ${r.errors} errors`;
      }
    } catch (e) {
      this.sweepErrors++;
      this.lastClaimError = `sweep:${e instanceof Error ? e.message : 'unknown'}`.slice(0, 300);
    }
  }

  /**
   * Startup reconciliation: goals left in_progress by a dead process are
   * orphans — the work they represent is gone. Mark them blocked with an
   * honest reason and a receipt; the producer/escalation chain decides
   * what to do next.
   */
  async reconcileOrphans(): Promise<number> {
    const orphans = await this.pool.query(
      `SELECT id FROM heidi_goals WHERE status = 'in_progress'`,
    );
    let reconciled = 0;
    for (const row of orphans.rows as Array<{ id: string }>) {
      if (this.inFlight.has(row.id)) continue;
      await this.goals.updateGoal(row.id, {
        status: 'blocked',
        result: 'interrupted: process restart orphaned an in-progress mission',
      });
      reconciled++;
    }
    return reconciled;
  }
}
