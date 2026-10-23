'use strict';

/**
 * paid-llm-gate.js — the single $0 switch for paid model endpoints.
 *
 * HYDI's operating constraint is $0. Most cloud model call sites in this
 * repo treat "the provider key is set" as consent to spend. This module is
 * the chokepoint that decouples those two facts: a paid provider may only be
 * contacted when HYDI_ALLOW_PAID_LLM === 'true' is set *in addition to* the
 * provider key.
 *
 * Contract for callers: use paidApiKey('ANTHROPIC_API_KEY') (etc.) anywhere
 * the code would otherwise read process.env.<PROVIDER>_API_KEY. When the
 * switch is off the helper returns undefined, and the caller's existing
 * "no key configured" fallback (local model, canned response, null) takes
 * over unchanged.
 *
 * CommonJS on purpose: root code mixes .js and .ts, and this must be
 * importable from both. The ursula-frontend app builds separately, so it
 * keeps an identical copy at apps/ursula-frontend/src/lib/paid-llm-gate.js —
 * keep them in sync.
 */

const SWITCH_NAME = 'HYDI_ALLOW_PAID_LLM';

/**
 * True only when the operator has explicitly allowed paid model calls.
 * Every value other than the literal string 'true' (case-insensitive,
 * whitespace-trimmed) means "not allowed" — including unset, '1', 'yes'.
 */
function isPaidLlmAllowed(env = process.env) {
  return String(env[SWITCH_NAME] || '').trim().toLowerCase() === 'true';
}

/**
 * Returns the named API key when paid calls are allowed, otherwise undefined.
 * envVarName is a plain env var name, e.g. 'ANTHROPIC_API_KEY'.
 */
function paidApiKey(envVarName, env = process.env) {
  if (!isPaidLlmAllowed(env)) return undefined;
  const value = env[envVarName];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

module.exports = { SWITCH_NAME, isPaidLlmAllowed, paidApiKey };
