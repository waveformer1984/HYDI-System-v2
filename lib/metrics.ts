/**
 * PHASE 5 METRICS — HYDI_KERNEL_ARCHITECTURE_ROADMAP.md
 *
 * Task success rate, ProtoForge decision distribution + outcome success
 * rate, work-session planning accuracy, retry counts, and memory retrieval
 * coverage — computed by reading tables Phases 1-4 already write to plus
 * two new sentinel `task_name` values in `actions`
 * (`llm_retry`, `memory_retrieval`, both written by lib/orchestrator.ts).
 * No new table, no new migration — `actions.task_name` is free text with
 * no CHECK constraint restricting it to real action types.
 *
 * Two metrics the roadmap originally named still aren't fully here, on
 * purpose:
 * - "Memory retrieval quality" is represented below as retrieval
 *   *coverage* (getMemoryRetrievalStats: was any context found at all),
 *   not quality — there's still no feedback signal for whether retrieved
 *   context was actually useful to the response. Labeled honestly as
 *   coverage, not renamed to quality.
 * - "User-correction rate" is still not built at all. Detecting it needs
 *   either an explicit feedback UI (thumbs up/down) or a heuristic
 *   classifier over the next user message — a heuristic here would carry
 *   real false-positive/negative risk and produce a metric that looks
 *   authoritative but isn't. That's a product/UX decision, not something
 *   to fabricate in a backend metrics pass.
 *
 * Also worth knowing: lib/agents/*'s per-agent in-memory metrics
 * (tasksHandled/successCount/...) reset every request — `HeidiOrchestrator`
 * is constructed fresh per call (pages/api/chat.ts, status.ts, session.ts),
 * so those counters are useful for a single call's own observability but
 * are not a durable cross-request signal. This module reads from the
 * durable tables instead.
 *
 * Aggregation happens in JS after a bounded fetch (default limit 1000
 * rows), not in SQL — reasonable for early-stage instrumentation, not a
 * production-scale analytics pipeline. Revisit with a real view (like
 * public.policy_performance, which this module doesn't reuse because it's
 * grouped by policy/stream, not by task type) if volume grows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Task success rate (from `actions`) ──────────────────────────────────

export interface TaskSuccessRate {
  taskType: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
}

export function computeTaskSuccessRates(rows: Array<{ task_name: string | null; status: string }>): TaskSuccessRate[] {
  const byType = new Map<string, { total: number; completed: number; failed: number }>();

  for (const row of rows) {
    const type = row.task_name ?? 'unknown';
    const entry = byType.get(type) ?? { total: 0, completed: 0, failed: 0 };
    entry.total++;
    if (row.status === 'completed') entry.completed++;
    if (row.status === 'failed') entry.failed++;
    byType.set(type, entry);
  }

  return [...byType.entries()].map(([taskType, stats]) => ({
    taskType,
    total: stats.total,
    completed: stats.completed,
    failed: stats.failed,
    successRate: stats.total > 0 ? stats.completed / stats.total : null,
  }));
}

export async function getTaskSuccessRates(
  supabase: SupabaseClient,
  opts: { sessionId?: string; since?: string; limit?: number } = {},
): Promise<TaskSuccessRate[]> {
  try {
    let query = supabase.from('actions').select('task_name, status').limit(opts.limit ?? 1000);
    if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
    if (opts.since) query = query.gte('created_at', opts.since);
    const { data, error } = await query;
    if (error || !data) return [];
    return computeTaskSuccessRates(data as Array<{ task_name: string | null; status: string }>);
  } catch (error) {
    console.error('[Metrics] getTaskSuccessRates failed:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

// ── ProtoForge decision stats (from `decisions`) ────────────────────────

export interface DecisionStats {
  total: number;
  approved: number;
  rejected: number;
  escalated: number;
  outcomesRecorded: number;
  outcomeSuccesses: number;
  outcomeFailures: number;
  outcomeSuccessRate: number | null;
  averageConfidence: number | null;
}

export function computeDecisionStats(
  rows: Array<{ decision: string; outcome: string | null; confidence: number | null }>,
): DecisionStats {
  let approved = 0;
  let rejected = 0;
  let escalated = 0;
  let outcomeSuccesses = 0;
  let outcomeFailures = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const row of rows) {
    if (row.decision === 'approve') approved++;
    else if (row.decision === 'reject') rejected++;
    else if (row.decision === 'escalate') escalated++;

    if (row.outcome === 'success') outcomeSuccesses++;
    else if (row.outcome === 'failure') outcomeFailures++;

    if (typeof row.confidence === 'number') {
      confidenceSum += row.confidence;
      confidenceCount++;
    }
  }

  const outcomesRecorded = outcomeSuccesses + outcomeFailures;

  return {
    total: rows.length,
    approved,
    rejected,
    escalated,
    outcomesRecorded,
    outcomeSuccesses,
    outcomeFailures,
    outcomeSuccessRate: outcomesRecorded > 0 ? outcomeSuccesses / outcomesRecorded : null,
    averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null,
  };
}

export async function getDecisionStats(
  supabase: SupabaseClient,
  opts: { stream?: string | null; since?: string; limit?: number } = {},
): Promise<DecisionStats> {
  try {
    let query = supabase.from('decisions').select('decision, outcome, confidence').limit(opts.limit ?? 1000);
    if (opts.stream !== undefined) {
      query = opts.stream === null ? query.is('stream', null) : query.eq('stream', opts.stream);
    }
    if (opts.since) query = query.gte('decided_at', opts.since);
    const { data, error } = await query;
    if (error || !data) return computeDecisionStats([]);
    return computeDecisionStats(data as Array<{ decision: string; outcome: string | null; confidence: number | null }>);
  } catch (error) {
    console.error('[Metrics] getDecisionStats failed:', error instanceof Error ? error.message : 'Unknown error');
    return computeDecisionStats([]);
  }
}

// ── Work session / planning accuracy (from `work_sessions`) ────────────

export interface WorkSessionStats {
  totalSessions: number;
  completed: number;
  failed: number;
  needsApproval: number;
  inProgress: number;
  planned: number;
  completionRate: number | null;
  averageStepsPlanned: number | null;
  averageStepsCompleted: number | null;
  /** Average, across sessions with at least one step, of (completed steps / planned steps). */
  planningAccuracy: number | null;
}

