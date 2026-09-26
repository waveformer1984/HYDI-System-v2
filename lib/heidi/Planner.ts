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
  status: 'executable' | 'human_required' | 'rejected' | 'skipped_branch';
  reason: string;
  /** Deterministic branch gate — evaluated against durable state at
   *  materialization; the LLM never decides the branch taken. */
  condition?: { type: 'business_finding_verdict'; opportunityId: string; equals: string };
  /** The durable lesson that altered this step — strategy change is
   *  visible in the plan, not just in the prompt. */
  lessonApplied?: string;
}

export interface Plan {
  planId: string;
  goalModelId: string | null;
  steps: PlanStep[];
  aiStatus: 'ok' | 'AI_UNAVAILABLE' | 'DETERMINISTIC_ONLY';
}

/** Steps the model proposed, validated against the real registry. */
/** Allowlisted declarative condition grammar — the ONLY conditional
 *  form an LLM step may carry. Anything else is an explicit planning
 *  failure, never executable code. */
export function validateCondition(c: unknown): PlanStep['condition'] | null {
  if (c === undefined || c === null) return undefined;
  if (typeof c !== 'object' || Array.isArray(c)) return null;
  const o = c as Record<string, unknown>;
  if (o.type === 'business_finding_verdict'
    && typeof o.opportunityId === 'string'
    && typeof o.equals === 'string'
    && /^[A-Z_]{2,40}$/.test(o.equals)) {
    return { type: 'business_finding_verdict', opportunityId: o.opportunityId, equals: o.equals };
  }
  return null;
}

export function validateSteps(
  proposed: Array<{ objective?: string; capability?: string; params?: Record<string, unknown>; condition?: unknown }>,
): PlanStep[] {
  const registry = getCapabilityRegistry().listAll();
  const byId = new Map(registry.map(c => [c.capabilityId, c]));
  return proposed.slice(0, 8).map((p, i) => {
    const condition = validateCondition(p.condition);
    if (condition === null) {
      return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: String(p.capability ?? ''), params: {}, status: 'rejected' as const, reason: `invalid condition — only the declared grammar is admissible` };
    }
    const cap = p.capability && byId.get(p.capability);
    if (!cap) return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: String(p.capability ?? ''), params: p.params ?? {}, status: 'rejected' as const, reason: `capability '${p.capability}' is not in the registry`, condition };
    if (cap.autonomyRequirement > MAX_AUTONOMY) {
      return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: cap.capabilityId, params: p.params ?? {}, status: 'human_required' as const, reason: `requires autonomy R${cap.autonomyRequirement} — above standing R${MAX_AUTONOMY}`, condition };
    }
    return { stepId: `s${i + 1}`, objective: String(p.objective ?? ''), capabilityId: cap.capabilityId, params: p.params ?? {}, status: 'executable' as const, reason: `registered, R${cap.autonomyRequirement}`, condition };
  });
}

/** Deterministic fallback composition from the goal model's own declared needs. */
export function deterministicPlan(model: GoalModel): Array<{ objective: string; capability: string; params: Record<string, unknown>; condition?: PlanStep['condition'] }> {
  const text = model.objective.toLowerCase();
  const steps: Array<{ objective: string; capability: string; params: Record<string, unknown>; condition?: PlanStep['condition'] }> = [];
  const opp = /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/.exec(model.objective)?.[1];
  if (opp && /investigat|research|look/.test(text)) {
    steps.push({ objective: 'investigate the opportunity', capability: 'ops.agent_mission', params: { opportunityId: opp } });
    steps.push({ objective: 'produce a business finding', capability: 'ops.opp_verdict', params: { opportunityId: opp } });
  } else if (opp) {
    steps.push({ objective: 'evaluate the opportunity evidence', capability: 'ops.opp_verdict', params: { opportunityId: opp } });
  }
  // Conditional evidence intake — the observed verdict selects the
  // branch: a partially supported opportunity opens a hypothesis
  // assertion; anything else yields the no-signal observation path.
  if (opp && /validat|verdict|evaluat/.test(text)) {
    steps.push({ objective: 'assert open customer-demand hypothesis', capability: 'ops.world_assert', params: { kind: 'hypothesis', subject: `opp:${opp.slice(0, 8)}`, predicate: 'customer_demand', value: 'open — awaiting declared evidence', provenance: 'event:business_finding', falsification: 'paid-job absent after interviews' }, condition: { type: 'business_finding_verdict', opportunityId: opp, equals: 'PARTIALLY_SUPPORTED' } });
  }
  // Evidence intake step — admitted here, but gated downstream by the
  // authorized-experiment requirement and lesson directives.
  if (opp && /evidence|interview|declar/.test(text)) {
    steps.push({ objective: 'record declared customer evidence', capability: 'ops.opp_evidence', params: { opportunityId: opp, channel: 'direct_interview', summary: 'declared via planning intake', declaredBy: 'planner' } });
  }
  if (/health|state|status|block/.test(text)) steps.push({ objective: 'read executive system state', capability: 'ops.coo_state', params: {} });
  if (/scan|observe|detect|watch/.test(text)) steps.push({ objective: 'observe the development environment', capability: 'ops.dev_observe', params: {} });
  if (/check|audit|review/.test(text)) steps.push({ objective: 'probe system capability health', capability: 'ops.check_health', params: {} });
  if (/business|revenue|customer|context/.test(text)) steps.push({ objective: 'read the business fact store', capability: 'ops.business_context', params: {} });
  return steps;
}

