#!/usr/bin/env node
/**
 * diagnose-toolcall-3.js
 *
 * Repeats the diagnose-toolcall-2.js matrix (A-E) but swaps the model to
 * qwen2.5-coder:1.5b, which generally has more reliable Ollama-native
 * function-calling than llama3.2 at small sizes. Also adds a run with the
 * full 14-tool set at temperature 0 (greedy), since tool selection is more
 * deterministic at low temperature.
 *
 * Usage: node diagnose-toolcall-3.js
 * Requires: Ollama running locally with qwen2.5-coder:1.5b pulled
 *   ollama pull qwen2.5-coder:1.5b
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:1.5b';

const SYSTEM_PROMPT = `You are Heidi, the AI assistant for the HYDI ProtoForge system.
You run locally on the user's device via Ollama.
You are helpful, direct, and slightly warm in personality.
You assist with: system health monitoring, technical questions, deployments, code, and general tasks.
When asked to take an action, explain what you will do clearly and concisely.
Keep responses concise (under 300 words) unless the user explicitly asks for detail.
Current date/time: ${new Date().toLocaleString()}`;

const SHORT_PROMPT = `You are Heidi. Use tools when helpful.`;

// Representative 14-tool set covering HEIDI/ProtoForge subsystems
const TOOLS = [
  tool('get_ursula_live', 'Get live health/status from the Ursula monitoring endpoint', { path: 'string (API path, e.g. /api/health)' }),
  tool('get_system_health', 'Read the system_dashboard Supabase view for overall health metrics', {}),
  tool('get_ledger_entry', 'Look up a ledger entry by id, including fee breakdown and payout status', { id: 'string' }),
  tool('list_revenue_streams', 'List active Stripe Connect revenue streams and their balances', {}),
  tool('get_client_dashboard', 'Get the per-project ledger view for a client', { project_id: 'string' }),
  tool('create_lead', 'Create a new lead in the revenue pipeline', { name: 'string', email: 'string' }),
  tool('create_quote', 'Create a quote for a lead', { lead_id: 'string', amount: 'number' }),
  tool('create_checkout_session', 'Create a Stripe Checkout session for a quote', { quote_id: 'string' }),
  tool('get_cascade_classification', 'Classify a raw event via CASCADE', { event_id: 'string' }),
  tool('get_kilo_hypotheses', 'Get KILO hypotheses/suggested fixes for a classified event', { event_id: 'string' }),
  tool('get_protoforge_decision', 'Get ProtoForge policy decision on a KILO suggestion', { suggestion_id: 'string' }),
  tool('query_memory', 'Search the vector memory store', { query: 'string', user_id: 'string' }),
  tool('get_session_state', 'Get tone/model/last-action state for a session', { session_id: 'string' }),
  tool('restart_local_server', 'Restart a named local service (heidi, ursula, etc.)', { service: 'string' }),
];

function tool(name, description, props) {
  const properties = {};
  const required = [];
  for (const [k, v] of Object.entries(props)) {
    properties[k] = { type: v.startsWith('number') ? 'number' : 'string', description: v };
    required.push(k);
  }
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } }
  };
}

const USER_MESSAGE = "What's the current health status of the Ursula app?";

async function callOllama({ label, system, tools, temperature }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: USER_MESSAGE });

  const body = {
    model: MODEL,
    messages,
    stream: false,
    options: { temperature }
  };
  if (tools) body.tools = tools;

  const start = Date.now();
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    console.log(`[${label}] REQUEST FAILED: ${e.message}`);
    return;
  }

  if (!res.ok) {
    console.log(`[${label}] HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  const data = await res.json();
  const ms = Date.now() - start;
  const msg = data.message || {};
  const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

  console.log(`[${label}] tool_calls: ${hasToolCalls ? 'YES (' + msg.tool_calls.map(c => c.function?.name).join(', ') + ')' : 'NO'}  (${ms}ms)`);
  if (!hasToolCalls && msg.content) {
    console.log(`         content: "${msg.content.slice(0, 140)}"...`);
  }
}

(async () => {
  console.log(`Model: ${MODEL}`);
  console.log(`Tools available: ${TOOLS.length}`);
  console.log('--- Running matrix ---\n');

  await callOllama({ label: 'A: full prompt + 14 tools + temp 0.7', system: SYSTEM_PROMPT, tools: TOOLS, temperature: 0.7 });
  await callOllama({ label: 'B: full prompt + 14 tools + temp 0.1', system: SYSTEM_PROMPT, tools: TOOLS, temperature: 0.1 });
  await callOllama({ label: 'C: no system prompt + 14 tools + temp 0.7', system: null, tools: TOOLS, temperature: 0.7 });
  await callOllama({ label: 'D: full prompt + 1 tool + temp 0.7', system: SYSTEM_PROMPT, tools: [TOOLS[0]], temperature: 0.7 });
  await callOllama({ label: 'E: short prompt + 14 tools + temp 0.7', system: SHORT_PROMPT, tools: TOOLS, temperature: 0.7 });
  await callOllama({ label: 'F: full prompt + 14 tools + temp 0.0 (greedy)', system: SYSTEM_PROMPT, tools: TOOLS, temperature: 0.0 });
  await callOllama({ label: 'G: short prompt + 3 tools + temp 0.0', system: SHORT_PROMPT, tools: TOOLS.slice(0, 3), temperature: 0.0 });

  console.log('\n--- Done. Compare against diagnose-toolcall-2.js (llama3.2) results. ---');
  console.log('If G/F succeed where llama3.2 failed, qwen2.5-coder + a narrowed tool set');
  console.log('is the way forward -> see tool-router.js for the two-stage approach.');
})();
