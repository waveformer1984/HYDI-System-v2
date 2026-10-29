'use strict';

/**
 * Picks durable memories out of what the USER said. Deterministic patterns
 * only: nothing the model generated becomes a memory, so a hallucinated
 * answer can never be recalled later as fact.
 *
 * Each candidate: { category, key, content, importance }.
 */

const RULES = [
  // "remember (that) my X is Y" / "remember X"
  {
    re: /^\s*(?:please\s+)?remember(?:\s+that)?\s+(.{3,400}?)\s*[.!]?\s*$/i,
    build: (m) => {
      const body = m[1];
      const kv = /^(?:my|our|the)\s+(.{2,60}?)\s+(?:is|are|=)\s+(.{1,300})$/i.exec(body);
      return kv
        ? { category: 'fact', key: kv[1], content: body, importance: 0.8 }
        : { category: 'fact', key: null, content: body, importance: 0.7 };
    },
  },
  // "my X is Y" anywhere (stable fact)
  {
    re: /\bmy\s+((?:[a-z][\w'-]*\s?){1,6}?)\s+(?:is|are)\s+([^.!?\n]{1,200})/i,
    build: (m) => ({ category: 'fact', key: `my ${m[1]}`, content: `My ${m[1].trim()} is ${m[2].trim()}`, importance: 0.6 }),
  },
  // preferences
  {
    re: /\bI\s+(?:prefer|always want|would like you to|want you to always|like it when you)\s+([^.!?\n]{3,240})/i,
    build: (m) => ({ category: 'preference', key: null, content: `Prefers: ${m[1].trim()}`, importance: 0.8 }),
  },
  // decisions with optional rationale
  {
    re: /\b(?:we|i)\s+(?:have\s+)?decided\s+(?:to\s+|that\s+)?([^.!?\n]{3,240}?)(?:\s+because\s+([^.!?\n]{3,240}))?(?:[.!?]|$)/i,
    build: (m) => ({ category: 'decision', key: null, content: m[2] ? `Decided: ${m[1].trim()} — because ${m[2].trim()}` : `Decided: ${m[1].trim()}`, importance: 0.8 }),
  },
  // open tasks and blockers
  {
    re: /\b(?:todo|to-do|task|blocker|blocked on|still need to)\s*[:-]?\s+([^\n]{3,240})/i,
    build: (m, text) => ({ category: 'task', key: null, content: `${/block/i.test(text) ? 'Blocker' : 'Open task'}: ${m[1].trim().replace(/[.!]$/, '')}`, importance: 0.7 }),
  },
  // completed work
  {
    re: /\b(?:done|completed|finished|shipped|merged)\s*[:-]\s*([^\n]{3,240})/i,
    build: (m) => ({ category: 'completed', key: null, content: `Completed: ${m[1].trim().replace(/[.!]$/, '')}`, importance: 0.6 }),
  },
  // architecture notes
  {
    re: /\barchitecture\s*[:-]\s*([^\n]{3,300})/i,
    build: (m) => ({ category: 'architecture', key: null, content: m[1].trim(), importance: 0.7 }),
  },
  // lessons learned
  {
    re: /\blesson(?:s)?(?:\s+learned)?\s*[:-]\s*([^\n]{3,300})/i,
    build: (m) => ({ category: 'lesson', key: null, content: `Lesson: ${m[1].trim()}`, importance: 0.7 }),
  },
];

/** Candidate memories from one user message. Questions are never memories. */
function extractMemories(userText) {
  const text = String(userText || '').trim();
  if (!text || text.length > 1500) return [];
  if (/^\s*memory\b/i.test(text)) return []; // memory commands are not facts
  const out = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    // "what is my X?" is a question, not a statement.
    if (/\?\s*$/.test(text) && !/^\s*(?:please\s+)?remember/i.test(text)) continue;
    const c = rule.build(m, text);
    if (c && c.content && !out.some((o) => o.content.toLowerCase() === c.content.toLowerCase())) out.push(c);
    if (rule.re.source.startsWith('^\\s*(?:please\\s+)?remember')) break; // an explicit "remember" is the whole message
  }
  return out;
}

module.exports = { extractMemories };
