/**
 * Planner — goal model → ordered executable steps over the EXISTING
 * capability registry. The local model proposes the sequence; the
 * deterministic validator decides what runs:
 *
 *   - every step must reference a real registered capability id
 *   - steps above R2 autonomy are marked human_required — the plan
 *     persists them but never dispatches them
 *   - unknown capability names are rejected, not approximated
 *
 * An approved plan is materialized as ordered child goals bound to real
 * capabilities, so execution reuses the existing governed daemon,
 * authorization, contracts, and verification — planning is not authority.
 */
import { Pool } from 'pg';
import { getCapabilityRegistry } from './CapabilityRegistry';
import type { GoalModel } from './GoalInterpreter';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.PLAN_MODEL || 'llama3.2:3b';
const LLM_TIMEOUT_MS = 60000;
const MAX_AUTONOMY = 2; // standing R2 — planning never lifts it

export interface PlanStep {
  stepId: string;
  objective: string;
  capabilityId: string;
  params: Record<string, unknown>;
  status: 'executable' | 'human_required' | 'rejected';
  reason: string;
}

export interface Plan {
  planId: string;
  goalModelId: string | null;
  steps: PlanStep[];
  aiStatus: 'ok' | 'AI_UNAVAILABLE' | 'DETERMINISTIC_ONLY';
}

/** Steps the model proposed, validated against the real registry. */
export function validateSteps(
  proposed: Array<{ objective?: string; capability?: string; params?: Record<string, unknown> }>,
): PlanStep[] {
  const registry = getCapabilityRegistry().listAll();
  const byId = new Map(registry.map(c => [c.capabilityId, c]));
  return proposed.slice(0, 8).map((p, i) => {
    const cap = p.capability && byId.get(p.capability);
    if (!cap) return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: String(p.capability ?? ''), params: p.params ?? {}, status: 'rejected' as const, reason: `capability '${p.capability}' is not in the registry` };
    if (cap.autonomyRequirement > MAX_AUTONOMY) {
      return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: cap.capabilityId, params: p.params ?? {}, status: 'human_required' as const, reason: `requires autonomy R${cap.autonomyRequirement} — above standing R${MAX_AUTONOMY}` };
    }
    return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: cap.capabilityId, params: p.params ?? {}, status: 'executable' as const, reason: `registered, R${cap.autonomyRequirement}` };
  });
}

/** Deterministic fallback composition from the goal model's own declared needs. */
export function deterministicPlan(model: GoalModel): Array<{ objective: string; capability: string; params: Record<string, unknown> }> {
  const text = model.objective.toLowerCase();
  const steps: Array<{ objective: string; capability: string; params: Record<string, unknown> }> = [];
  const opp = /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/.exec(model.objective)?.[1];
  if (opp && /investigat|research|look/.test(text)) {
    steps.push({ objective: 'investigate the opportunity', capability: 'ops.agent_mission', params: { opportunityId: opp } });
    steps.push({ objective: 'produce a business finding', capability: 'ops.opp_verdict', params: { opportunityId: opp } });
  } else if (opp) {
    steps.push({ objective: 'evaluate the opportunity evidence', capability: 'ops.opp_verdict', params: { opportunityId: opp } });
  }
  if (/health|state|status|block/.test(text)) steps.push({ objective: 'read executive system state', capability: 'ops.coo_state', params: {} });
  if (/scan|observe|detect|watch/.test(text)) steps.push({ objective: 'observe the development environment', capability: 'ops.dev_observe', params: {} });
  if (/check|audit|review/.test(text)) steps.push({ objective: 'probe system capability health', capability: 'ops.check_health', params: {} });
  if (/business|revenue|customer|context/.test(text)) steps.push({ objective: 'read the business fact store', capability: 'ops.business_context', params: {} });
  return steps;
}

/** Lessons from prior outcomes are injected into planning — the learning
 *  loop only counts if later work demonstrably reuses it. */
