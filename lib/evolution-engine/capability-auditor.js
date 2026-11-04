'use strict';

const { listUnifiedCapabilities } = require('../execution-fabric/registry-unified');
const { buildFixList } = require('../observation/fix-list');

/**
 * Capability + operational fix-list audit (reuses fix-list templates).
 */
class CapabilityAuditor {
  auditCapabilities(role = 'owner') {
    const caps = listUnifiedCapabilities(role);
    const findings = [];
    if (!caps.length) {
      findings.push({
        severity: 'moderate',
        subsystem: 'execution-fabric',
        code: 'no_capabilities',
        message: 'Unified capability registry returned empty for role.',
        evidence: { role },
        remediation: 'Verify registry-unified.js and RBAC mappings.',
      });
    }
    return { capability_count: caps.length, findings };
  }

  auditFixList(inputs = {}) {
    const list = buildFixList(inputs);
    const findings = list.items.slice(0, 20).map((item) => ({
      severity: item.level === 'CRIT' ? 'high' : item.level === 'WARN' ? 'moderate' : 'info',
      subsystem: 'observation',
      code: item.kind,
      message: item.detail || item.subject,
      evidence: item.evidence,
      remediation: item.proposedFix?.command || item.proposedFix?.action || 'Review manually',
      item_id: item.id,
    }));
    return { fix_list: list, findings };
  }
}

module.exports = { CapabilityAuditor };