/** Deterministic model routing — catalog-driven, never model-selected
 *  by the model itself. Coding → coder model; reasoning → largest
 *  available reasoning model; none → honest unavailable. */
export function selectModel(
  catalog: Array<{ name: string }>,
  task: 'reasoning' | 'coding' | 'embedding',
): { model: string | null; reason: string } {
  const names = catalog.map(m => m.name);
  const find = (pat: RegExp) => names.find(n => pat.test(n)) ?? null;
  if (task === 'embedding') {
    const m = find(/embed/i);
    return m ? { model: m, reason: 'embedding model from catalog' } : { model: null, reason: 'NO_ELIGIBLE_MODEL: no embedding model in catalog' };
  }
  if (task === 'coding') {
    const m = find(/coder|code/i);
    return m ? { model: m, reason: 'coding task → coder model' } : { model: null, reason: 'NO_ELIGIBLE_MODEL: no coder model' };
  }
  const m = find(/qwen2\.5:7b/) ?? find(/llama3\.2/) ?? names[0] ?? null;
  return m ? { model: m, reason: 'reasoning task → best available local model' } : { model: null, reason: 'NO_ELIGIBLE_MODEL' };
}

/** Evaluate a step's branch condition against durable state — observed
 *  state selects the branch, not the model. */
export async function evaluateCondition(
  pool: Pool, c: NonNullable<PlanStep['condition']>,
): Promise<{ pass: boolean; observed: string }> {
  if (c.type === 'business_finding_verdict') {
    const { rows } = await pool.query(
      `SELECT payload->>'verdict' v FROM heidi_events WHERE event_type='business_finding'
         AND payload->>'opportunityId'=$1 ORDER BY created_at DESC LIMIT 1`,
      [c.opportunityId],
    );
    const observed = String(rows[0]?.v ?? 'NONE');
    return { pass: observed === c.equals, observed };
  }
  return { pass: false, observed: 'unknown_condition_type' };
}

/** Apply lesson directives — a retrieved lesson measurably changes the
 *  plan when it blocks or reorders a step the baseline would have run. */
export async function applyLessonDirectives(
  pool: Pool, steps: PlanStep[], lessons: Array<{ id: string; lesson: string; directives: Array<{ avoidCapability?: string; unlessPredicate?: string }> }>,
): Promise<string[]> {
  const applied: string[] = [];
  for (const lesson of lessons) {
    for (const d of lesson.directives ?? []) {
      if (!d.avoidCapability) continue;
      for (const s of steps) {
        if (s.capabilityId !== d.avoidCapability || s.status !== 'executable') continue;
        let unless = true; // 'unless' predicate satisfied means KEEP the step
        if (d.unlessPredicate === 'authorized_experiment' && typeof s.params.opportunityId === 'string') {
          const { authorizedExperiment } = await import('./CustomerValidation');
          unless = !!(await authorizedExperiment(pool, s.params.opportunityId));
        }
        if (!unless) {
          s.status = 'rejected';
          s.reason = `lesson ${lesson.id.slice(0, 12)}: ${lesson.lesson.slice(0, 80)}`;
          s.lessonApplied = lesson.id;
          applied.push(`${s.stepId}:${d.avoidCapability} blocked by lesson`);
        }
      }
    }
  }
  return applied;
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
    'A step may include an optional conditional gate — ONLY this exact form: "condition":{"type":"business_finding_verdict","opportunityId":"<uuid>","equals":"<UPPER_CASE_VERDICT>"}',
    'Use a condition only when a step should run solely if the opportunity\'s latest business_finding verdict equals the value. Omit condition otherwise.',
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
  const branchDecisions: Array<{ stepId: string; condition: string; observed: string; selected: boolean }> = [];
  for (const s of steps) {
    if (s.status !== 'executable') continue;
    // Branch gate — the observed durable state selects, not the model.
    if (s.condition) {
      const r = await evaluateCondition(pool, s.condition);
      branchDecisions.push({ stepId: s.stepId, condition: JSON.stringify(s.condition), observed: r.observed, selected: r.pass });
      if (!r.pass) {
        s.status = 'skipped_branch';
        s.reason = `condition not met — observed '${r.observed}'`;
        continue;
      }
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
  if ((materializeErrors.length || branchDecisions.length) && planEventId) {
    await pool.query(
      `UPDATE heidi_events SET payload = payload || $2::jsonb WHERE id=$1`,
      [planEventId, JSON.stringify({ materializeErrors, branchDecisions })],
    ).catch(() => { });
  }
  return { planEventId, childGoalIds };
}
