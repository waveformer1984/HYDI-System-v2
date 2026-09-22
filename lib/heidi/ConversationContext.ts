/**
 * ConversationContext — Heidi's durable world model over the `memories`
 * table. Separates life context from operational truth:
 *
 *   kind='project'  → a thing J is working on (Rezonate, HYDI, Proto YI…)
 *   kind='focus'    → the single current focus (one active row)
 *   kind='note'     → conversational facts worth remembering
 *                     ("thinking about X", "prefers concise reports")
 *
 * These are conversational/contextual memory — they describe what the
 * user is doing or said, never operational state. Operational truth
 * stays in coo_state / heidi_events / the goal system.
 *
 * Pure read/write helpers over an injected Supabase client so the unit
 * tests can stub it. The orchestrator's semantic memory retrieval already
 * surfaces these rows to the LLM; this module is the deterministic
 * write/recall path so chat never has to guess.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  status: string;
  updatedAt: string;
}

export interface LifeContext {
  focus: { project: string; since: string } | null;
  projects: ProjectRow[];
  notes: string[];
}

type Sb = Pick<SupabaseClient, 'from'>;

function rowToProject(r: Record<string, unknown>): ProjectRow {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(meta.name ?? r.content ?? 'unnamed'),
    summary: String(meta.summary ?? r.content ?? ''),
    status: String(meta.status ?? 'active'),
    updatedAt: String(r.created_at ?? ''),
  };
}

export async function getLifeContext(sb: Sb, userId: string): Promise<LifeContext> {
  const { data, error } = await sb.from('memories')
    .select('id, content, kind, metadata, created_at, importance_score')
    .eq('user_id', userId)
    .in('kind', ['project', 'focus', 'note'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return { focus: null, projects: [], notes: [] };

  const projects: ProjectRow[] = [];
  const notes: string[] = [];
  let focus: LifeContext['focus'] = null;
  for (const r of data) {
    if (r.kind === 'project') projects.push(rowToProject(r));
    else if (r.kind === 'note') notes.push(String(r.content));
    else if (r.kind === 'focus' && !focus) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      if (meta.superseded !== true) {
        focus = { project: String(meta.project ?? r.content), since: String(r.created_at) };
      }
    }
  }
  return { focus, projects, notes: notes.slice(0, 10) };
}

/** Find a project by name or alias-ish substring match. */
export function findProject(ctx: LifeContext, name: string): ProjectRow | null {
  const n = name.toLowerCase().trim();
  return ctx.projects.find((p) =>
    p.name.toLowerCase() === n || p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase()),
  ) ?? null;
}

/**
 * Set the current focus. Creates the project row if unknown. Archives any
 * previous focus row (importance → 0 marks it superseded; the row itself
 * stays as history via created_at ordering).
 */
export async function setFocus(
  sb: Sb, userId: string, projectName: string, sessionId: string, summary?: string,
): Promise<{ project: ProjectRow; created: boolean }> {
  const ctx = await getLifeContext(sb, userId);
  let project = findProject(ctx, projectName);
  let created = false;
  if (!project) {
    const { data, error } = await sb.from('memories')
      .insert({
        user_id: userId, session_id: sessionId, content: `project: ${projectName}${summary ? ` — ${summary}` : ''}`,
        kind: 'project', tags: ['project'], importance_score: 0.8,
        metadata: { name: projectName, summary: summary ?? '', status: 'active' },
      })
      .select('id, content, metadata')
      .single();
    if (error) throw new Error(`project create failed: ${error.message}`);
    project = rowToProject(data);
    created = true;
  }
  // Supersede previous focus rows
  await sb.from('memories')
    .update({ importance_score: 0, metadata: { superseded: true, project: 'previous' } })
    .eq('user_id', userId).eq('kind', 'focus');
  const { error } = await sb.from('memories').insert({
    user_id: userId, session_id: sessionId, content: `current focus: ${project.name}`,
    kind: 'focus', tags: ['focus'], importance_score: 1.0,
    metadata: { project: project.name },
  });
  if (error) throw new Error(`focus set failed: ${error.message}`);
  // Audit event — focus changes are context, not operational state, but
  // they are durable evidence of what the human said.
  await sb.from('heidi_events').insert({
    event_type: 'context_change', division: 'conversation',
    payload: { kind: 'focus', project: project.name, actor: userId },
    verdict: 'RECORDED',
  }).then(() => undefined, () => undefined);
  return { project, created };
}

