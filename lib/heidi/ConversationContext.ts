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
  | { kind: 'remember'; text: string }
  | { kind: 'recall' }
  | { kind: 'findings' }
  | { kind: 'investigate'; target: string }
  | { kind: 'investigate_top' };

export function classifyLifeIntent(message: string): LifeIntent | null {
  const m = message.trim();
  const focus = m.match(/^(?:focus|work on|let'?s work on|switch to|back to|get back to)\s+(.+)$/i);
  if (focus) return { kind: 'focus', project: focus[1].replace(/[.?!]+$/, '').trim() };
  const rem = m.match(/^remember\s+(?:that\s+)?(.+)$/i);
  if (rem) return { kind: 'remember', text: rem[1].trim() };
  if (/what (are|were) we working on|what'?s the focus|where did we leave off|what was i (doing|working on)/i.test(m)) {
    return { kind: 'recall' };
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
  // Read-only result recall: "what did the agents find", "do they agree"
  if (/\b(?:what did the agents? (find|say)|do the agents? agree|agent results?|latest (findings|results))\b/i.test(m)) {
    return { kind: 'findings' };
  }
  return null;
}
