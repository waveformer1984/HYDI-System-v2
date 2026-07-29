'use strict';

const { EventEmitter } = require('events');

/**
 * RecoveryCoordinator orchestrates self-healing responses to correlated
 * faults. It selects recovery strategies, tracks outcomes, and escalates
 * when recovery fails.
 */
class RecoveryCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.strategies = new Map();
    this.history = [];
    this.maxRetries = config.maxRetries || 3;
    this.escalationThreshold = config.escalationThreshold || 0.5;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.policy = config.policy || null;
  }

  registerStrategy(name, handler, options = {}) {
    this.strategies.set(name, {
      handler,
      applicable: options.applicable || (() => true),
      priority: options.priority || 0,
      requiresApproval: options.requiresApproval || false,
    });
    this.emit('strategy_registered', { name });
    return this;
  }

  selectStrategy(correlation) {
    const list = Array.from(this.strategies.entries())
      .map(([name, s]) => ({ name, ...s }))
      .filter((s) => s.applicable(correlation))
      .sort((a, b) => b.priority - a.priority);
    if (list.length === 0) return null;
    return list[0];
  }

  async recover(correlation, options = {}) {
    if (this.policy) {
      const decision = this.policy.validateAction('recover', { correlation });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }

    const strategy = this.selectStrategy(correlation);
    if (!strategy) return { success: false, error: 'no_strategy' };

    if (strategy.requiresApproval && !options.approved) {
      this.emit('approval_required', { correlation, strategy: strategy.name });
      return { success: false, error: 'approval_required', strategy: strategy.name };
    }

    const attempt = {
      id: `r-${Date.now()}-${this.history.length}`,
      correlationId: correlation.id,
      strategy: strategy.name,
      at: Date.now(),
      attempts: 0,
      success: false,
    };

    for (let i = 0; i < this.maxRetries; i++) {
      attempt.attempts = i + 1;
      try {
        const result = await strategy.handler(correlation, options);
        attempt.success = result && result.success !== false;
        attempt.result = result;
        if (attempt.success) break;
      } catch (err) {
        attempt.error = err instanceof Error ? err.message : String(err);
      }
      await this._sleep(Math.pow(2, i) * 100);
    }

    this.history.push(attempt);
    this._audit('recovery_attempted', attempt);
    this.emit('recovery_attempted', attempt);

    if (!attempt.success) {
      this.emit('recovery_failed', attempt);
      if (correlation.confidence >= this.escalationThreshold) {
        this.emit('escalation_required', { correlation, attempt });
      }
    } else {
      this.emit('recovered', attempt);
    }

    return { success: attempt.success, attempt };
  }

  getHistory(correlationId) {
    if (correlationId) return this.history.filter((h) => h.correlationId === correlationId);
    return this.history;
  }

  successRate() {
    const total = this.history.length;
    if (total === 0) return null;
    const successes = this.history.filter((h) => h.success).length;
    return parseFloat((successes / total).toFixed(2));
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  _audit(action, record) {
    const entry = { at: Date.now(), action, recoveryId: record.id, strategy: record.strategy };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = RecoveryCoordinator;