/** Store a conversational note. */
export async function remember(sb: Sb, userId: string, text: string, sessionId: string): Promise<void> {
  const { error } = await sb.from('memories').insert({
    user_id: userId, session_id: sessionId, content: text,
    kind: 'note', tags: ['note'], importance_score: 0.6,
    metadata: { source: 'chat' },
  });
  if (error) throw new Error(`remember failed: ${error.message}`);
}

/** Deterministic answer for "what are we working on" / "where did we leave off". */
export function recallAnswer(ctx: LifeContext): string {
  const parts: string[] = [];
  if (ctx.focus) {
    const p = ctx.projects.find((x) => x.name === ctx.focus!.project);
    parts.push(`Current focus: ${ctx.focus.project}${p?.summary ? ` — ${p.summary}` : ''}.`);
  } else {
    parts.push('No focus is set — tell me what to work on ("focus rezonate", "let\'s work on HYDI").');
  }
  if (ctx.projects.length > 0) {
    parts.push(`Known projects: ${ctx.projects.map((p) => p.name).join(', ')}.`);
  }
  if (ctx.notes.length > 0) {
    parts.push(`Recent notes: ${ctx.notes.slice(0, 3).map((n) => `"${n.slice(0, 80)}"`).join('; ')}`);
  }
  return parts.join('\n');
}

/**
 * Deterministic intent router for the conversation layer. Returns the
 * parsed intent or null — the caller falls through to operational
 * classifiers / LLM chat. This layer NEVER executes anything; the
 * 'investigate' intent is translated by the caller into a governed goal.
 */
export type LifeIntent =
  | { kind: 'focus'; project: string }
  | { kind: 'forget' }
  | { kind: 'remember'; text: string }
  | { kind: 'remember_last' }
  | { kind: 'recall' }
  | { kind: 'briefing' }
  | { kind: 'greeting' }
  | { kind: 'plate' }
  | { kind: 'next_steps' }
  | { kind: 'findings' }
  | { kind: 'control_last'; action: 'stop' | 'retry' }
  | { kind: 'investigate'; target: string }
  | { kind: 'investigate_top' };

