'use strict';

const CLASSIFICATIONS = Object.freeze({
  AUTONOMOUS: 'AUTONOMOUS',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
});

class ExecutionPolicy {
  constructor(config = {}) {
    this.rules = config.rules || this._defaultRules();
    this.logger = config.logger || console;
  }

  _defaultRules() {
    return {
      forbidden: [
        'credential_extraction', 'security_bypass', 'unauthorized_external_access',
        'destructive_command', 'rm_rf', 'drop_database', 'delete_all',
      ],
      approval: [
        'modify_file', 'send_email', 'send_message', 'send_communication',
        'financial_operation', 'purchase', 'payment', 'external_action',
        'create_action', 'execute_command', 'deploy', 'commit', 'push',
      ],
      autonomous: [
        'read_memory', 'read', 'summarize', 'analyze', 'search', 'query',
        'recommend', 'classify', 'organize', 'list', 'status',
      ],
    };
  }

  classify(actionType) {
    const t = (actionType || '').toLowerCase();
    if (this.rules.forbidden.some((r) => t.includes(r))) return CLASSIFICATIONS.FORBIDDEN;
    if (this.rules.approval.some((r) => t.includes(r))) return CLASSIFICATIONS.APPROVAL_REQUIRED;
    if (this.rules.autonomous.some((r) => t.includes(r))) return CLASSIFICATIONS.AUTONOMOUS;
    return CLASSIFICATIONS.APPROVAL_REQUIRED; // default to safe
  }

  authorize(action) {
    const type = action && action.type ? String(action.type).toLowerCase() : '';
    const classification = this.classify(type);
    const target = (action && action.target) || 'unknown';

    if (classification === CLASSIFICATIONS.FORBIDDEN) {
      return { allowed: false, classification, reason: `Action type '${type}' is forbidden.` };
    }

    // Additional guardrails
    if (this._isDestructiveTarget(target)) {
      return { allowed: false, classification: CLASSIFICATIONS.FORBIDDEN, reason: 'Target is destructive or sensitive.' };
    }

    const needsApproval = classification === CLASSIFICATIONS.APPROVAL_REQUIRED;
    return {
      allowed: !needsApproval,
      classification,
      reason: needsApproval
        ? `Action type '${type}' requires human approval before execution.`
        : `Action type '${type}' is allowed autonomously.`,
    };
  }

  _isDestructiveTarget(target) {
    const t = String(target || '').toLowerCase();
    return ['.env', 'secrets', 'password', 'key', 'token', 'credentials'].some((s) => t.includes(s));
  }
}

ExecutionPolicy.CLASSIFICATIONS = CLASSIFICATIONS;
module.exports = ExecutionPolicy;
