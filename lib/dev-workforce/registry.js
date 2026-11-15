'use strict';

const { DEFAULT_ROLE_PERMISSIONS } = require('./types');

class DevWorkforceRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.agents = new Map();
  }

  register({ agent_id, role, capabilities = [], permissions = null, metadata = {} }) {
    if (!agent_id || !role) return { ok: false, error: 'invalid_registration' };
    const perms = permissions || DEFAULT_ROLE_PERMISSIONS[role] || [];
    const row = {
      agent_id,
      role,
      capabilities,
      permissions: perms,
      metadata,
      registered_at: new Date().toISOString(),
      healthy: true,
    };
    this.agents.set(agent_id, row);
    return { ok: true, agent: row };
  }

  get(agent_id) {
    return this.agents.get(agent_id) || null;
  }

  list() {
    return [...this.agents.values()];
  }

  hasPermission(agent_id, permission) {
    const a = this.agents.get(agent_id);
    if (!a) return false;
    return a.permissions.includes(permission);
  }
}

module.exports = { DevWorkforceRegistry };