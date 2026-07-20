/**
 * WORK SESSIONS — Phase 4 of HYDI_KERNEL_ARCHITECTURE_ROADMAP.md
 *
 * A stated goal decomposed into an ordered sequence of steps, each one of
 * Heidi's existing action types (create_task, send_email, update_database,
 * fetch_data, schedule_event) — deliberately scoped to that vocabulary, no
 * new code-editing/test-running/git capability. Execution reuses
 * lib/orchestrator.ts's existing gating pipeline one step at a time (see
 * HeidiOrchestrator.runWorkSession); this module holds the pure planning
 * contract (mirrors lib/ActionParser.ts's JSON-contract pattern) and the
 * `work_sessions` persistence helpers.
 *
 * A session pauses (status='failed') on the first failed or
 * ProtoForge-blocked step rather than blindly continuing — "reliability
 * before autonomy."
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import structuredLogger from './structured-logger';

const logger = structuredLogger.child({ component: 'WorkSessions' });

export interface PlannedStep {
  type: string;
  payload: Record<string, unknown>;
}

export interface WorkSessionStep extends PlannedStep {
  status: 'pending' | 'completed' | 'failed' | 'pending_approval';
  error?: string;
}

export interface WorkSession {
  id: string;
  session_id: string;
  user_id: string;
  goal: string;
  status: 'planned' | 'in_progress' | 'completed' | 'failed' | 'needs_approval';
  steps: WorkSessionStep[];
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

// ── Planning — mirrors lib/ActionParser.ts's JSON-contract pattern ─────────

export function buildPlanPrompt(goal: string, allowedActionTypes: string[]): string {
  return `You are Heidi, planning a multi-step work session to accomplish a goal.

Decompose the goal below into an ordered sequence of steps. Each step MUST use one of these action types: ${allowedActionTypes.join(', ')}.

Respond with valid JSON in this exact structure:
{"steps": [{"type": "action_type", "payload": {}}]}

Rules:
1. Only use the allowed action types listed above — nothing else.
2. Order steps the way they should execute, earliest first.
3. Keep the plan to the minimum steps needed.
4. If the goal cannot be accomplished with the allowed action types, return {"steps": []}.

Goal: ${goal}

Respond with JSON:`;
}

export interface ParsedPlan {
  steps: PlannedStep[];
}

export class PlanParser {
  static parsePlan(content: string): { success: boolean; plan?: ParsedPlan; error?: string } {
    try {
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed.steps)) {
        return { success: false, error: '"steps" field must be an array' };
      }

      for (const step of parsed.steps) {
        if (!step.type || typeof step.type !== 'string') {
          return { success: false, error: 'Each step must have a "type" string field' };
        }
        if (!step.payload || typeof step.payload !== 'object') {
          return { success: false, error: 'Each step must have a "payload" object' };
        }
      }

      return { success: true, plan: { steps: parsed.steps } };
    } catch (error) {
      return { success: false, error: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  static generateCorrectedPrompt(originalPrompt: string, error: string): string {
    return `${originalPrompt}

IMPORTANT: Your response must be valid JSON with this exact structure:
{"steps": [{"type": "action_type", "payload": {"key": "value"}}]}

Previous error: ${error}

Please ensure your output is valid JSON and follows this structure exactly.`;
  }

  /** Filters out any step whose type isn't in the allowed list — never trust the model's output blindly. */
  static filterAllowedSteps(steps: PlannedStep[], allowedActionTypes: string[]): PlannedStep[] {
    return steps.filter((step) => allowedActionTypes.includes(step.type));
  }
}

// ── Persistence ──────────────────────────────────────────────────────────

export async function createWorkSession(
  supabase: SupabaseClient,
  fields: { session_id: string; user_id: string; goal: string; steps: PlannedStep[] },
): Promise<WorkSession | null> {
  try {
    const { data, error } = await supabase
      .from('work_sessions')
      .insert({
        session_id: fields.session_id,
        user_id: fields.user_id,
        goal: fields.goal,
        status: 'planned',
        steps: fields.steps.map((step) => ({ ...step, status: 'pending' as const })),
      })
      .select()
      .single();

    if (error) {
      logger.error('create failed', { error: error.message });
      return null;
    }
    return data as WorkSession;
  } catch (error) {
    logger.error('create failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}

export async function getWorkSession(supabase: SupabaseClient, id: string): Promise<WorkSession | null> {
  try {
    const { data } = await supabase.from('work_sessions').select('*').eq('id', id).maybeSingle();
    return (data as WorkSession) ?? null;
  } catch (error) {
    logger.error('get failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}

export async function updateWorkSession(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<Pick<WorkSession, 'status' | 'steps' | 'completed_at'>>,
): Promise<WorkSession | null> {
  try {
    const { data, error } = await supabase.from('work_sessions').update(fields).eq('id', id).select().single();
    if (error) {
      logger.error('update failed', { error: error.message });
      return null;
    }
    return data as WorkSession;
  } catch (error) {
    logger.error('update failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}

/** Find the first pending step, or undefined when the plan is exhausted. */
export function nextPendingStep(session: WorkSession): WorkSessionStep | undefined {
  return session.steps.find((step) => step.status === 'pending');
}
