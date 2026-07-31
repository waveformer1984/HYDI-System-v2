'use strict';

class PluginRuntime {
  constructor(config = {}) {
    this.logger = config.logger || console;
    this.plugins = new Map();
    this.domains = ['filesystem', 'network', 'execution', 'memory', 'externalApis', 'hardware'];
  }

  register(plugin) {
    if (!plugin || !plugin.name || !plugin.version) {
      throw new Error('Plugin must declare name and version');
    }
    const entry = {
      name: plugin.name,
      version: plugin.version,
      capabilities: plugin.capabilities || [],
      permissions: Object.assign({}, this._defaultPermissions(), plugin.permissions || {}),
      resourceLimits: plugin.resourceLimits || {},
      healthy: true,
    };
    this.plugins.set(entry.name, entry);
    return entry;
  }

  _defaultPermissions() {
    return {
      filesystem: false,
      network: false,
      execution: false,
      memory: false,
      externalApis: false,
      hardware: false,
    };
  }

  get(name) {
    return this.plugins.get(name) || null;
  }

  list() {
    return Array.from(this.plugins.values());
  }

  hasPermission(name, domain, action = null) {
    const p = this.plugins.get(name);
    if (!p) return false;
    const perm = p.permissions[domain];
    if (perm === true) return true;
    if (perm === false || perm === undefined) return false;
    if (Array.isArray(perm) && action) return perm.includes(action);
    return false;
  }

  execute(name, domain, action, args = {}) {
    if (!this.hasPermission(name, domain, action)) {
      return { success: false, error: `permission_denied:${domain}:${action || 'any'}`, plugin: name };
    }
    const handler = args && typeof args.handler === 'function' ? args.handler : null;
    if (handler) return handler({ name, domain, action, args });
    return { success: true, plugin: name, domain, action };
  }

  revoke(name, domain) {
    const p = this.plugins.get(name);
    if (!p) return false;
    p.permissions[domain] = false;
    return true;
  }

  securityReport() {
    return this.list().map((p) => ({ name: p.name, permissions: p.permissions, capabilities: p.capabilities }));
  }
}

module.exports = PluginRuntime;
