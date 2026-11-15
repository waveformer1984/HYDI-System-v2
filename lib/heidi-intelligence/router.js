'use strict';

const os = require('os');
const { paidApiKey } = require('../cost/paid-llm-gate');
const { getSkillProfile } = require('./skills');

const SWITCH = 'HEIDI_INTELLIGENCE_LAYER';

function layerEnabled(env = process.env) {
  return String(env[SWITCH] || '').trim().toLowerCase() === 'true';
}

function resourceSnapshot(env = process.env) {
  const minFreeGb = Number(env.HEIDI_INTELLIGENCE_MIN_FREE_RAM_GB || 1.5);
  const freeGb = os.freemem() / 1e9;
  const totalGb = os.totalmem() / 1e9;
  const load = os.loadavg()[0];
  const allowSecondModel = freeGb >= minFreeGb * 2;
  return {
    freeRamGb: Number(freeGb.toFixed(2)),
    totalRamGb: Number(totalGb.toFixed(2)),
    load1: Number(load.toFixed(2)),
    canLoadPrimaryLocal: freeGb >= minFreeGb,
    canLoadConcurrentModels: allowSecondModel,
    minFreeRamGb: minFreeGb,
  };
}

/**
 * Route inference without loading multiple large models when RAM is tight.
 */
function routeInference({ skillId, privacySensitive = false, complexity = 0.5, env = process.env }) {
  const profile = getSkillProfile(skillId);
  const resources = resourceSnapshot(env);
  const paidAllowed = Boolean(paidApiKey('ANTHROPIC_API_KEY', env) || paidApiKey('OPENAI_API_KEY', env));
  const localEnabled = env.ENABLE_LOCAL_MODEL !== 'false';
  const localModel = env.LOCAL_MODEL_NAME || env.HEIDI_TOOL_MODEL || 'llama3.2:3b';

  let provider = 'local';
  let model = localModel;
  let reasons = [];

  if (!resources.canLoadPrimaryLocal) {
    provider = paidAllowed ? 'cloud' : 'degraded';
    reasons.push('insufficient_free_ram_for_local');
  } else if (privacySensitive) {
    provider = 'local';
    reasons.push('privacy_sensitive');
  } else if (profile.routeBias === 'cloud_optional' && complexity > (profile.complexityThreshold || 0.6) && paidAllowed) {
    provider = 'cloud';
    model = paidApiKey('ANTHROPIC_API_KEY', env) ? 'claude' : 'openai';
    reasons.push('high_complexity_paid_allowed');
  } else if (!localEnabled) {
    provider = paidAllowed ? 'cloud' : 'degraded';
    reasons.push('local_disabled');
  } else {
    reasons.push(profile.routeBias || 'local_default');
  }

  if (provider === 'local' && !resources.canLoadConcurrentModels) {
    reasons.push('single_model_slot_enforced');
  }

  return {
    provider,
    model,
    paidLlmAllowed: paidAllowed,
    resources,
    reasons,
    estimatedCostUsd: provider === 'cloud' && paidAllowed ? null : 0,
  };
}

module.exports = { layerEnabled, resourceSnapshot, routeInference };