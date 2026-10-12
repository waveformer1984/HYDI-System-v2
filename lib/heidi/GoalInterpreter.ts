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
// A cold model load on CPU-only hardware can exceed a small timeout on its
// own; warm inference of this size is ~35-40s. keep_alive keeps the resident
// model from being evicted between interpret -> plan calls in one goal chain.
const LLM_TIMEOUT_MS = Number(process.env.GOAL_LLM_TIMEOUT_MS) || 60000;
const KEEP_ALIVE = process.env.GOAL_LLM_KEEP_ALIVE || '30m';

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
    `Keep every string under 15 words; at most 4 knowledge items. Output must be COMPLETE valid JSON.`,
  ].filter(Boolean).join('\n');

  let raw = '';
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // num_predict deliberately small — a 3b model that rambles past ~600
      // tokens truncates mid-JSON and can't be repaired. Tight output > verbose.
      body: JSON.stringify({ model: MODEL, prompt, stream: false, keep_alive: KEEP_ALIVE, options: { temperature: 0, num_predict: 600 } }),
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
  catch {
    // Small models truncate mid-string at num_predict or emit trailing commas.
    // One repair pass before declaring failure — cheaper than losing the call.
    let candidate = m[0]
      .replace(/,\s*([}\]])/g, '$1')           // trailing commas
      .replace(/"[^"]*$/, '');                 // dangling unterminated string
    // close any braces/brackets still open
    const opens = (candidate.match(/[{[]/g) || []).length;
    const closes = (candidate.match(/[}\]]/g) || []).length;
    candidate += '}'.repeat(Math.max(0, opens - closes));
    try { parsed = JSON.parse(candidate) as Record<string, unknown>; }
    catch { return unavailable(goalText, 'AI_UNAVAILABLE: malformed JSON'); }
  }

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
