/**
 * HEIDI Mission Lifecycle — HYDI 4, Phase C
 *
 * Every autonomous mission moves through a durable lifecycle and every
 * transition writes a receipt to heidi_events (event_type
 * 'mission_transition', division 'missions'). A mission is never "done"
 * because a row says so — it is done because a verified transition says so.
 *
 *   DISCOVERED → QUALIFIED → AUTHORIZED → PLANNED → EXECUTING → VERIFYING
 *     → SUCCEEDED → LEARNED → REPEATABLE
 *                    ↘ FAILED → CLASSIFIED → (transient → RECOVERING → EXECUTING)
 *                                          → (deterministic/governance → terminal)
 *
 * Failure is classified, never blindly retried:
 *   transient     — timeout/connection/rate-limit; bounded retry allowed
 *   deterministic — the action cannot succeed as specified; escalate
 *   governance    — authorization/policy refusal; escalate to human
 *
 * The lifecycle maps onto heidi_goals.status: this module observes status
 * transitions (recorded by GoalSystem.updateGoal) and annotates them with
 * stage names, failure class, attempt count, and a receiptId chain.
 */

import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import type { GoalStatus } from './GoalSystem';

export type MissionStage =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'AUTHORIZED'
  | 'PLANNED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'LEARNED'
  | 'REPEATABLE'
  | 'FAILED'
  | 'CLASSIFIED'
  | 'RECOVERING'
  | 'CANCELLED'
  | 'ESCALATED';

export type FailureClass = 'transient' | 'deterministic' | 'governance';

/** Goal row status → lifecycle stage. */
export const GOAL_STATUS_TO_STAGE: Record<GoalStatus, MissionStage> = {
  pending: 'PLANNED',
  active: 'EXECUTING',
  in_progress: 'EXECUTING',
  blocked: 'RECOVERING',
  completed: 'SUCCEEDED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  escalated: 'ESCALATED',
};

export interface MissionTransition {
  receiptId: string;
  missionId: string;
  fromStatus: GoalStatus | null;
  toStatus: GoalStatus;
  fromStage: MissionStage | null;
  toStage: MissionStage;
  failureClass?: FailureClass;
  attempt?: number;
  actor: string;
  evidence?: unknown;
  at: string;
}

/**
 * Classify a failure reason deterministically. Order matters: governance
 * markers win over transient markers ("authorization timed out" is a
 * governance signal wearing a transient costume is not possible here —
 * governance is checked first because a refused action must never be
 * retried as if it were flaky infrastructure).
 */
export function classifyFailure(reason: string): FailureClass {
  const r = reason.toLowerCase();
  if (/authoriz|prohibit|policy|denied|permission|human_required|governance|risk_level|not_executable/.test(r)) {
    return 'governance';
  }
  if (/timeout|timed out|econn|etimedout|econnrefused|unavailable|deadlock|rate.?limit|503|429|retry|temporar|overload/.test(r)) {
    return 'transient';
  }
  return 'deterministic';
}

export class MissionLifecycle {
  private pool: Pool;
  private actor: string;

  constructor(pool: Pool, actor = 'heidi-daemon') {
    this.pool = pool;
    this.actor = actor;
  }

  /**
   * Record a durable transition receipt. Returns the receipt — null when
   * the write itself fails (event store down); callers treat the receipt
   * as optional evidence, never as a gate.
   */
  async recordTransition(t: Omit<MissionTransition, 'receiptId' | 'at' | 'actor'> & { actor?: string }): Promise<MissionTransition | null> {
    const receipt: MissionTransition = {
      receiptId: randomUUID(),
      missionId: t.missionId,
      fromStatus: t.fromStatus,
      toStatus: t.toStatus,
      fromStage: t.fromStage,
      toStage: t.toStage,
      failureClass: t.failureClass,
      attempt: t.attempt,
      actor: t.actor ?? this.actor,
      evidence: t.evidence,
      at: new Date().toISOString(),
    };
    try {
      await this.pool.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at)
         VALUES ($1, $2, $3, now())`,
        ['mission_transition', 'missions', JSON.stringify(receipt)],
      );
      return receipt;
    } catch {
      return null;
    }
  }

  /** Convenience: record a GoalStatus transition, deriving stages. */
  async recordStatusChange(
    missionId: string,
    fromStatus: GoalStatus | null,
    toStatus: GoalStatus,
    opts: { failureReason?: string; attempt?: number; evidence?: unknown } = {},
  ): Promise<MissionTransition | null> {
    const failureClass =
      toStatus === 'failed' || toStatus === 'blocked'
        ? classifyFailure(opts.failureReason ?? '')
        : undefined;
    return this.recordTransition({
      missionId,
      fromStatus,
      toStatus,
      fromStage: fromStatus ? GOAL_STATUS_TO_STAGE[fromStatus] : null,
      toStage: GOAL_STATUS_TO_STAGE[toStatus],
      failureClass,
      attempt: opts.attempt,
      evidence: opts.evidence,
    });
  }

  /** Read a mission's receipt chain, oldest first. */
  async getReceiptChain(missionId: string): Promise<MissionTransition[]> {
    const rows = await this.pool.query(
      `SELECT payload FROM heidi_events
       WHERE event_type = 'mission_transition' AND payload->>'missionId' = $1
       ORDER BY created_at ASC`,
      [missionId],
    );
    return rows.rows.map((r) => r.payload as MissionTransition);
  }
}
