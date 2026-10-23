'use strict';

/**
 * paid-llm-gate.js — the single $0 switch for paid model endpoints.
 *
 * IDENTICAL COPY of lib/cost/paid-llm-gate.js — this app builds separately
 * and cannot import from the repo root. Keep the two files in sync.
 *
 * Contract for callers: use paidApiKey('ANTHROPIC_API_KEY') (etc.) anywhere
 * the code would otherwise read process.env.<PROVIDER>_API_KEY. When
 * HYDI_ALLOW_PAID_LLM !== 'true' the helper returns undefined and the
 * caller's existing "no key configured" fallback takes over unchanged.
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
