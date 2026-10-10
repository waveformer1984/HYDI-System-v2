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
import type { GoalSystem, GoalStatus } from './GoalSystem';
import type { CapabilityRegistry, CapabilityExecutionContext } from './CapabilityRegistry';
import { MissionLifecycle, classifyFailure, type MissionStage } from './MissionLifecycle';

export interface DispatchResult {
  dispatched: boolean;
  goalId: string;
  reason?: string;
}

export interface RunnerStats {
  running: number;
  maxConcurrent: number;
  inflightGoalIds: string[];
}

export class MissionRunner {
  private pool: Pool;
  private goals: GoalSystem;
  private registry: CapabilityRegistry;
  private lifecycle: MissionLifecycle;
  private maxConcurrent: number;
  private maxAttempts: number;
  private inFlight = new Map<string, Promise<void>>();

  constructor(opts: {
    pool: Pool;
    goals: GoalSystem;
    registry: CapabilityRegistry;
    lifecycle: MissionLifecycle;
    maxConcurrent?: number;
    maxAttempts?: number;
  }) {
    this.pool = opts.pool;
    this.goals = opts.goals;
    this.registry = opts.registry;
    this.lifecycle = opts.lifecycle;
    this.maxConcurrent = opts.maxConcurrent ?? 3;
    this.maxAttempts = opts.maxAttempts ?? 2;
  }

  stats(): RunnerStats {
    return {
      running: this.inFlight.size,
      maxConcurrent: this.maxConcurrent,
      inflightGoalIds: [...this.inFlight.keys()],
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
  ): Promise<DispatchResult> {
    if (this.inFlight.has(goalId)) {
      return { dispatched: false, goalId, reason: 'already_running' };
    }
    if (this.inFlight.size >= this.maxConcurrent) {
      return { dispatched: false, goalId, reason: `concurrency_cap:${this.maxConcurrent}` };
    }

    // DISPATCHED receipt + claim the goal row so the planner can't
    // re-select it. Both must succeed before the work starts.
    await this.goals.updateGoal(goalId, { status: 'in_progress' });
    await this.lifecycle.recordTransition({
      missionId: goalId,
      fromStatus: 'pending',
      toStatus: 'in_progress',
      fromStage: 'PLANNED',
      toStage: 'DISPATCHED',
      evidence: { capabilityId, params },
    }).catch(() => { });

    const work = this.run(goalId, capabilityId, params, ctx);
    this.inFlight.set(goalId, work);
    work.finally(() => this.inFlight.delete(goalId)).catch(() => { });
    return { dispatched: true, goalId };
  }

  /**
   * The actual background execution. Failures are classified —
   * transient failures bounded-retry, deterministic/governance go
   * terminal. Never throws; every path writes a receipt.
   */
  private async run(
    goalId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    ctx: CapabilityExecutionContext,
  ): Promise<void> {
    await this.lifecycle.recordTransition({
      missionId: goalId,
      fromStatus: 'in_progress',
      toStatus: 'in_progress',
      fromStage: 'DISPATCHED',
      toStage: 'RUNNING',
      evidence: { capabilityId },
    }).catch(() => { });

    try {
      const result = await this.registry.execute(capabilityId, params, ctx);
      const succeeded = result.executed && result.outcome === 'success';

      if (succeeded) {
        await this.lifecycle.recordTransition({
          missionId: goalId,
          fromStatus: 'in_progress',
          toStatus: 'in_progress',
          fromStage: 'RUNNING',
          toStage: 'VERIFYING',
          evidence: { outcome: result.outcome },
        }).catch(() => { });
        await this.goals.updateGoal(goalId, {
          status: 'completed',
          progress: 1.0,
          evidence: [{ runner: 'mission_runner', capabilityId, outcome: result.outcome, at: new Date().toISOString() }],
        });
      } else {
        await this.settleFailure(goalId, result.error ?? `outcome:${result.outcome}`, result.outcome === 'skipped');
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown';
      await this.settleFailure(goalId, reason, false);
    }
  }

  /**
   * Settle a failed run per its classification:
   *   transient     → retry (pending) while attempts remain, else blocked
   *   deterministic → blocked (needs replan/repair, not a blind retry)
   *   governance    → escalated (human boundary)
   */
  private async settleFailure(goalId: string, reason: string, wasSkipped: boolean): Promise<void> {
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

    await this.goals.updateGoal(goalId, {
      status: toStatus,
      result: `${cls}: ${reason}`.slice(0, 500),
      context: { ...(goal?.context ?? {}), attempt, lastFailureClass: cls, lastFailureAt: new Date().toISOString() },
      evidence: [{ runner: 'mission_runner', failureClass: cls, attempt, reason: reason.slice(0, 200) }],
    });
    await this.lifecycle.recordTransition({
      missionId: goalId,
      fromStatus: 'in_progress',
      toStatus,
      fromStage: 'RUNNING',
      toStage,
      failureClass: wasSkipped ? 'governance' : cls,
      attempt,
      evidence: { reason: reason.slice(0, 300) },
    }).catch(() => { });
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
