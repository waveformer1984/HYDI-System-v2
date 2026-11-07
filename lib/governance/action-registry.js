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

module.exports = { ACTION_REGISTRY, isRegisteredAction, getAction, registeredActionTypes };
