'use strict';

const { EventEmitter } = require('events');
const FailureTaxonomy = require('./FailureTaxonomy');

class RecoveryManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.taxonomy = config.taxonomy || new FailureTaxonomy({ overrides: config.overrides });
    this.snapshotStore = config.snapshotStore || null;
    this.handlers = config.handlers || {};
    this.logger = config.logger || console;
    this.baseBackoffMs = config.baseBackoffMs || 250;
    this.maxBackoffMs = config.maxBackoffMs || 30000;
    this.attempts = new Map();
    this.events = [];
  }

  async recover(symptom, context = {}) {
    const classified = this.taxonomy.classify(symptom);
    const key = `${classified.type}:${symptom.target || 'unknown'}`;
    const attempt = (this.attempts.get(key) || 0) + 1;

    if (classified.fatal) {
      this._record(symptom, classified, attempt, false, 'fatal');
      this.emit('fatal', { symptom, classified });
      return { success: false, reason: 'fatal', classified };
    }

    if (classified.operator) {
      this._record(symptom, classified, attempt, false, 'operator_required');
      this.emit('operator_required', { symptom, classified });
      return { success: false, reason: 'operator_required', classified };
    }

    if (attempt > classified.maxAttempts) {
      this.attempts.set(key, 0);
      this._record(symptom, classified, attempt, false, 'max_attempts_exceeded');
      this.emit('escalated', { symptom, classified, attempts: attempt });
      return { success: false, reason: 'max_attempts_exceeded', classified, escalate: true };
    }

    const backoff = this._backoff(attempt);
    await this._delay(backoff);

    const handler = this.handlers[classified.action] || this._defaultHandler(classified.action);
    const startedAt = Date.now();
    let result;
    try {
      result = await handler({ symptom, classified, context, snapshotStore: this.snapshotStore, attempt });
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const durationMs = Date.now() - startedAt;
    if (result && result.success) {
      this.attempts.set(key, 0);
      this._record(symptom, classified, attempt, true, null, durationMs);
      this.emit('recovered', { symptom, classified, attempt, durationMs });
      return { success: true, classified, attempt, durationMs };
    }

    this.attempts.set(key, attempt);
    this._record(symptom, classified, attempt, false, (result && result.error) || 'handler_failed', durationMs);
    this.emit('recovery_failed', { symptom, classified, attempt, error: (result && result.error) || 'handler_failed' });
    return { success: false, classified, attempt, error: (result && result.error) || 'handler_failed' };
  }

  _defaultHandler(action) {
    return async () => {
      this.logger.log('[RecoveryManager] default handler for', action);
      return { success: true };
    };
  }

  _backoff(attempt) {
    const jitter = Math.random() * this.baseBackoffMs;
    return Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, attempt - 1)) + jitter;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _record(symptom, classified, attempt, success, error, durationMs = 0) {
    const entry = {
      at: Date.now(),
      type: 'recovery_event',
      symptom: classified.type,
      target: symptom.target || 'unknown',
      tier: classified.tier,
      action: classified.action,
      attempt,
      success,
      error,
      durationMs,
    };
    this.events.push(entry);
    if (this.events.length > 1000) this.events.shift();
    this.emit('record', entry);
  }

  getEvents(limit = 100) {
    return this.events.slice(-limit);
  }

  getStatus() {
    const map = {};
    for (const [key, count] of this.attempts) map[key] = count;
    return { activeAttempts: map, eventCount: this.events.length };
  }
}

module.exports = RecoveryManager;
