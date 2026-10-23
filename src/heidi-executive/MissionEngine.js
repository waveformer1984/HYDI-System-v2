/**
 * HEIDI Operational Decision Engine — Bounded Mission Execution
 */

const { OperationalState } = require('./OperationalState');
const { AutonomyPolicy } = require('./AutonomyPolicy');

class MissionEngine {
  constructor(options = {}) {
    this.policy = options.policy || new AutonomyPolicy();
    this.audit = options.audit || null;
    this.maxActions = options.maxActions || 20;
    this.maxRetries = options.maxRetries || 3;
    this.missionTimeoutMs = options.missionTimeoutMs || 300000;
    this.cooldownMs = options.cooldownMs || 10000;
    this.lastActionAt = 0;
    this.actionsTaken = 0;
  }

  async execute(mission, executor, verifier) {
    const state = new OperationalState('STABLE');
    const steps = mission.steps || [];
    const evidence = [];
    const start = Date.now();

    state.transition('INCIDENT', { source: 'mission-start', reason: mission.objective });

    for (let i = 0; i < steps.length; i++) {
      if (Date.now() - start > this.missionTimeoutMs) {
        return this.finalize(mission, state, evidence, 'TIMEOUT');
      }
      if (this.actionsTaken >= this.maxActions) {
        return this.finalize(mission, state, evidence, 'MAX_ACTIONS');
      }

      const step = steps[i];
      const auth = this.policy.canExecute(step.capabilityId, step.approved);
      if (!auth.ok) {
        evidence.push({ step: i, result: 'UNAUTHORIZED', reason: auth.reason });
        return this.finalize(mission, state, evidence, 'UNAUTHORIZED');
      }

      const cooldown = this.lastActionAt + this.cooldownMs - Date.now();
      if (cooldown > 0) await this.delay(cooldown);

      let success = false;
      let lastError = null;
      for (let r = 0; r <= this.maxRetries; r++) {
        if (r > 0) await this.delay(this.cooldownMs * r);
        try {
          const result = await executor(step);
          this.actionsTaken++;
          this.lastActionAt = Date.now();
          evidence.push({ step: i, result: 'EXECUTED', detail: result });
          success = true;
          break;
        } catch (e) {
          lastError = e.message;
          evidence.push({ step: i, attempt: r, result: 'ERROR', error: lastError });
        }
      }

      if (!success) {
        if (step.fallback) {
          steps.splice(i + 1, 0, step.fallback);
          continue;
        }
        return this.finalize(mission, state, evidence, 'FAILED');
      }

      if (step.verify !== false) {
        try {
          const verified = await verifier(step);
          evidence.push({ step: i, result: 'VERIFIED', ok: verified });
        } catch (e) {
          evidence.push({ step: i, result: 'VERIFY_ERROR', error: e.message });
          return this.finalize(mission, state, evidence, 'VERIFY_FAILED');
        }
      }
    }

    state.transition('RECOVERED', { source: 'mission-complete', reason: 'all steps executed' });
    state.transition('STABLE', { source: 'mission-complete', reason: 'verification passed' });
    return this.finalize(mission, state, evidence, 'SUCCESS');
  }

  finalize(mission, state, evidence, status) {
    const finalState = state.current().state;
    const record = {
      missionId: mission.id,
      objective: mission.objective,
      status,
      finalState,
      stepsExecuted: this.actionsTaken,
      evidence,
      history: state.getHistory(),
      completedAt: new Date().toISOString(),
    };
    if (this.audit) this.audit.record(record);
    return record;
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { MissionEngine };
