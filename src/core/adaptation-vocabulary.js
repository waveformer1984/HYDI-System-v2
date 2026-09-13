'use strict';
/**
 * HEIDI Canonical Adaptation Vocabulary
 *
 * One authoritative schema for all adaptation recommendations.
 * Every producer and consumer of adaptation recommendations must use
 * these types and actions. No ad-hoc type strings.
 *
 * Producers:
 *   - src/memory/HeidiMemorySystem.js  (generateRecommendations)
 *   - src/awareness/HeidiSelfAwareness.js (generateRecommendations, generateDriftRecommendations)
 *
 * Consumers:
 *   - src/core/HeidiCoreLoop.js (applyAdaptation)
 *   - src/HYDISystem.js (applyAdaptation)
 *   - modules/hydi-contextual-conscience.js
 *
 * Canonical adaptation types (the `type` field):
 *   - strategy_avoidance         — stop using a failing strategy
 *   - strategy_preference        — prefer a successful strategy
 *   - confidence_calibration     — adjust confidence threshold
 *   - drift_mitigation           — reduce drift score
 *   - failure_mitigation         — mitigate recurring failures
 *   - success_amplification      — amplify successful patterns
 *   - cost_optimization          — reduce costs / improve ROI
 *   - model_switch               — switch primary model
 *
 * Canonical actions (the `action` field):
 *   - reduce_confidence_threshold
 *   - increase_confidence_threshold
 *   - avoid_strategy
 *   - prefer_strategy
 *   - switch_primary_model
 *   - reduce_external_usage
 *   - improve_roi
 *   - reduce_drift
 */

const ADAPTATION_TYPES = Object.freeze({
  STRATEGY_AVOIDANCE: 'strategy_avoidance',
  STRATEGY_PREFERENCE: 'strategy_preference',
  CONFIDENCE_CALIBRATION: 'confidence_calibration',
  DRIFT_MITIGATION: 'drift_mitigation',
  FAILURE_MITIGATION: 'failure_mitigation',
  SUCCESS_AMPLIFICATION: 'success_amplification',
  COST_OPTIMIZATION: 'cost_optimization',
  MODEL_SWITCH: 'model_switch',
});

const ADAPTATION_ACTIONS = Object.freeze({
  REDUCE_CONFIDENCE_THRESHOLD: 'reduce_confidence_threshold',
  INCREASE_CONFIDENCE_THRESHOLD: 'increase_confidence_threshold',
  AVOID_STRATEGY: 'avoid_strategy',
  PREFER_STRATEGY: 'prefer_strategy',
  INCREASE_STRATEGY_PREFERENCE: 'increase_strategy_preference',
  SWITCH_PRIMARY_MODEL: 'switch_primary_model',
  REDUCE_EXTERNAL_USAGE: 'reduce_external_usage',
  IMPROVE_ROI: 'improve_roi',
  REDUCE_DRIFT: 'reduce_drift',
});

/**
 * Map of action → canonical type.
 * Used by producers that only set `action` to infer the canonical `type`.
 */
const ACTION_TO_TYPE = Object.freeze({
  [ADAPTATION_ACTIONS.REDUCE_CONFIDENCE_THRESHOLD]: ADAPTATION_TYPES.CONFIDENCE_CALIBRATION,
  [ADAPTATION_ACTIONS.INCREASE_CONFIDENCE_THRESHOLD]: ADAPTATION_TYPES.CONFIDENCE_CALIBRATION,
  [ADAPTATION_ACTIONS.AVOID_STRATEGY]: ADAPTATION_TYPES.STRATEGY_AVOIDANCE,
  [ADAPTATION_ACTIONS.PREFER_STRATEGY]: ADAPTATION_TYPES.STRATEGY_PREFERENCE,
  [ADAPTATION_ACTIONS.INCREASE_STRATEGY_PREFERENCE]: ADAPTATION_TYPES.STRATEGY_PREFERENCE,
  [ADAPTATION_ACTIONS.SWITCH_PRIMARY_MODEL]: ADAPTATION_TYPES.MODEL_SWITCH,
  [ADAPTATION_ACTIONS.REDUCE_EXTERNAL_USAGE]: ADAPTATION_TYPES.COST_OPTIMIZATION,
  [ADAPTATION_ACTIONS.IMPROVE_ROI]: ADAPTATION_TYPES.COST_OPTIMIZATION,
  [ADAPTATION_ACTIONS.REDUCE_DRIFT]: ADAPTATION_TYPES.DRIFT_MITIGATION,
});

/**
 * All valid type strings (for validation).
 */
const VALID_TYPES = new Set(Object.values(ADAPTATION_TYPES));

/**
 * All valid action strings (for validation).
 */
const VALID_ACTIONS = new Set(Object.values(ADAPTATION_ACTIONS));

/**
 * Normalize a recommendation to the canonical vocabulary.
 * Ensures `type` is set (inferred from `action` if missing).
 * Does NOT mutate the original — returns a new object.
 *
 * @param {object} rec — raw recommendation from a producer
 * @returns {object} normalized recommendation with canonical `type` and `action`
 */
function normalize(rec) {
  const type = rec.type || ACTION_TO_TYPE[rec.action] || null;
  const action = rec.action || null;
  return { ...rec, type, action };
}

/**
 * Check if a recommendation type is recognized.
 */
function isValidType(type) {
  return VALID_TYPES.has(type);
}

/**
 * Check if a recommendation action is recognized.
 */
function isValidAction(action) {
  return VALID_ACTIONS.has(action);
}

module.exports = {
  ADAPTATION_TYPES,
  ADAPTATION_ACTIONS,
  ACTION_TO_TYPE,
  VALID_TYPES,
  VALID_ACTIONS,
  normalize,
  isValidType,
  isValidAction,
};