export async function relevantLessons(pool: Pool, text: string): Promise<string[]> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4).slice(0, 6);
  if (!words.length) return [];
  const { rows } = await pool.query(
    `SELECT payload FROM heidi_events WHERE event_type IN ('lesson','experience','memory_write')
       ORDER BY created_at DESC LIMIT 40`,
  ).catch(() => ({ rows: [] }));
  const hits = (rows as Array<{ payload: Record<string, unknown> }>)
    .map(r => r.payload)
    .map(p => String(p.lesson ?? p.summary ?? p.text ?? JSON.stringify(p)).slice(0, 160))
    .filter(s => words.some(w => s.toLowerCase().includes(w)));
  return [...new Set(hits)].slice(0, 4);
}

export async function proposePlan(model: GoalModel, lessons: string[] = []): Promise<Array<{ objective?: string; capability?: string; params?: Record<string, unknown> }> | null> {
  const catalog = getCapabilityRegistry().listAll()
    .map(c => `${c.capabilityId} (R${c.autonomyRequirement}, ${c.riskLevel}) — ${c.description.slice(0, 80)}`)
    .join('\n');
  const prompt = [
    'Choose an ordered sequence of capabilities to accomplish this goal.',
    `Goal: ${model.objective}`,
    ...(lessons.length ? ['Known lessons from prior work:', ...lessons.map(l => `- ${l}`)] : []),
    `Desired outcome: ${model.desiredOutcome || 'unspecified'}`,
    'Available capabilities (id — authority level — category):',
    catalog,
    'Output ONLY a JSON array: [{"objective":string,"capability":"id","params":{}}]',
    'Use only ids from the list. Prefer fewest steps. Include opportunityId params when a uuid appears in the goal.',
  ].join('\n');
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0, num_predict: 800 } }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response?: string };
    const m = (data.response ?? '').match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]) as Array<{ objective?: string; capability?: string; params?: Record<string, unknown> }>;
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

/** Persist a plan event and materialize executable steps as child goals. */
export async function materializePlan(
  pool: Pool, planId: string, goalModelId: string, model: GoalModel, steps: PlanStep[], aiStatus: Plan['aiStatus'],
): Promise<{ planEventId: string | null; childGoalIds: string[] }> {
  // Parent is the ops.plan goal row itself, not the goal_model event —
  // parent_id references heidi_goals.
  const parentRow = await pool.query(
    `SELECT id FROM heidi_goals WHERE context->>'capabilityId'='ops.plan'
       AND context->'capabilityParams'->>'goalModelId'=$1
       ORDER BY created_at DESC LIMIT 1`,
    [goalModelId],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  const parentGoalId: string | null = parentRow.rows[0]?.id ?? null;
  const ev = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('plan', $1, now()) RETURNING id`,
    [JSON.stringify({ planId, goalModelId: planId, objective: model.objective, aiStatus, steps })],
  ).catch(() => null);
  const planEventId = ev?.rows[0]?.id ?? null;

  const childGoalIds: string[] = [];
  const materializeErrors: string[] = [];
  for (const s of steps) {
    if (s.status !== 'executable') {
      // Human-required / rejected steps are durable in the plan event —
      // they never silently become runnable goals.
      continue;
    }
    try {
      const g = await pool.query(
        `INSERT INTO heidi_goals (parent_id, title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
         VALUES ($1, $2, 'task', $2, 'active', 5, '["contract-verified capability execution"]'::jsonb, $3, now(), now()) RETURNING id`,
        [parentGoalId, `Plan step ${s.stepId}: ${s.objective.slice(0, 100)}`,
          JSON.stringify({ capabilityId: s.capabilityId, capabilityParams: s.params, completeOnVerify: true, producedBy: 'planner', producerKey: `plan:${planId}:${s.stepId}` })],
      );
      if (g.rows[0]?.id) childGoalIds.push(g.rows[0].id);
    } catch (e) {
      // Never silently swallow materialization — the plan event records it.
      materializeErrors.push(`${s.stepId}: ${e instanceof Error ? e.message.slice(0, 80) : 'insert failed'}`);
    }
  }
  if (materializeErrors.length && planEventId) {
    await pool.query(
      `UPDATE heidi_events SET payload = payload || $2::jsonb WHERE id=$1`,
      [planEventId, JSON.stringify({ materializeErrors })],
    ).catch(() => { });
  }
  return { planEventId, childGoalIds };
}
