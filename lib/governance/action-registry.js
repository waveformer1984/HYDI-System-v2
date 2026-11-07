'use strict';

/**
 * Action registry (Phase 4): Heidi may only execute action types that are
 * registered here with a schema hint, a risk level, and the bounds key the
 * triple gate must check. Unknown types are BLOCKED before execution.
 *
 * risk: 'low' | 'medium' | 'high' — informational today; high-risk types
 * should additionally be listed in sensitiveDivisions handling.
 */

const ACTION_REGISTRY = Object.freeze({
  financial_approval: Object.freeze({
    type: 'financial_approval',
    risk: 'high',
    boundsKey: 'max_auto_approve_amount',
    description: 'Approve a financial transaction within decision bounds',
  }),
  operational_decision: Object.freeze({
    type: 'operational_decision',
    risk: 'medium',
    boundsKey: 'auto_approve_threshold',
    description: 'Operational decision delegated to the agent',
  }),
});

function isRegisteredAction(type) {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, type);
}

function getAction(type) {
  return ACTION_REGISTRY[type] || null;
}

function registeredActionTypes() {
  return new Set(Object.keys(ACTION_REGISTRY));
}

/**
 * Server-side bounds check. A task's own `within_bounds` claim can only
 * narrow what this allows, never widen it — whoever writes to agent_bus
 * must not be able to declare their own task safe.
 *
 * - Unregistered type → false.
 * - boundsKey 'auto_approve_threshold' carries no per-task limit (the
 *   confidence gate enforces it) → true.
 * - Any other boundsKey is a numeric ceiling on `payload.amount`: both the
 *   limit and the amount must be finite numbers, amount ≥ 0 and ≤ limit.
 *   Anything missing or malformed → false (deny on missing data).
 *
 * @returns {{ within: boolean, reason: string }}
 */
function checkActionBounds(type, payload, bounds) {
  const action = getAction(type);
  if (!action) return { within: false, reason: `unregistered action ${type || '(none)'}` };
  if (action.boundsKey === 'auto_approve_threshold') {
    return { within: true, reason: 'no per-task limit for this action type' };
  }
  const limit = bounds && typeof bounds === 'object' ? bounds[action.boundsKey] : undefined;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return { within: false, reason: `bounds.${action.boundsKey} not configured` };
  }
  const amount = payload && typeof payload === 'object' ? payload.amount : undefined;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return { within: false, reason: 'payload.amount missing or invalid' };
  }
  if (amount > limit) {
    return { within: false, reason: `amount ${amount} exceeds ${action.boundsKey} ${limit}` };
  }
  return { within: true, reason: `amount ${amount} <= ${action.boundsKey} ${limit}` };
}

module.exports = { ACTION_REGISTRY, isRegisteredAction, getAction, registeredActionTypes, checkActionBounds };
