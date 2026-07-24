'use strict';

/**
 * PermissionModel enforces least-privilege access between kernel modules.
 *
 * Default policy is "allow" unless a rule denies. Rules can be scoped to
 * module, action, and resource.
 */
class PermissionModel {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      defaultPolicy: options.defaultPolicy || 'allow',
      ...options,
    };
    this.rules = []; // { moduleId?, action?, resource?, effect: 'allow'|'deny' }
  }

  allow({ moduleId = '*', action = '*', resource = '*' }) {
    this.rules.push({ moduleId, action, resource, effect: 'allow' });
  }

  deny({ moduleId = '*', action = '*', resource = '*' }) {
    this.rules.push({ moduleId, action, resource, effect: 'deny' });
  }

  check(moduleId, action, resource) {
    const matching = this.rules.filter(
      (r) =>
        (r.moduleId === '*' || r.moduleId === moduleId) &&
        (r.action === '*' || r.action === action) &&
        (r.resource === '*' || r.resource === resource)
    );
    if (matching.length === 0) return this.config.defaultPolicy === 'allow';
    // Last matching rule wins
    return matching[matching.length - 1].effect === 'allow';
  }

  grantModule(moduleId, permissions = []) {
    for (const p of permissions) {
      this.allow({ moduleId, action: p.action || '*', resource: p.resource || '*' });
    }
  }
}

module.exports = PermissionModel;
