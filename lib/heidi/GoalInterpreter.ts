/**
 * GoalInterpreter — free-text goal → durable structured goal model.
 *
 * The local model extracts the shape; the deterministic envelope decides
 * what's true. Every field is typed (fact | assumption | inference |
 * hypothesis | unknown | instruction) so assumptions can never silently
 * become facts. If the model is unreachable the result is AI_UNAVAILABLE
 * — never a fabricated interpretation.
 */
import { Pool } from 'pg';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.GOAL_MODEL || 'llama3.2:3b';
const LLM_TIMEOUT_MS = 60000;

export type KnowledgeKind = 'fact' | 'assumption' | 'inference' | 'hypothesis' | 'unknown' | 'instruction';

export interface GoalModel {
  objective: string;
  desiredOutcome: string;
  constraints: string[];
  completionCriteria: string[];
  /** Typed knowledge — the envelope never promotes. */
  knowledge: Array<{ kind: KnowledgeKind; statement: string; provenance: string }>;
  requiredCapabilities: string[];
  risks: string[];
  aiStatus: 'ok' | 'AI_UNAVAILABLE';
  model: string;
}

const VALID_KINDS = new Set<KnowledgeKind>(['fact', 'assumption', 'inference', 'hypothesis', 'unknown', 'instruction']);

export async function interpretGoal(goalText: string, domainHint?: string): Promise<GoalModel> {
  const prompt = [
    `You are a goal analyst. Decompose this goal into structured JSON.`,
    `Goal: ${JSON.stringify(goalText)}`,
    domainHint ? `Domain hint: ${domainHint}` : '',
    `Output ONLY JSON: {`,
    ` "objective": string, "desiredOutcome": string,`,
    ` "constraints": [string], "completionCriteria": [string],`,
    ` "knowledge": [{"kind":"fact|assumption|inference|hypothesis|unknown|instruction","statement":string,"provenance":string}],`,
    ` "requiredCapabilities": [string], "risks": [string] }`,
    `Rules: 'fact' only for directly observable durable evidence; guesses are 'assumption';`,
    `gaps are 'unknown'. If unsure, mark 'unknown' — never guess facts.`,
  ].filter(Boolean).join('\n');

  let raw = '';
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0, num_predict: 1200 } }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json() as { response?: string };
    raw = (data.response ?? '').trim();
  } catch (e) {
    return unavailable(goalText, `AI_UNAVAILABLE: ${e instanceof Error ? e.message : 'ollama error'}`);
  }

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return unavailable(goalText, 'AI_UNAVAILABLE: model returned no JSON');

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]) as Record<string, unknown>; }
  catch { return unavailable(goalText, 'AI_UNAVAILABLE: malformed JSON'); }

  // Deterministic envelope — every LLM field is normalized and re-typed.
  const arr = (v: unknown): string[] => Array.isArray(v) ? (v as unknown[]).map(String).filter(s => s.length) : [];
  const knowledge = arr(parsed.knowledge && Array.isArray(parsed.knowledge) ? parsed.knowledge as unknown[] : [])
    .map(k => {
      const o = (k ?? {}) as unknown as Record<string, unknown>;
      const kind = VALID_KINDS.has(o.kind as KnowledgeKind) ? o.kind as KnowledgeKind : 'unknown';
      return { kind, statement: String(o.statement ?? ''), provenance: String(o.provenance ?? 'model:' + MODEL) };
    })
    .filter(k => k.statement.length > 0)
    // 'fact' from a model is demoted — provenance must be durable, not generated.
    .map(k => k.kind === 'fact' && !/^(db:|event:|human:)/.test(k.provenance)
      ? { ...k, kind: 'inference' as KnowledgeKind, provenance: 'model:' + MODEL } : k);

  return {
    objective: String(parsed.objective ?? goalText).slice(0, 300) || goalText.slice(0, 300),
    desiredOutcome: String(parsed.desiredOutcome ?? '').slice(0, 300),
    constraints: arr(parsed.constraints), completionCriteria: arr(parsed.completionCriteria),
    knowledge, requiredCapabilities: arr(parsed.requiredCapabilities), risks: arr(parsed.risks),
    aiStatus: 'ok', model: MODEL,
  };
}

function unavailable(goalText: string, reason: string): GoalModel {
  return {
    objective: goalText.slice(0, 300), desiredOutcome: '',
    constraints: [], completionCriteria: [],
    knowledge: [{ kind: 'unknown', statement: reason, provenance: 'system' }],
    requiredCapabilities: [], risks: [], aiStatus: 'AI_UNAVAILABLE', model: MODEL,
  };
}

export async function persistGoalModel(pool: Pool, goalText: string, model: GoalModel, source: string): Promise<string | null> {
  const r = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('goal_model', $1, now()) RETURNING id`,
    [JSON.stringify({ goal: goalText, source, ...model })],
  ).catch(() => null);
  return r?.rows[0]?.id ?? null;
}
