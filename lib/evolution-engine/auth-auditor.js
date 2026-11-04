'use strict';

const { hasPermission } = require('../auth/rbac');

/**
 * Read-only authorization posture for evolution ops.
 */
class AuthAuditor {
  audit() {
    const findings = [];
    const roles = ['viewer', 'operator', 'owner'];
    const checks = [
      { action: 'evolution.execute', perm: 'fabric:control' },
      { action: 'evolution.audit', perm: 'ops:diagnostics' },
    ];
    for (const c of checks) {
      const allowed = roles.filter((r) => hasPermission(r, c.perm));
      findings.push({
        severity: 'info',
        subsystem: 'authorization',
        code: 'rbac_matrix',
        message: `${c.action} permitted for roles: ${allowed.join(', ') || 'none'}`,
        evidence: { action: c.action, permission: c.perm, roles: allowed },
        remediation: 'Adjust lib/auth/rbac.js only via human-reviewed PR.',
      });
    }
    return { findings };
  }
}

module.exports = { AuthAuditor };
