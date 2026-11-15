'use strict';

/**
 * Authoritative inference path registry (Phase 2 — intelligence consolidation).
 * Describes which code path serves each chat surface under current env gates.
 * Does not invoke models; callers use this for tracing, dashboards, and audits.
 */

const { isPaidLlmAllowed, paidApiKey } = require('../cost/paid-llm-gate');

const SURFACES = Object.freeze({
  DASHBOARD_API_CHAT: 'dashboard_api_chat',
  HEIDI_CORE_CHAT_TOOLS: 'heidi_core_chat_tools',
  HEIDI_CORE_THINK_STREAM: 'heidi_core_think_stream',
  HEIDI_MOBILE_RELAY: 'heidi_mobile_relay',
  ANTHROPIC_AGENT: 'anthropic_agent',
  COGNITIVE_CORE_PLANNER: 'cognitive_core_planner',
  API_CHAT_PAO: 'api_chat_pao_controller',
});

function ollamaEndpoint(env) {
  return (
    env.LOCAL_MODEL_URL ||
    env.OLLAMA_URL ||
    env.OLLAMA_HOST ||
    'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
}

/**
 * @param {string} surface One of SURFACES
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveInferenceRoute(surface, env = process.env) {
  const paid = isPaidLlmAllowed(env);
  const anthropicKey = paidApiKey('ANTHROPIC_API_KEY', env);
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const ollama = ollamaEndpoint(env);

  const base = {
    surface,
    collected_at: new Date().toISOString(),
    cost: { paid_llm_allowed: paid, gate: 'HYDI_ALLOW_PAID_LLM' },
    timeouts: {
      heidi_core_chat_ms: 30_000,
      local_model_ms: Number(env.LOCAL_MODEL_TIMEOUT_MS || 60_000),
    },
  };

  switch (surface) {
    case SURFACES.HEIDI_CORE_CHAT_TOOLS:
      return {
        ...base,
        primary: { module: 'heidi-core/server.js', route: 'POST /chat-tools', provider: 'ollama', endpoint: ollama },
        fallback: null,
        memory: 'heidi_memory.db via MemoryRuntime',
      };
    case SURFACES.HEIDI_CORE_THINK_STREAM:
      return {
        ...base,
        primary: { module: 'heidi-core/server.js', route: 'POST /think-stream', provider: 'ollama', endpoint: ollama },
        fallback: null,
        memory: 'heidi_memory.db',
      };
    case SURFACES.HEIDI_MOBILE_RELAY:
      return {
        ...base,
        primary: { module: 'launch-heidi-mobile.js', route: 'relay', provider: 'heidi-core', endpoint: env.HEIDI_CORE_URL || 'http://127.0.0.1:3459' },
        path_order: ['/chat-tools', '/think-stream'],
        fallback: null,
      };
    case SURFACES.DASHBOARD_API_CHAT:
      return {
        ...base,
        primary: { module: 'lib/heidi-core-chat.js', route: 'POST /chat-tools|/think-stream', provider: 'heidi-core→ollama', endpoint: ollama },
        fallback: anthropicKey
          ? { module: 'lib/heidi-agent.ts', provider: 'anthropic', model }
          : { module: 'api/chat/route.js + orchestrator', provider: 'local/degraded', model: null },
        note: 'heidi-core-chat is tried before legacy orchestrator when wired in pages/api/chat',
      };
    case SURFACES.ANTHROPIC_AGENT:
      return {
        ...base,
        primary: anthropicKey
          ? { module: 'lib/heidi-agent.ts', provider: 'anthropic', model }
          : null,
        fallback: { module: 'lib/ModelManager.ts', provider: 'ollama', endpoint: ollama },
        enabled: Boolean(anthropicKey),
      };
    case SURFACES.COGNITIVE_CORE_PLANNER:
      return {
        ...base,
        primary: { module: 'lib/heidi/Planner.ts', provider: 'selectModel()', endpoint: ollama },
        fallback: null,
      };
    case SURFACES.API_CHAT_PAO:
      return {
        ...base,
        primary: { module: 'pao-system/core/heidi.controller.ts', provider: 'pao-routing', endpoint: null },
        fallback: { module: 'api/chat/route.js system handlers', provider: 'mixed', endpoint: null },
      };
    default:
      return { ...base, error: 'unknown_surface' };
  }
}

function listInferenceSurfaces(env = process.env) {
  return Object.values(SURFACES).map((surface) => resolveInferenceRoute(surface, env));
}

/** Surfaces that can answer chat without going through heidi-core memory. */
function detectRouteConflicts(env = process.env) {
  const routes = listInferenceSurfaces(env);
  const nonCore = routes.filter(
    (r) =>
      r.surface === SURFACES.ANTHROPIC_AGENT ||
      r.surface === SURFACES.API_CHAT_PAO ||
      (r.surface === SURFACES.DASHBOARD_API_CHAT && r.fallback && r.fallback.provider === 'anthropic'),
  );
  const conflicts = [];
  if (nonCore.length && env.ENABLE_LOCAL_MODEL !== '0') {
    conflicts.push({
      kind: 'parallel_chat_brains',
      detail: 'Dashboard/PAO/Anthropic paths can bypass heidi-core memory unless callers prefer heidi-core-chat first',
      surfaces: nonCore.map((r) => r.surface),
    });
  }
  if (!isPaidLlmAllowed(env) && paidApiKey('ANTHROPIC_API_KEY', env)) {
    conflicts.push({
      kind: 'latent_paid_key',
      detail: 'Anthropic key present but HYDI_ALLOW_PAID_LLM is off — gate is working',
      severity: 'info',
    });
  }
  return conflicts;
}

module.exports = {
  SURFACES,
  resolveInferenceRoute,
  listInferenceSurfaces,
  detectRouteConflicts,
};