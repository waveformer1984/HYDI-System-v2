'use strict';

/**
 * HYDI Intelligence Router — selects architecture per task (experimental NCM path).
 * Production default: LLM (Ollama) via existing ModelManager. NCM requires
 * HYDI_NCM_ENABLED=1 and a healthy services/ncm-inference process.
 */

const { ENGINES, NCM_ELIGIBLE_TASKS, LLM_DEFAULT_TASKS } = require('./engines');
const { ncmEnabled, probeNcmHealth, generateViaNcm } = require('./ncm-client');

function normalizeTask(task) {
  const t = String(task || 'conversation').toLowerCase().replace(/-/g, '_');
  return t;
}

/**
 * @param {{ task?: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {{ engine: string, reason: string, ncm_eligible: boolean }}
 */
function selectEngine(opts = {}) {
  const env = opts.env || process.env;
  const task = normalizeTask(opts.task);
  const ncm_eligible = NCM_ELIGIBLE_TASKS.includes(task);

  if (!ncmEnabled(env)) {
    return { engine: ENGINES.LLM, reason: 'ncm_disabled', ncm_eligible };
  }

  if (env.HYDI_INTELLIGENCE_ROUTER === '0' || env.HYDI_INTELLIGENCE_ROUTER === 'false') {
    return { engine: ENGINES.LLM, reason: 'router_explicitly_off', ncm_eligible };
  }

  if (task === 'memory_retrieval' || task === 'memory_search') {
    return { engine: ENGINES.MEMORY, reason: 'task_requires_memory_engine', ncm_eligible: false };
  }

  if (task === 'agent_plan' || task === 'agent_execute') {
    return { engine: ENGINES.AGENT, reason: 'task_requires_agent_engine', ncm_eligible: false };
  }

  if (ncm_eligible) {
    return { engine: ENGINES.NCM, reason: 'ncm_eligible_task', ncm_eligible: true };
  }

  if (LLM_DEFAULT_TASKS.includes(task)) {
    return { engine: ENGINES.LLM, reason: 'default_llm_task', ncm_eligible: false };
  }

  return { engine: ENGINES.LLM, reason: 'unknown_task_fallback_llm', ncm_eligible };
}

/**
 * Complete text with automatic fallback to LLM delegate when NCM is unavailable or fails.
 *
 * @param {{ prompt: string, task?: string, sessionId?: string }} input
 * @param {() => Promise<{ content: string, success: boolean, model?: string, latency?: number, error?: string }>} llmFallback
 * @param {NodeJS.ProcessEnv} [env]
 */
async function completeWithRouter(input, llmFallback, env = process.env) {
  const selection = selectEngine({ task: input.task, env });
  const trace = {
    selected_engine: selection.engine,
    selection_reason: selection.reason,
    task: normalizeTask(input.task),
    attempted_ncm: false,
    fallback_to_llm: false,
    ncm_error: null,
  };

  if (selection.engine !== ENGINES.NCM) {
    const llm = await llmFallback();
    return {
      ...llm,
      router: trace,
      engine: ENGINES.LLM,
    };
  }

  trace.attempted_ncm = true;
  const health = await probeNcmHealth(env);
  if (!health.ok) {
    trace.fallback_to_llm = true;
    trace.ncm_error = health.error || 'ncm_unhealthy';
    const llm = await llmFallback();
    return { ...llm, router: trace, engine: ENGINES.LLM };
  }

  const ncm = await generateViaNcm(
    { prompt: input.prompt, task: input.task, max_tokens: input.max_tokens },
    env,
  );

  if (ncm.ok && ncm.text) {
    return {
      content: ncm.text,
      success: true,
      model: 'ncm/experimental',
      latency: ncm.latencyMs,
      engine: ENGINES.NCM,
      metadata: ncm.metadata,
      router: trace,
    };
  }

  trace.fallback_to_llm = true;
  trace.ncm_error = ncm.error || 'ncm_generate_failed';
  const llm = await llmFallback();
  return { ...llm, router: trace, engine: ENGINES.LLM };
}

function describeRouter(env = process.env) {
  return {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    ncm_enabled: ncmEnabled(env),
    ncm_service_url: require('./ncm-client').ncmServiceUrl(env),
    intelligence_router: env.HYDI_INTELLIGENCE_ROUTER !== '0',
    eligible_ncm_tasks: [...NCM_ELIGIBLE_TASKS],
    engines: Object.values(ENGINES),
    note: 'NCM is experimental; promotion requires scripts/benchmark-ncm-integration.js gates',
  };
}

module.exports = {
  ENGINES,
  selectEngine,
  completeWithRouter,
  describeRouter,
  NCM_ELIGIBLE_TASKS,
};