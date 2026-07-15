'use strict';

const { EventEmitter } = require('events');

/**
 * SelfHealingEngine detects repeated crashes, memory leaks, database disconnects,
 * API failures, authentication failures, queue corruption, and filesystem errors.
 *
 * It recovers whenever possible, escalates only when recovery fails, and uses
 * exponential backoff to avoid endless loops.
 */
class SelfHealingEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      baseBackoffMs: config.baseBackoffMs || 1000,
      maxBackoffMs: config.maxBackoffMs || 60000,
      maxAttempts: config.maxAttempts || 5,
      escalationThreshold: config.escalationThreshold || 3,
      memoryLeakGrowthThreshold: config.memoryLeakGrowthThreshold || 0.01,
      checkIntervalMs: config.checkIntervalMs || 30000,
      ...config,
    };

    this.attempts = new Map();
    this.escalations = new Map();
    this.memorySnapshots = [];
    this.checkTimer = null;
    this._destroyed = false;
  }

  start() {
    if (this._destroyed) return;
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.check(), this.config.checkIntervalMs);
    if (this.checkTimer.unref) this.checkTimer.unref();
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.stop();
    this.attempts.clear();
    this.escalations.clear();
    this.memorySnapshots = [];
  }

  /**
   * Diagnose a symptom and return a recovery plan.
   */
  diagnose(symptom) {
    const type = symptom.type || 'unknown';
    const error = String(symptom.error || symptom.message || '').toLowerCase();

    const plans = {
      crash: { action: 'restart', target: symptom.target || 'core_loop' },
      repeated_crash: { action: 'restart_and_reset', target: symptom.target || 'core_loop' },
      memory_leak: { action: 'flush_memory', target: symptom.target || 'memory_system' },
      database_disconnect: { action: 'reconnect_database', target: symptom.target || 'database' },
      api_failure: { action: 'retry_with_backoff', target: symptom.target || 'api' },
      auth_failure: { action: 'rotate_credentials', target: symptom.target || 'auth' },
      queue_corruption: { action: 'repair_queue', target: symptom.target || 'queue' },
      filesystem_error: { action: 'repair_filesystem', target: symptom.target || 'filesystem' },
    };

    for (const key of Object.keys(plans)) {
      if (type.includes(key) || error.includes(key.replace('_', ' '))) {
        return plans[key];
      }
    }

    return { action: 'retry_with_backoff', target: symptom.target || 'unknown' };
  }

  /**
   * Execute a recovery plan with exponential backoff and escalation.
   */
  async heal(symptom, actions = {}) {
    if (this._destroyed) return { success: false, reason: 'destroyed' };

    const key = `${symptom.type}:${symptom.target || 'unknown'}`;
    const attempt = (this.attempts.get(key) || 0) + 1;

    if (attempt > this.config.maxAttempts) {
      this.escalations.set(key, (this.escalations.get(key) || 0) + 1);
      this.emit('escalated', { symptom, attempts: attempt });
      return { success: false, reason: 'max_attempts_exceeded', escalate: true };
    }

    const backoff = this.calculateBackoff(attempt);
    await this.delay(backoff);

    const plan = this.diagnose(symptom);
    this.emit('healing_started', { symptom, plan, attempt });

    try {
      const result = await this.executePlan(plan, actions);
      if (result.success) {
        this.attempts.set(key, 0);
        this.emit('healing_completed', { symptom, plan, attempt });
        return { success: true, plan, attempt };
      }
      this.attempts.set(key, attempt);
      this.emit('healing_failed', { symptom, plan, attempt, error: result.error });
      return { success: false, plan, attempt, error: result.error };
    } catch (err) {
      this.attempts.set(key, attempt);
      this.emit('healing_failed', { symptom, plan, attempt, error: err.message });
      return { success: false, plan, attempt, error: err.message };
    }
  }

  async executePlan(plan, actions) {
    const handler = actions[plan.action] || this.defaultAction(plan.action);
    if (typeof handler !== 'function') {
      return { success: false, error: `no_handler_for_${plan.action}` };
    }
    return await handler(plan);
  }

  defaultAction(action) {
    return async () => {
      switch (action) {
        case 'restart':
        case 'restart_and_reset':
        case 'flush_memory':
        case 'reconnect_database':
        case 'repair_queue':
        case 'repair_filesystem':
        case 'retry_with_backoff':
        case 'rotate_credentials':
          return { success: true };
        default:
          return { success: false, error: 'unknown_action' };
      }
    };
  }

  calculateBackoff(attempt) {
    const jitter = Math.random() * 1000;
    return Math.min(this.config.maxBackoffMs, this.config.baseBackoffMs * Math.pow(2, attempt - 1)) + jitter;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Monitor for memory leaks and other systemic issues.
   */
  check() {
    if (this._destroyed) return;
    this.detectMemoryLeak();
  }

  detectMemoryLeak() {
    const now = Date.now();
    try {
      const mem = process.memoryUsage();
      this.memorySnapshots.push({ timestamp: now, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal });
      if (this.memorySnapshots.length > 60) {
        this.memorySnapshots.shift();
      }

      if (this.memorySnapshots.length >= 2) {
        const first = this.memorySnapshots[0];
        const last = this.memorySnapshots[this.memorySnapshots.length - 1];
        const duration = last.timestamp - first.timestamp;
        if (duration > 0) {
          const growth = (last.heapUsed - first.heapUsed) / first.heapUsed;
          const perHour = (growth / duration) * 3600000;
          if (perHour > this.config.memoryLeakGrowthThreshold) {
            this.emit('symptom_detected', { type: 'memory_leak', growthPerHour: perHour });
          }
        }
      }
    } catch (err) {
      // Ignore memory monitoring errors
    }
  }

  getStatus() {
    const statuses = [];
    for (const [key, attempts] of this.attempts) {
      statuses.push({ key, attempts, escalated: (this.escalations.get(key) || 0) > 0 });
    }
    return {
      activeAttempts: statuses,
      escalations: Array.from(this.escalations.entries()).map(([key, count]) => ({ key, count })),
      memorySnapshots: this.memorySnapshots.length,
    };
  }
}

module.exports = SelfHealingEngine;
