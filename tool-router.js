#!/usr/bin/env node
/**
 * tool-router.js
 *
 * Two-stage tool router for small local models (llama3.2, qwen2.5-coder, etc.)
 * via Ollama's /api/chat endpoint.
 *
 * Problem: passing all 14 HEIDI tools to a small model causes it to drop
 * tool_calls entirely and respond with prose instead (see diagnose-toolcall-2.js).
 * Test D showed that with the SAME prompt but only 1 tool, tool_calls worked.
 *
 * Fix: narrow the tool list before the model ever sees it.
 *   Stage 1 (cheap, no LLM call): keyword/intent match against the user
 *     message to pick the top N candidate tools (default N=3).
 *   Stage 2 (LLM call): send the full system prompt + narrowed tool list
 *     to Ollama. If tool_calls comes back, execute it. If not, fall back
 *     to a plain response (no tools).
 *
 * Usage:
 *   const { routeAndCall } = require('./tool-router');
 *   const result = await routeAndCall({ message: userMessage, tools: ALL_TOOLS, executors });
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:1.5b';
const MAX_CANDIDATES = parseInt(process.env.TOOL_ROUTER_MAX_CANDIDATES || '3');

/**
 * Stage 1: rank tools by simple keyword overlap between the user message
 * and each tool's name + description. No LLM call — fast and deterministic.
 */
function narrowTools(message, tools, maxCandidates = MAX_CANDIDATES) {
  const msgWords = tokenize(message);

  const scored = tools.map(t => {
    const fn = t.function || t;
    const haystack = `${fn.name} ${fn.description || ''}`.replace(/_/g, ' ');
    const tWords = tokenize(haystack);
    let score = 0;
    for (const w of msgWords) {
      if (tWords.includes(w)) score += 1;
      // partial match bonus (e.g. "health" vs "healthy")
      else if (tWords.some(tw => tw.startsWith(w) || w.startsWith(tw))) score += 0.5;
    }
    return { tool: t, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Always include at least one tool so the model has *something*; if
  // everything scored 0, fall back to the first MAX_CANDIDATES in original order.
  const anyMatch = scored.some(s => s.score > 0);
  const top = anyMatch
    ? scored.filter(s => s.score > 0).slice(0, maxCandidates).map(s => s.tool)
    : tools.slice(0, maxCandidates);

  return top;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'can', 'you', 'for', 'with', 'and', 'this', 'that', 'current']);

/**
 * Stage 2: call Ollama with the narrowed tool list.
 */
async function callOllama({ message, system, tools, model = DEFAULT_MODEL, temperature = 0.0 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: message });

  const body = {
    model,
    messages,
    stream: false,
    options: { temperature }
  };
  if (tools && tools.length) body.tools = tools;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Full pipeline: narrow tools, call model, execute tool_calls if present,
 * otherwise return the plain text response.
 *
 * @param {object} opts
 * @param {string} opts.message - user message
 * @param {Array}  opts.tools - full tool list (OpenAI/Ollama function-call format)
 * @param {object} [opts.executors] - map of toolName -> async (args) => result
 * @param {string} [opts.system] - system prompt
 * @param {string} [opts.model]
 */
async function routeAndCall({ message, tools, executors = {}, system, model }) {
  const candidates = narrowTools(message, tools);

  let data = await callOllama({ message, system, tools: candidates, model });
  let msg = data.message || {};

  // Retry once with zero tools narrowed to a single best guess if the model
  // still didn't call a tool but candidates.length > 1 — smaller models do
  // better with exactly 1 tool (per diagnose-toolcall-2.js test D).
  if (!(msg.tool_calls && msg.tool_calls.length) && candidates.length > 1) {
    data = await callOllama({ message, system, tools: [candidates[0]], model });
    msg = data.message || {};
  }

  if (msg.tool_calls && msg.tool_calls.length) {
    const results = [];
    for (const call of msg.tool_calls) {
      const name = call.function?.name;
      let args = call.function?.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { /* leave as string */ }
      }
      const executor = executors[name];
      if (executor) {
        try {
          results.push({ name, args, result: await executor(args) });
        } catch (e) {
          results.push({ name, args, error: e.message });
        }
      } else {
        results.push({ name, args, error: 'no executor registered' });
      }
    }
    return { type: 'tool_calls', candidates: candidates.map(c => (c.function || c).name), results, raw: msg };
  }

  return { type: 'text', candidates: candidates.map(c => (c.function || c).name), content: msg.content || '', raw: msg };
}

module.exports = { narrowTools, callOllama, routeAndCall };

// --- self-test when run directly ---
if (require.main === module) {
  const ALL_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'get_ursula_live',
        description: 'Get live health/status from the Ursula monitoring endpoint',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'API path, e.g. /api/health' } }, required: ['path'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_lead',
        description: 'Create a new lead in the revenue pipeline',
        parameters: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } }, required: ['name', 'email'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'restart_local_server',
        description: 'Restart a named local service (heidi, ursula, etc.)',
        parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] }
      }
    }
  ];

  const executors = {
    get_ursula_live: async (args) => ({ status: 'healthy', path: args.path, checked_at: new Date().toISOString() })
  };

  (async () => {
    const message = "What's the current health status of the Ursula app?";
    console.log(`Message: "${message}"`);
    console.log(`Candidates (stage 1): ${narrowTools(message, ALL_TOOLS).map(t => t.function.name).join(', ')}`);
    const result = await routeAndCall({ message, tools: ALL_TOOLS, executors });
    console.log(JSON.stringify(result, null, 2));
  })().catch(e => { console.error('Self-test failed:', e.message); process.exit(1); });
}