export function computeWorkSessionStats(rows: Array<{ status: string; steps: Array<{ status: string }> }>): WorkSessionStats {
  let completed = 0;
  let failed = 0;
  let needsApproval = 0;
  let inProgress = 0;
  let planned = 0;
  let totalPlannedSteps = 0;
  let totalCompletedSteps = 0;
  let sessionsWithSteps = 0;
  let accuracySum = 0;

  for (const row of rows) {
    if (row.status === 'completed') completed++;
    else if (row.status === 'failed') failed++;
    else if (row.status === 'needs_approval') needsApproval++;
    else if (row.status === 'in_progress') inProgress++;
    else if (row.status === 'planned') planned++;

    const stepCount = row.steps?.length ?? 0;
    if (stepCount > 0) {
      const completedSteps = row.steps.filter((step) => step.status === 'completed').length;
      totalPlannedSteps += stepCount;
      totalCompletedSteps += completedSteps;
      accuracySum += completedSteps / stepCount;
      sessionsWithSteps++;
    }
  }

  const totalSessions = rows.length;
  const terminal = completed + failed;

  return {
    totalSessions,
    completed,
    failed,
    needsApproval,
    inProgress,
    planned,
    completionRate: terminal > 0 ? completed / terminal : null,
    averageStepsPlanned: sessionsWithSteps > 0 ? totalPlannedSteps / sessionsWithSteps : null,
    averageStepsCompleted: sessionsWithSteps > 0 ? totalCompletedSteps / sessionsWithSteps : null,
    planningAccuracy: sessionsWithSteps > 0 ? accuracySum / sessionsWithSteps : null,
  };
}

