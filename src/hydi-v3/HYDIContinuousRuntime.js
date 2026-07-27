'use strict';

const { EventEmitter } = require('events');
const { boot } = require('./HYDIOperationalBoot');

const STATES = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  RECOVERING: 'RECOVERING',
  STOPPED: 'STOPPED',
});

class HYDIContinuousRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath,
      ownerPriority: config.ownerPriority || 'default',
      healthIntervalMs: config.healthIntervalMs ?? 10000,
      logger: config.logger || { log: () => {}, warn: () => {}, error: () => {} },
    };
    this.state = STATES.STOPPED;
    this.bootReport = null;
    this.session = null;
    this.startTime = null;
    this.eventsProcessed = 0;
    this.learningUpdates = 0;
    this.lastVerifiedAction = null;
    this._healthTimer = null;
    this._shutdownBound = this.shutdown.bind(this);
    this._onBusEvent = this._onBusEvent.bind(this);
    this._processing = false;
  }

  async start() {
    this.state = STATES.STARTING;
    this.emit('state-change', this.state);
    this.startTime = Date.now();
    this.eventsProcessed = 0;
    this.learningUpdates = 0;
    this.lastVerifiedAction = null;

    try {
      this.bootReport = await boot({ ...this.config, logger: this.config.logger });
    } catch (error) {
      this.state = STATES.STOPPED;
      this.emit('state-change', this.state);
      throw error;
    }

    this.session = this.bootReport.session || null;

    if (!this.session) {
      this.state = STATES.STOPPED;
      this.emit('state-change', this.state);
      return this.bootReport;
    }

    if (this.session.eventBus) {
      this.session.eventBus.subscribeAll(this._onBusEvent);
    }

    this.state = this.bootReport.status === 'ready' ? STATES.READY : STATES.DEGRADED;
    this.emit('state-change', this.state);

    this._healthTimer = setInterval(() => this._healthLoop(), this.config.healthIntervalMs);
    if (this._healthTimer.unref) this._healthTimer.unref();

    process.on('SIGINT', this._shutdownBound);
    process.on('SIGTERM', this._shutdownBound);

    return this.bootReport;
  }

  async stop() {
    process.off('SIGINT', this._shutdownBound);
    process.off('SIGTERM', this._shutdownBound);

    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }

    if (this.session && this.session.eventBus) {
      this.session.eventBus.unsubscribe('*', this._onBusEvent);
    }

    if (this.session) {
      await this.session.shutdown();
    }

    this.state = STATES.STOPPED;
    this.emit('state-change', this.state);
    return { ok: true, state: this.state };
  }

  async shutdown() {
    if (this.state === STATES.STOPPED) return { ok: true, state: this.state, alreadyStopped: true };
    return this.stop();
  }

  processEvent(type, payload = {}, source = 'operator') {
    if (!this.session) throw new Error('Runtime not started');
    if (this.state === STATES.STOPPED) throw new Error('Runtime stopped');

    try {
      this._processing = true;
      const event = this.session.eventBus.emit(type, payload, source);
      this._processing = false;
      this.eventsProcessed += 1;
      return event;
    } catch (error) {
      this._processing = false;
      if (this.session && this.session.auditLedger) {
        this.session.auditLedger.record({
          category: 'malformed-event-ignored',
          actor: source || 'unknown',
          subjectId: type || 'unknown-event',
          payload: {
            error: error instanceof Error ? error.message : String(error),
            type,
            payload,
          },
        });
      }
      this.state = STATES.DEGRADED;
      this.emit('state-change', this.state);
      this.emit('event-error', { type, error });
      return null;
    }
  }

  getStatus() {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;
    const s = this.session;

    const recommendations = s && s.recommendationTracker
      ? s.recommendationTracker.getRecentRecommendations(100).length
      : 0;
    const pendingApprovals = s && s.executionGateway
      ? s.executionGateway.getPendingApprovals().length
      : 0;
    const awaitingMeasurements = s && s.evidenceEngine
      ? s.evidenceEngine.getAwaitingEvidence().length
      : 0;
    const auditEntries = s && s.auditLedger ? s.auditLedger.records.length : 0;

    let learningUpdates = this.learningUpdates;
    if (s && s.learningMetrics) {
      const metrics = s.learningMetrics.computeMetrics({});
      learningUpdates = Math.max(learningUpdates, metrics.completed || 0);
    }

    let lastVerifiedAction = this.lastVerifiedAction;
    if (!lastVerifiedAction && s && s.executionGateway) {
      const completed = s.executionGateway.getExecutionHistory({ status: 'completed' });
      if (completed.length) lastVerifiedAction = completed[0].type || completed[0].id;
    }

    return {
      state: this.state,
      runtime: this.state,
      uptime,
      eventsProcessed: this.eventsProcessed,
      recommendations,
      pendingApprovals,
      awaitingMeasurements,
      auditEntries,
      learningUpdates,
      lastVerifiedAction,
    };
  }

  _onBusEvent() {
    if (this._processing) return;
    this.eventsProcessed += 1;
  }

  _healthLoop() {
    if (!this.session || this.state === STATES.STOPPED) return;
    if (this.state === STATES.RECOVERING) return;

    const previous = this.state;
    const health = this._evaluateHealth();

    if (!health.ok && this.state === STATES.READY) {
      this.state = STATES.DEGRADED;
      this.emit('state-change', this.state);
    } else if (health.ok && this.state === STATES.DEGRADED) {
      this.state = STATES.RECOVERING;
      this.emit('state-change', this.state);
      this._attemptRecovery();
    }

    if (health.lastVerifiedAction && health.lastVerifiedAction !== this.lastVerifiedAction) {
      this.lastVerifiedAction = health.lastVerifiedAction;
    }
    if (typeof health.learningUpdates === 'number' && health.learningUpdates > this.learningUpdates) {
      this.learningUpdates = health.learningUpdates;
    }

    if (previous !== this.state && this.state !== STATES.RECOVERING) {
      this.emit('state-change', this.state);
    }
  }

  _evaluateHealth() {
    const s = this.session;
    const result = { ok: true, lastVerifiedAction: null, learningUpdates: 0 };
    if (!s) return { ok: false };

    try {
      const health = s.healthCheck();
      result.ok = health.ok;
    } catch (e) {
      result.ok = false;
    }

    if (s.auditLedger) {
      const verify = s.auditLedger.verify();
      if (!verify.ok) result.ok = false;
    }

    if (s.executionGateway) {
      const completed = s.executionGateway.getExecutionHistory({ status: 'completed' });
      if (completed.length) {
        result.lastVerifiedAction = completed[0].type || completed[0].id;
      }
    }

    if (s.learningMetrics) {
      const metrics = s.learningMetrics.computeMetrics({});
      result.learningUpdates = metrics.completed || 0;
    }

    for (const sensor of (s.sensors || [])) {
      if (typeof sensor.healthCheck !== 'function') continue;
      try {
        const h = sensor.healthCheck();
        if (!h.ok) result.ok = false;
      } catch (e) {
        result.ok = false;
      }
    }

    return result;
  }

  async _attemptRecovery() {
    try {
      const report = this.session.certify ? this.session.certify() : null;
      this.state = report && report.status === 'healthy' ? STATES.READY : STATES.DEGRADED;
    } catch (e) {
      this.state = STATES.DEGRADED;
    }
    this.emit('state-change', this.state);
  }
}

HYDIContinuousRuntime.STATES = STATES;

module.exports = HYDIContinuousRuntime;
