'use strict';

class FailureTaxonomy {
  constructor(config = {}) {
    this.overrides = config.overrides || {};
    this.defaults = {
      model_unavailable: { tier: 'recoverable', action: 'fallback_model', maxAttempts: 3 },
      snapshot_corruption: { tier: 'recoverable', action: 'restore_snapshot', maxAttempts: 2 },
      memory_index_corruption: { tier: 'recoverable', action: 'rebuild_memory', maxAttempts: 2 },
      queue_inconsistency: { tier: 'recoverable', action: 'repair_queue', maxAttempts: 3 },
      policy_version_mismatch: { tier: 'operator', action: 'halt_subsystem', maxAttempts: 0 },
      config_migration_failure: { tier: 'operator', action: 'halt_boot', maxAttempts: 0 },
      repeated_recovery_failure: { tier: 'operator', action: 'disable_subsystem', maxAttempts: 0 },
      persistent_storage_unavailable: { tier: 'fatal', action: 'shutdown_safe', maxAttempts: 0 },
    };
  }

  classify(symptom) {
    const type = (symptom && symptom.type) || 'unknown';
    const override = this.overrides[type];
    const base = override || this.defaults[type] || { tier: 'recoverable', action: 'retry_with_backoff', maxAttempts: 3 };
    return {
      type,
      tier: base.tier,
      action: base.action,
      maxAttempts: base.maxAttempts,
      auto: base.tier === 'recoverable',
      operator: base.tier === 'operator',
      fatal: base.tier === 'fatal',
    };
  }

  isAutoRecoverable(symptom) { return this.classify(symptom).auto; }
  isOperatorRequired(symptom) { return this.classify(symptom).operator; }
  isFatal(symptom) { return this.classify(symptom).fatal; }
}

module.exports = FailureTaxonomy;
