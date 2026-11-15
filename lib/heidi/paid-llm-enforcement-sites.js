'use strict';

/**
 * Audit documentation: where paid spend is actually blocked (not registry metadata).
 * Registry fields in inference-route.js describe policy only; these files call paidApiKey().
 */

const ENFORCEMENT_SITES = Object.freeze([
  { module: 'lib/cost/paid-llm-gate.js', role: 'chokepoint' },
  { module: 'lib/ModelManager.ts', role: 'chat routing' },
  { module: 'lib/heidi-agent.ts', role: 'anthropic agent (via getAnthropicClient)' },
  { module: 'lib/embeddings.ts', role: 'openai embeddings' },
  { module: 'api/local-model.js', role: 'local-model API' },
  { module: 'pao-system/services/llm.service.ts', role: 'PAO LLM' },
  { module: 'src/models/HybridModelStack.js', role: 'HYDI V3 stack' },
]);

function paidGateEnforcementSummary(env = process.env) {
  const { isPaidLlmAllowed } = require('../cost/paid-llm-gate');
  return {
    switch: 'HYDI_ALLOW_PAID_LLM',
    switch_on: isPaidLlmAllowed(env),
    registry_metadata_alone: 'does_not_block_paid_calls',
    enforcement: 'call_sites_must_use_paidApiKey()',
    known_sites: ENFORCEMENT_SITES,
    verify_with: 'npm run cost:audit',
  };
}

module.exports = { ENFORCEMENT_SITES, paidGateEnforcementSummary };