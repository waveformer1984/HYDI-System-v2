/**
 * SPECIALIST AGENT — Phase 3 of HYDI_KERNEL_ARCHITECTURE_ROADMAP.md
 *
 * A small, purpose-fit roster scoped to Heidi's real action vocabulary
 * (create_task, send_email, update_database, fetch_data, schedule_event) —
 * not a revival of pao-system/agents/*.ts or agents/specialized/*.js. Both
 * were investigated and found to be for a different domain entirely (a
 * simulated company that designs/funds/builds physical infrastructure,
 * with ~56 event types like DESIGN_CONTAINER_MODULE and BUDGET_ALLOCATION
 * and a fire-and-forget handle_event() contract) — see the roadmap doc's
 * Phase 3 section for the full mismatch evidence.
 *
 * Each agent delegates the actual work to ActionExecutor — no duplicated
 * Supabase/email logic — and adds what ActionExecutor alone didn't have: a
 * registry, per-type ownership, and per-agent metrics. That's the real
 * "multi-agent" value this phase adds, and the foundation Phase 4's
 * autonomous work sessions can build capacity-aware routing on top of.
 */

import type { ActionExecutor, ActionResult, ExecutorAction } from '../action-executor';

export interface AgentMetrics {
  tasksHandled: number;
  successCount: number;
  failureCount: number;
  lastActiveAt: string | null;
}

export abstract class SpecialistAgent {
  abstract readonly id: string;
  abstract readonly actionType: string;

  private metrics: AgentMetrics = {
    tasksHandled: 0,
    successCount: 0,
    failureCount: 0,
    lastActiveAt: null,
  };

  constructor(protected readonly actionExecutor: ActionExecutor) {}

  canHandle(actionType: string): boolean {
    return actionType === this.actionType;
  }

  async execute(action: ExecutorAction, sessionId: string): Promise<ActionResult> {
    this.metrics.tasksHandled++;
    this.metrics.lastActiveAt = new Date().toISOString();

    const result = await this.actionExecutor.execute(action, sessionId);

    if (result.status === 'completed') this.metrics.successCount++;
    else this.metrics.failureCount++;

    return result;
  }

  getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }
}
