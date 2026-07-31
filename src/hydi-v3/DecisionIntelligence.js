'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * DecisionIntelligence records every autonomous decision, validates it before
 * execution, and maintains a searchable decision history.
 *
 * Every decision includes: ID, confidence score, reason, evidence, expected value,
 * risk score, rollback plan, and estimated time.
 */
class DecisionIntelligence {
  constructor(config = {}) {
    this.config = {
      storagePath: config.storagePath || path.resolve(__dirname, '../../data/decisions'),
      maxHistory: config.maxHistory || 10000,
      dangerScoreThreshold: config.dangerScoreThreshold || 0.9,
      lowConfidenceThreshold: config.lowConfidenceThreshold || 0.3,
      persistDebounceMs: config.persistDebounceMs ?? 50,
      ...config,
    };

    this.decisions = [];
    this._loaded = false;
    this._destroyed = false;
    this._persistTimer = null;
    this._persistPromise = null;
    this._persistResolve = null;
    this._persistInFlight = false;
  }

  async initialize() {
    if (this._destroyed) return;
    if (this._loaded) return;
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const file = path.join(this.config.storagePath, 'decision_history.json');
      try {
        const data = await fs.readFile(file, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) this.decisions = parsed;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          this.decisions = [];
        }
      }
    } catch (err) {
      console.error('[DECISION INTELLIGENCE] Initialization failed:', err.message);
    }
    this._loaded = true;
  }

  async destroy() {
    const hadPendingTimer = Boolean(this._persistTimer);
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._destroyed = true;
    if (this._persistInFlight && this._persistPromise) {
      await this._persistPromise;
    }
    if (hadPendingTimer) {
      await this._doPersist();
    }
    if (this._persistResolve) {
      this._persistResolve();
      this._persistResolve = null;
      this._persistPromise = null;
    }
    this._persistInFlight = false;
  }

  /**
   * Build a decision record and validate before execution.
   */
  async makeDecision(input, context = {}) {
    if (this._destroyed) return { valid: false, reason: 'destroyed' };
    await this.initialize();

    const decision = this.createDecisionRecord(input, context);
    const validation = await this.validateDecision(decision, context);

    if (!validation.valid) {
      decision.outcome = { status: 'rejected', reason: validation.reason };
      decision.timestamp = new Date().toISOString();
      this.appendDecision(decision);
      return { ...decision, valid: false, rejectionReason: validation.reason };
    }

    decision.valid = true;
    return decision;
  }

  createDecisionRecord(input, context = {}) {
    const decisionId = randomUUID();
    const now = new Date().toISOString();

    const riskScore = this.calculateRiskScore(input, context);
    const expectedValue = this.calculateExpectedValue(input, context);
    const confidence = this.normalize(input.confidence, 0, 1);

    return {
      id: decisionId,
      taskId: input.taskId || context.taskId || null,
      missionId: input.missionId || context.missionId || null,
      agentId: input.agentId || context.agentId || 'system',
      timestamp: now,
      confidence,
      reason: input.reason || 'no_reason_given',
      evidence: input.evidence || [],
      expectedValue,
      riskScore,
      rollbackPlan: input.rollbackPlan || this.defaultRollbackPlan(input),
      estimatedTimeMs: input.estimatedTimeMs || this.estimateTime(input),
      action: input.action || null,
      strategy: input.strategy || null,
      model: input.model || null,
      outcome: null,
      revenue: input.revenue || 0,
      cost: input.cost || 0,
    };
  }

  async validateDecision(decision, context = {}) {
    const reasons = [];

    // Verify required resources
    const resources = context.resources || {};
    if (resources.cpu !== undefined && resources.cpu > 0.95) {
      reasons.push('insufficient_cpu');
    }
    if (resources.memory !== undefined && resources.memory > 0.95) {
      reasons.push('insufficient_memory');
    }

    // Verify credentials
    const requiredCredentials = context.requiredCredentials || [];
    for (const cred of requiredCredentials) {
      if (!process.env[cred]) {
        reasons.push(`missing_credential:${cred}`);
      }
    }

    // Verify permissions
    const requiredPermissions = context.requiredPermissions || [];
    if (requiredPermissions.length && !context.hasPermissions) {
      reasons.push('missing_permissions');
    }

    // Estimate probability of success from historical outcomes
    const probability = this.estimateSuccessProbability(decision);
    if (probability < 0.3) {
      reasons.push('low_success_probability');
    }

    // Reject dangerous actions
    if (decision.riskScore >= this.config.dangerScoreThreshold) {
      reasons.push('dangerous_risk_score');
    }
    if (this.isDangerousAction(decision)) {
      reasons.push('dangerous_action');
    }

    if (decision.confidence < this.config.lowConfidenceThreshold) {
      reasons.push('low_confidence');
    }

    if (reasons.length) {
      return { valid: false, reasons, reason: reasons.join(', ') };
    }

    return { valid: true, probability, reason: 'ok' };
  }

  /**
   * Record the actual outcome of a decision.
   */
  recordOutcome(decisionId, outcome) {
    const decision = this.decisions.find((d) => d.id === decisionId);
    if (decision) {
      decision.outcome = outcome;
      decision.outcomeAt = new Date().toISOString();
      this.persist();
    }
    return decision || null;
  }

  /**
   * Convenience: record a decision from a core loop result.
   */
  recordDecision(task, decision, measurement = {}) {
    const record = this.createDecisionRecord(
      {
        taskId: task?.id || task?.taskId,
        missionId: task?.missionId,
        action: decision?.action,
        strategy: decision?.strategy,
        model: decision?.model,
        confidence: decision?.confidence || 0,
        reason: decision?.reason || 'core_loop_decision',
        evidence: [decision?.reasoning, decision?.fallback].filter(Boolean),
      },
      { task, measurement }
    );
    record.outcome = {
      status: measurement?.success ? 'success' : 'failure',
      latency: measurement?.latency || 0,
      revenue: measurement?.revenue || 0,
      impact: measurement?.impact || 0,
    };
    record.revenue = measurement?.revenue || measurement?.revenueGenerated || 0;
    record.cost = measurement?.cost || 0;
    this.appendDecision(record);
    return record;
  }

  appendDecision(decision) {
    this.decisions.push(decision);
    if (this.decisions.length > this.config.maxHistory) {
      this.decisions = this.decisions.slice(-this.config.maxHistory);
    }
    this.persist();
  }

  async persist() {
    if (this._destroyed) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    const previousResolve = this._persistResolve;
    this._persistPromise = new Promise((resolve) => {
      this._persistResolve = resolve;
    });
    if (previousResolve) previousResolve();
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistInFlight = true;
      this._doPersist().finally(() => {
        this._persistInFlight = false;
        if (this._persistResolve) {
          this._persistResolve();
          this._persistResolve = null;
          this._persistPromise = null;
        }
      });
    }, this.config.persistDebounceMs).unref();
    return this._persistPromise;
  }

  async flush() {
    if (this._destroyed) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._persistInFlight && this._persistPromise) {
      await this._persistPromise;
    }
    this._persistInFlight = true;
    this._persistPromise = new Promise((resolve) => {
      this._persistResolve = resolve;
    });
    try {
      await this._doPersist();
    } finally {
      this._persistInFlight = false;
      if (this._persistResolve) {
        this._persistResolve();
        this._persistResolve = null;
        this._persistPromise = null;
      }
    }
  }

  async _doPersist() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const file = path.join(this.config.storagePath, 'decision_history.json');
      await fs.writeFile(file, JSON.stringify(this.decisions, null, 2));
    } catch (err) {
      if (!this._destroyed) {
        console.error('[DECISION INTELLIGENCE] Persist failed:', err.message);
      }
    }
  }

  searchHistory(filters = {}) {
    let results = [...this.decisions];

    if (filters.missionId) {
      results = results.filter((d) => d.missionId === filters.missionId);
    }
    if (filters.agentId) {
      results = results.filter((d) => d.agentId === filters.agentId);
    }
    if (filters.outcome) {
      results = results.filter((d) => d.outcome?.status === filters.outcome);
    }
    if (filters.minRevenue !== undefined) {
      results = results.filter((d) => (d.revenue || 0) >= filters.minRevenue);
    }
    if (filters.minConfidence !== undefined) {
      results = results.filter((d) => d.confidence >= filters.minConfidence);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime();
      results = results.filter((d) => new Date(d.timestamp).getTime() >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate).getTime();
      results = results.filter((d) => new Date(d.timestamp).getTime() <= end);
    }

    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  getDecisionById(id) {
    return this.decisions.find((d) => d.id === id) || null;
  }

  getHistorySummary() {
    const total = this.decisions.length;
    const success = this.decisions.filter((d) => d.outcome?.status === 'success').length;
    const failure = this.decisions.filter((d) => d.outcome?.status === 'failure').length;
    const revenue = this.decisions.reduce((sum, d) => sum + (d.revenue || 0), 0);
    return { total, success, failure, revenue, avgConfidence: this.averageConfidence() };
  }

  averageConfidence() {
    if (!this.decisions.length) return 0;
    return this.decisions.reduce((sum, d) => sum + d.confidence, 0) / this.decisions.length;
  }

  calculateRiskScore(input, context = {}) {
    let risk = 0;
    if (input.risk !== undefined) risk += input.risk;
    if (input.action?.includes('delete') || input.action?.includes('drop') || input.action?.includes('rm')) risk += 0.5;
    if (context.priority === 'critical') risk += 0.2;
    if (context.priority === 'revenue') risk += 0.1;
    if (input.cost && input.cost > 0.5) risk += 0.1;
    return Math.min(1, risk);
  }

  calculateExpectedValue(input, context = {}) {
    const revenue = input.revenue || context.revenue || 0;
    const cost = input.cost || context.cost || 0;
    const probability = this.estimateSuccessProbability(input);
    return (revenue * probability) - cost;
  }

  estimateSuccessProbability(decision) {
    const strategy = decision.strategy || decision.action;
    if (!strategy || !this.decisions.length) return 0.5;

    const relevant = this.decisions.filter(
      (d) => (d.strategy === strategy || d.action === strategy) && d.outcome
    );
    if (!relevant.length) return 0.5;

    const success = relevant.filter((d) => d.outcome?.status === 'success').length;
    return success / relevant.length;
  }

  estimateTime(input) {
    if (input.estimatedTimeMs) return input.estimatedTimeMs;
    if (input.complexity === 'high') return 5000;
    if (input.complexity === 'medium') return 2000;
    return 500;
  }

  isDangerousAction(decision) {
    const action = String(decision.action || '').toLowerCase();
    const dangerous = ['delete', 'drop', 'rm', 'remove', 'destroy', 'wipe', 'reset', 'shutdown', 'kill'];
    return dangerous.some((d) => action.includes(d));
  }

  defaultRollbackPlan(input) {
    return input.rollback || 'restore_last_checkpoint';
  }

  normalize(value, min, max) {
    if (typeof value !== 'number') return 0;
    return Math.max(min, Math.min(max, value));
  }

  getStatus() {
    return {
      totalDecisions: this.decisions.length,
      summary: this.getHistorySummary(),
      lastDecision: this.decisions[this.decisions.length - 1] || null,
    };
  }
}

module.exports = DecisionIntelligence;
