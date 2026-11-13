'use strict';
/**
 * Proposal starter for a strong lead. Template-only (no model call, $0):
 * it gives Jordan a first paragraph to edit, never something to send as-is.
 * Nothing here submits anything — the draft is stored with the lead and
 * shown in Ursula.
 */

function fmtBudget(b) {
  if (!b) return null;
  const cur = b.currency && b.currency !== 'USD' ? `${b.currency} ` : '$';
  if (Number.isFinite(b.min) && Number.isFinite(b.max) && b.max) {
    return `${cur}${b.min}–${cur}${b.max}${b.type === 'hourly' ? '/hr' : ''}`;
  }
  return b.text || null;
}

function draftProposal(lead, division) {
  const skills = (lead.matched || []).slice(0, 4).join(', ');
  const pitch = division && division.pitch ? division.pitch : 'this kind of work';
  const lines = [
    `Hi — I read your post "${lead.title}".`,
    '',
    `This is squarely what we do: ${pitch}.${skills ? ` Relevant here: ${skills}.` : ''}`,
    '',
    'How I would approach it:',
    '1. A short call or a few questions to pin down scope and what "done" looks like.',
    '2. A fixed milestone plan with a first deliverable you can review early.',
    '3. Delivery with notes so you can maintain it afterwards.',
    '',
    'A couple of questions before I quote: [EDIT: 1–2 specific questions about their post].',
    '',
    '— Jordan, ProtoForge',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Optional local-model drafts — JOB_SCOUT_LLM_DRAFTS=true only.
// Local Ollama (qwen2.5:3b on Frank) is the ONLY model path: no paid
// provider is ever contacted, so lib/cost/paid-llm-gate.js has nothing to
// gate here. Any error, timeout or malformed output falls back to the
// template above. The draft is stored for Jordan to edit — it is never
// sent anywhere.
// ---------------------------------------------------------------------------

const EDIT_PLACEHOLDER = /\[EDIT:[^\]]*\]/;

function llmDraftPrompt(lead, division) {
  const pitch = division && division.pitch ? division.pitch : 'this kind of work';
  const skills = (lead.matched || []).slice(0, 4).join(', ');
  const desc = String(lead.description || '').slice(0, 1200);
  return [
    'Write a short, honest first-reply proposal draft for this freelance job post.',
    'Rules: 3 short paragraphs max, no hype, no promises of price or timeline,',
    'end with one bracketed placeholder the human must fill in, signed "— Jordan, ProtoForge".',
    `Our fit: ${pitch}.${skills ? ` Relevant skills: ${skills}.` : ''}`,
    '',
    `Post title: ${lead.title}`,
    `Post description: ${desc}`,
  ].join('\n');
}

/**
 * @returns {Promise<string>} LLM draft, or the template on ANY failure.
 */
async function llmDraft(lead, division, { env = process.env, fetchImpl, timeoutMs = 20000, model } = {}) {
  const fetcher = fetchImpl || globalThis.fetch;
  const ollamaUrl = (env.OLLAMA_URL || env.LOCAL_MODEL_URL || 'http://localhost:11434').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || env.JOB_SCOUT_DRAFT_MODEL || 'qwen2.5:3b',
        prompt: llmDraftPrompt(lead, division),
        stream: false,
        options: { num_predict: 220, temperature: 0.4 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = String(data.response || '').trim();
    if (!text) throw new Error('empty model response');
    // Keep the human-edit contract: no [EDIT: …] placeholder -> template.
    return EDIT_PLACEHOLDER.test(text) ? text : draftProposal(lead, division);
  } catch {
    return draftProposal(lead, division);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draft entry point used by the scout. Template unless the operator opted
 * into local-model drafts.
 */
async function draftFor(lead, division, opts = {}) {
  const env = opts.env || process.env;
  if (env.JOB_SCOUT_LLM_DRAFTS !== 'true') return draftProposal(lead, division);
  return llmDraft(lead, division, opts);
}

module.exports = { draftProposal, draftFor, llmDraft, llmDraftPrompt, fmtBudget };
