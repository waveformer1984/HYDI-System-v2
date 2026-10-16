'use strict';

const { hasPermission } = require('../auth/rbac');
const { ACTIONS, isKnownAction } = require('./action-catalog');
const { runAction } = require('./action-runners');

function listActionsForRole(role) {
  return Object.entries(ACTIONS)
    .filter(([, meta]) => hasPermission(role, meta.permission))
    .map(([id, meta]) => ({
      id,
      permission: meta.permission,
      confirm_required: meta.confirmRequired,
      summary: meta.summary,
    }));
}

/**
 * @param {object} opts
 * @param {string} opts.action
 * @param {object} [opts.args]
 * @param {boolean} [opts.confirm]
 * @param {string} opts.role
 * @param {object} [opts.ctx]  runners / status loader (tests)
 */
async function executeTypedAction({ action, args = {}, confirm = false, role, ctx = {} }) {
  if (!isKnownAction(action)) {
    return { ok: false, error: 'invalid_action', message: 'Unknown action id.' };
  }
  const meta = ACTIONS[action];
  if (!hasPermission(role, meta.permission)) {
    return { ok: false, error: 'forbidden', message: `Role cannot run ${action}.` };
  }
  if (meta.confirmRequired && confirm !== true) {
    return { ok: false, error: 'confirmation_required', message: 'Set confirm: true after reviewing the action.' };
  }
  // Downstream runners re-check permissions against this role; never let
  // them fall back to a default.
  const outcome = await runAction(action, args, { ...ctx, role });
  return { ok: outcome.ok !== false, ...outcome };
}

module.exports = { executeTypedAction, listActionsForRole, ACTIONS };