export function classifyLifeIntent(message: string): LifeIntent | null {
  // Strip a leading vocative — "Heidi, investigate…" is natural speech.
  const m = message.trim()
    .replace(/^(?:hey|ok(?:ay)?|so|please)[,.\s]*/i, '')
    .replace(/^heidi[,.\s]*/i, '')
    .replace(/[.?!]+\s*$/, '')   // trailing punctuation is speech, not syntax
    .trim();
  const focus = m.match(/^(?:focus|work on|let'?s work on|i (?:want to|wanna) work on|switch to|back to|get back to)\s+(.+?)(?:[.?!]|$)/i);
  if (focus) {
    // strip trailing temporal fillers: "work on protoforge today" → protoforge
    const project = focus[1].replace(/\s+(?:today|now|for now|this week|tonight)$/i, '').trim();
    return { kind: 'focus', project };
  }
  const rem = m.match(/^remember\s+(?:that\s+)?(.+)$/i);
  if (rem) return { kind: 'remember', text: rem[1].trim() };
  // Bare "remember that" — store the current focus as a priority note;
  // handler decides what 'that' resolves to from durable state.
  if (/^remember\s+(?:that|it|this)$/i.test(m)) return { kind: 'remember_last' };
  // Greeting / presence — "I'm here", "hi heidi", bare "heidi"
  if (/^(?:i'?m (?:here|back)|hi|hello|hey|good (?:morning|afternoon|evening)|morning|evening|heidi)$/i.test(m)) {
    return { kind: 'greeting' };
  }
  // "What's on my plate", "what matters today/there", "what's important"
  if (/what'?s on my plate|what'?s (important|the priority)|what (matters|is important)( today| there| now)?|what should i (look at|care about)/i.test(m)) {
    return { kind: 'plate' };
  }
  // Governed last-thing control — resolves to the most recent mission.
  if (/^(?:stop|kill|cancel|halt)\s+(?:that|it|this)$/i.test(m)) return { kind: 'control_last', action: 'stop' };
  if (/^(?:retry|rerun|try again|redo)\s+(?:that|it|this)?$/i.test(m)) return { kind: 'control_last', action: 'retry' };
  if (/^(?:forget (?:that|it|this)|never ?mind|drop it|leave it)(?:\s+for now)?$/i.test(m)) {
    return { kind: 'forget' };
  }
  if (/what (are|were) we working on|what'?s the focus|where did we leave off|where were we|what was i (doing|working on)/i.test(m)) {
    return { kind: 'recall' };
  }
  // Unified briefing — "give me the real picture", "I'm here, what's up"
  if (/real picture|big picture|full briefing|catch me up|bring me up to speed|what'?s up|give me (the )?(rundown|briefing|summary)/i.test(m)) {
    return { kind: 'briefing' };
  }
  // Forward-looking: "what should happen next", "what do we do now"
  if (/what should (happen|we do|i do) next|what'?s next|next steps?|what now/i.test(m)) {
    return { kind: 'next_steps' };
  }
  // Bounded operational translation: "investigate <uuid-or-opportunity-ref>"
  // → governed agent mission. Requires an explicit target — no inference.
  const inv = m.match(/^(?:investigate|look into|research)\s+(?:opportunity\s+)?([0-9a-f-]{8,}|"[^"]+"|'.+')$/i);
  if (inv) {
    const target = inv[1].replace(/^['"]|['"]$/g, '');
    return { kind: 'investigate', target };
  }
  // Natural objective without a target: "investigate whether there are
  // worthwhile opportunities", "find the best protoforge opportunities".
  // IMPERATIVE ONLY — the message must start with a verb; questions like
  // "what did protoforge find" are never turned into actions.
  if (/^(?:investigate|research|find|look for|scout|dig into|check)\b.*\b(?:opportunit|protoforge|market)\b/i.test(m)) {
    return { kind: 'investigate_top' };
  }
  // "Go investigate the most useful thing", "go ahead with the next
  // useful investigation" — imperative investigation where the target is
  // 'the useful thing' → governed top-opportunity selection.
  if (/^(?:go )?investigate\b.*\b(?:most useful|best|top|important|worth|next)\b/i.test(m)
    || /^(?:go ahead|proceed|continue)\b.*\binvestigat/i.test(m)) {
    return { kind: 'investigate_top' };
  }
  // Anaphoric investigation — "go investigate it", "dig into that" —
  // resolves to the current top unreviewed opportunity; if there is no
  // topical anchor the caller still gets a governed selection.
  // "look into it" deliberately excluded — the spec treats it as the
  // canonical ambiguous request (UNKNOWN/ask), not an action.
  if (/^(?:go )?(?:investigate|dig into|check out|research)\s+(?:it|that|this|them)(?:\s+further)?$/i.test(m)) {
    return { kind: 'investigate_top' };
  }
  // Read-only result recall: "what did the agents find", "do they agree"
  if (/\b(?:what did (the agents?|you|we) (find|say|discover)|do (the agents?|they) agree|agent results?|latest (findings|results)|check what happened|what happened (there|with it|with that))\b/i.test(m)) {
    return { kind: 'findings' };
  }
  // "What do you remember about X" — full recall is honest (notes are
  // user-visible anyway); a scoped filter would pretend precision we
  // don't have.
  if (/what do you remember/i.test(m)) return { kind: 'recall' };
  return null;
}

/** Clear the current focus (supersede, durable). */
export async function clearFocus(sb: Sb, userId: string): Promise<boolean> {
  const ctx = await getLifeContext(sb, userId);
  if (!ctx.focus) return false;
  await sb.from('memories')
    .update({ importance_score: 0, metadata: { superseded: true, project: ctx.focus.project } })
    .eq('user_id', userId).eq('kind', 'focus');
  return true;
}