export async function getWorkSessionStats(
  supabase: SupabaseClient,
  opts: { sessionId?: string; limit?: number } = {},
): Promise<WorkSessionStats> {
  try {
    let query = supabase.from('work_sessions').select('status, steps').limit(opts.limit ?? 1000);
    if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
    const { data, error } = await query;
    if (error || !data) return computeWorkSessionStats([]);
    return computeWorkSessionStats(data as Array<{ status: string; steps: Array<{ status: string }> }>);
  } catch (error) {
    console.error('[Metrics] getWorkSessionStats failed:', error instanceof Error ? error.message : 'Unknown error');
    return computeWorkSessionStats([]);
  }
}

// ── Retry counts (from `actions`, task_name = 'llm_retry') ──────────────

export interface RetryStats {
  totalRetries: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  byStage: Record<string, { total: number; succeeded: number; failed: number }>;
}

export function computeRetryStats(rows: Array<{ status: string; payload: { stage?: string } | null }>): RetryStats {
  let succeeded = 0;
  let failed = 0;
  const byStage: Record<string, { total: number; succeeded: number; failed: number }> = {};

  for (const row of rows) {
    const stage = row.payload?.stage ?? 'unknown';
    const entry = byStage[stage] ?? { total: 0, succeeded: 0, failed: 0 };
    entry.total++;

    if (row.status === 'completed') {
      succeeded++;
      entry.succeeded++;
    } else if (row.status === 'failed') {
      failed++;
      entry.failed++;
    }

    byStage[stage] = entry;
  }

  return {
    totalRetries: rows.length,
    succeeded,
    failed,
    successRate: rows.length > 0 ? succeeded / rows.length : null,
    byStage,
  };
}

export async function getRetryStats(
  supabase: SupabaseClient,
  opts: { sessionId?: string; since?: string; limit?: number } = {},
): Promise<RetryStats> {
  try {
    let query = supabase
      .from('actions')
      .select('status, payload')
      .eq('task_name', 'llm_retry')
      .limit(opts.limit ?? 1000);
    if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
    if (opts.since) query = query.gte('created_at', opts.since);
    const { data, error } = await query;
    if (error || !data) return computeRetryStats([]);
    return computeRetryStats(data as Array<{ status: string; payload: { stage?: string } | null }>);
  } catch (error) {
    console.error('[Metrics] getRetryStats failed:', error instanceof Error ? error.message : 'Unknown error');
    return computeRetryStats([]);
  }
}

// ── Memory retrieval coverage (from `actions`, task_name = 'memory_retrieval') ──
//
// This is coverage, not quality: whether semantic retrieval found any
// context at all, not whether that context was useful. See this module's
// header comment for why "quality" isn't built.

export interface MemoryRetrievalStats {
  totalRetrievals: number;
  withContext: number;
  withoutContext: number;
  coverageRate: number | null;
}

export function computeMemoryRetrievalStats(rows: Array<{ payload: { had_context?: boolean } | null }>): MemoryRetrievalStats {
  let withContext = 0;
  let withoutContext = 0;

  for (const row of rows) {
    if (row.payload?.had_context) withContext++;
    else withoutContext++;
  }

  return {
    totalRetrievals: rows.length,
    withContext,
    withoutContext,
    coverageRate: rows.length > 0 ? withContext / rows.length : null,
  };
}

export async function getMemoryRetrievalStats(
  supabase: SupabaseClient,
  opts: { sessionId?: string; since?: string; limit?: number } = {},
): Promise<MemoryRetrievalStats> {
  try {
    let query = supabase
      .from('actions')
      .select('payload')
      .eq('task_name', 'memory_retrieval')
      .limit(opts.limit ?? 1000);
    if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
    if (opts.since) query = query.gte('created_at', opts.since);
    const { data, error } = await query;
    if (error || !data) return computeMemoryRetrievalStats([]);
    return computeMemoryRetrievalStats(data as Array<{ payload: { had_context?: boolean } | null }>);
  } catch (error) {
    console.error('[Metrics] getMemoryRetrievalStats failed:', error instanceof Error ? error.message : 'Unknown error');
    return computeMemoryRetrievalStats([]);
  }
}
