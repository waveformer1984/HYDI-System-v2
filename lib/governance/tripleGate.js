'use strict';

/**
 * Triple gate — the single authoritative verdict function for Heidi-agent
 * task execution (Phase 4).
 *
 * Pure and total: every input combination returns a verdict; any internal
 * error is converted to REVIEW (never AUTO-APPROVE, never an exception
 * escaping to a caller that might execute anyway).
 *
 * Gate order (first failure wins, reason names the gate):
 *   1. exec flag    — HEIDI_ALLOW_EXEC must be truthy
 *   2. bounds row   — heidi_decision_bounds must be loaded
 *   3. action known — task type must exist in the action registry
 *   4. pause        — HEIDI_PAUSE / control.paused blocks execution
 *   5. sensitive    — financial/crypto/vendor divisions always REVIEW
 *   6. confidence   — >= threshold AND within_bounds -> AUTO-APPROVE
 *                     < 0.5 -> BLOCK; otherwise REVIEW
 */

const VERDICTS = Object.freeze({ AUTO_APPROVE: 'AUTO-APPROVE', REVIEW: 'REVIEW', BLOCK: 'BLOCK' });

const DEFAULT_SENSITIVE_DIVISIONS = Object.freeze(['financial', 'crypto', 'vendor']);
const DEFAULT_THRESHOLD = 0.85;
const BLOCK_CONFIDENCE_FLOOR = 0.5;

function isTruthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

/**
 * @param {object} input
 * @param {boolean|string} input.execEnabled   HEIDI_ALLOW_EXEC value
 * @param {object|null} input.bounds           heidi_decision_bounds row (or null)
 * @param {object} input.task                  { type, division, confidence, within_bounds }
 * @param {boolean} [input.paused]             kill-switch state (env or DB)
 * @param {string[]} [input.sensitiveDivisions]
 * @param {Set<string>|string[]} [input.knownActions] registered action types
 * @returns {{ verdict: string, reason: string, gate: string }}
 */
function evaluateTripleGate(input = {}) {
  const task = input.task || {};
  const bounds = input.bounds || null;
  const sensitive = input.sensitiveDivisions || DEFAULT_SENSITIVE_DIVISIONS;
  const knownActions = input.knownActions;

  // Gate 1 — execution must be explicitly enabled.
  if (!isTruthy(input.execEnabled)) {
    return { verdict: VERDICTS.REVIEW, gate: 'exec_flag', reason: 'HEIDI_ALLOW_EXEC not set' };
  }

  // Gate 2 — bounds must be loaded with a usable threshold; missing or
  // empty data denies (an empty row is not a configured policy).
  if (!bounds || typeof bounds !== 'object' || typeof bounds.auto_approve_threshold !== 'number') {
    return { verdict: VERDICTS.REVIEW, gate: 'bounds', reason: 'Decision bounds not loaded' };
  }

  // Gate 3 — only registered action types may ever execute.
  if (knownActions) {
    const ok = typeof knownActions.has === 'function' ? knownActions.has(task.type) : knownActions.includes(task.type);
    if (!ok) {
      return { verdict: VERDICTS.BLOCK, gate: 'action_registry', reason: `Unregistered action type: ${task.type || '(none)'}` };
    }
  }

  // Gate 4 — kill switch: paused means observe-only, never execute.
  if (input.paused) {
    return { verdict: VERDICTS.REVIEW, gate: 'pause', reason: 'Heidi is paused (HEIDI_PAUSE)' };
  }

  // Gate 5 — sensitive divisions always need a human.
  if (sensitive.includes(task.division)) {
    return { verdict: VERDICTS.REVIEW, gate: 'sensitive_division', reason: `Sensitive division (${task.division}) requires human approval` };
  }

  // Gate 6 — confidence + bounds.
  const confidence = typeof task.confidence === 'number' ? task.confidence : 0;
  const threshold = typeof bounds.auto_approve_threshold === 'number' ? bounds.auto_approve_threshold : DEFAULT_THRESHOLD;

  if (confidence >= threshold && task.within_bounds === true) {
    return {
      verdict: VERDICTS.AUTO_APPROVE,
      gate: 'confidence_bounds',
      reason: `confidence ${(confidence * 100).toFixed(0)}% >= ${(threshold * 100).toFixed(0)}% and within bounds`,
    };
  }
  if (confidence < BLOCK_CONFIDENCE_FLOOR) {
    return {
      verdict: VERDICTS.BLOCK,
      gate: 'confidence_floor',
      reason: `confidence ${(confidence * 100).toFixed(0)}% below ${(BLOCK_CONFIDENCE_FLOOR * 100).toFixed(0)}% floor`,
    };
  }
  return {
    verdict: VERDICTS.REVIEW,
    gate: 'confidence_threshold',
    reason: `confidence ${(confidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}% or outside bounds`,
  };
}

/**
 * Deny-on-error wrapper: any exception inside evaluation becomes REVIEW.
 * Callers must never see AUTO-APPROVE produced by a fault.
 */
function safeEvaluateTripleGate(input) {
  try {
    return evaluateTripleGate(input);
  } catch (e) {
    return { verdict: VERDICTS.REVIEW, gate: 'error', reason: `gate evaluation failed: ${e.message}` };
  }
}

module.exports = {
  evaluateTripleGate,
  safeEvaluateTripleGate,
  VERDICTS,
  DEFAULT_SENSITIVE_DIVISIONS,
  DEFAULT_THRESHOLD,
  BLOCK_CONFIDENCE_FLOOR,
};
