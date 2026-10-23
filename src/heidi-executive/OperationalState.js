/**
 * HEIDI Operational Decision Engine — Explicit Operational State Model
 */

const OPERATIONAL_STATES = Object.freeze([
  'UNKNOWN',
  'STABLE',
  'DEGRADED',
  'INCIDENT',
  'RECOVERING',
  'RECOVERED',
  'RECOVERY_FAILED',
  'MAINTENANCE',
]);

const VALID_TRANSITIONS = Object.freeze({
  UNKNOWN: ['STABLE', 'DEGRADED', 'INCIDENT', 'MAINTENANCE'],
  STABLE: ['DEGRADED', 'INCIDENT', 'MAINTENANCE'],
  DEGRADED: ['STABLE', 'INCIDENT', 'RECOVERING', 'MAINTENANCE'],
  INCIDENT: ['RECOVERING', 'RECOVERED', 'MAINTENANCE'],
  RECOVERING: ['RECOVERED', 'RECOVERY_FAILED', 'DEGRADED'],
  RECOVERED: ['STABLE', 'DEGRADED'],
  RECOVERY_FAILED: ['RECOVERING', 'INCIDENT', 'DEGRADED'],
  MAINTENANCE: ['UNKNOWN', 'STABLE'],
});

class OperationalState {
  constructor(name = 'UNKNOWN') {
    if (!OPERATIONAL_STATES.includes(name)) {
      throw new Error(`Invalid operational state: ${name}`);
    }
    this.state = name;
    this.history = [];
    this._record(name, { source: 'init', evidence: null, reason: 'initial state' });
  }

  _record(newState, meta) {
    this.history.push({
      timestamp: Date.now(),
      source: meta.source || 'unknown',
      from: this.state,
      to: newState,
      evidence: meta.evidence || null,
      reason: meta.reason || '',
      confidence: meta.confidence || 'LOW',
    });
  }

  transition(newState, meta = {}) {
    if (!OPERATIONAL_STATES.includes(newState)) {
      throw new Error(`Invalid operational state: ${newState}`);
    }
    if (newState === this.state) return this.state;
    const allowed = VALID_TRANSITIONS[this.state] || [];
    if (!allowed.includes(newState)) {
      throw new Error(`Disallowed transition: ${this.state} → ${newState}`);
    }
    this._record(newState, meta);
    this.state = newState;
    return this.state;
  }

  current() {
    return { state: this.state, since: this.history.length ? this.history[this.history.length - 1].timestamp : null };
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = { OperationalState, OPERATIONAL_STATES, VALID_TRANSITIONS };
