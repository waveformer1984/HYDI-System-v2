'use strict';

const { paidApiKey, isPaidLlmAllowed } = require('../cost/paid-llm-gate');

/**
 * Read-only security posture checks (no secret values).
 */
class SecurityAuditor {
  audit() {
    const findings = [];
    const paidOn = isPaidLlmAllowed();
    if (paidOn) {
      findings.push({
        severity: 'moderate',
        subsystem: 'cost-gate',
        code: 'paid_llm_enabled',
        message: 'HYDI_ALLOW_PAID_LLM is true — cloud model spend is permitted.',
        remediation: 'Set HYDI_ALLOW_PAID_LLM=false unless intentionally spending.',
      });
    }
    const anthropic = paidApiKey('ANTHROPIC_API_KEY');
    const openai = paidApiKey('OPENAI_API_KEY');
    findings.push({
      severity: 'info',
      subsystem: 'cost-gate',
      code: 'paid_key_presence',
      message: 'Paid provider key presence (gated, not revealed)',
      evidence: {
        anthropic_configured: Boolean(anthropic),
        openai_configured: Boolean(openai),
        paid_llm_switch: paidOn,
      },
      remediation: 'Keys present do not imply consent; gate must stay off for $0 ops.',
    });
    return { findings, paid_llm_allowed: paidOn };
  }
}

module.exports = { SecurityAuditor };
