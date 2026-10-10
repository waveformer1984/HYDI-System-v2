'use strict';
/**
 * HYDI Recovery Delegation Throttle
 *
 * Durable, cross-process governor that sits in front of the watchdog's
 * DELEGATE step. RecoveryEngine's per-attempt budget (3 tries, 5min
 * circuit cooldown) bounds each cycle but nothing bounds the NUMBER of
 * cycles: a permanently-unrecoverable component kept drawing ~3 pm2
 * calls every ~7min forever — ~9,624 attempts before protoforge-core
 * was repaired, which is what starved the PM2 daemon to ~196s jlist.
 *
 * Contract (mirrors the mission's recovery contract):
 *   HEALTHY → DEGRADED → RECOVERY_ATTEMPT → FAILED → COOLDOWN →
 *   RECOVERY_ATTEMPT → … → OPEN (human review)
 *
 *   - exponential backoff per failed delegation: baseMs * 2^cycles,
 *     capped at maxCooldownMs
 *   - after maxCycles consecutive failed cycles → state OPEN; no more
 *     delegations until clear() is called OR the service is observed
 *     healthy (recordHealthy)
 *   - in-flight marker prevents overlapping delegations across the two
 *     watchdog instances (PM2 long-run + scheduled --once)
 *   - durable JSON file, survives process restarts
 *
 * Pure logic is injectable (now, filePath) for deterministic tests.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  baseCooldownMs: 2 * 60 * 1000,      // first retry after 2min
  maxCooldownMs: 2 * 60 * 60 * 1000,  // backoff ceiling: 2h
  maxCycles: 24,                       // ~bounded lifetime churn → OPEN
  inFlightTtlMs: 15 * 60 * 1000,      // delegation assumed dead after 15min
};

class RecoveryThrottle {
  constructor(options = {}) {
    this.filePath = options.filePath
      || path.resolve(options.root || process.cwd(), '.hydi-operational', 'recovery-throttle.json');
    this.config = { ...DEFAULTS, ...options.config };
    this.now = options.now || (() => Date.now());
    this.state = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch { /* corrupt file → fresh state */ }
    return {};
  }

  _save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  _entry(component) {
    return this.state[component] || null;
  }

  /**
   * May a recovery be delegated for this component right now?
   * Returns { allowed, state, reason, nextAttemptAt, cooldownRemainingMs }.
   * Does not mutate state — call markDelegated() after spawning.
   */
  allow(component) {
    const e = this._entry(component);
    if (!e) return { allowed: true, state: 'HEALTHY', reason: 'no prior failures' };

    if (e.state === 'OPEN') {
      return { allowed: false, state: 'OPEN', reason: `circuit open after ${e.cycles} failed cycles — human review required`, nextAttemptAt: null, cooldownRemainingMs: null };
    }

    if (e.inFlightAt && this.now() - e.inFlightAt < this.config.inFlightTtlMs) {
      return { allowed: false, state: 'IN_FLIGHT', reason: 'recovery delegation already in flight', nextAttemptAt: null, cooldownRemainingMs: null };
    }

    const nextAt = e.nextAttemptAt ? new Date(e.nextAttemptAt).getTime() : 0;
    if (this.now() < nextAt) {
      return { allowed: false, state: 'COOLDOWN', reason: `backoff — next attempt in ${Math.ceil((nextAt - this.now()) / 1000)}s`, nextAttemptAt: e.nextAttemptAt, cooldownRemainingMs: nextAt - this.now() };
    }

    return { allowed: true, state: 'RECOVERY_ATTEMPT', reason: `${e.cycles} prior failed cycle(s)`, nextAttemptAt: null, cooldownRemainingMs: 0 };
  }

  /** Mark that a delegation was spawned (in-flight protection). */
  markDelegated(component) {
    const e = this._entry(component) || { component, cycles: 0, state: 'HEALTHY' };
    e.inFlightAt = this.now();
    this.state[component] = e;
    this._save();
  }

  /**
   * Record a delegation's outcome. success=true resets the entry
   * entirely (budget renews only on demonstrated health — per contract).
   */
  recordOutcome(component, success, failureDetail) {
    const e = this._entry(component) || { component, cycles: 0, state: 'HEALTHY' };
    delete e.inFlightAt;
    if (success) {
      delete this.state[component];
      this._save();
      return;
    }
    e.cycles = (e.cycles || 0) + 1;
    e.lastAttemptAt = new Date(this.now()).toISOString();
    e.lastFailure = (failureDetail || 'delegation failed').slice(0, 200);
    if (e.cycles >= this.config.maxCycles) {
      e.state = 'OPEN';
      e.nextAttemptAt = null;
    } else {
      const cooldown = Math.min(this.config.baseCooldownMs * Math.pow(2, e.cycles - 1), this.config.maxCooldownMs);
      e.state = 'COOLDOWN';
      e.cooldownMs = cooldown;
      e.nextAttemptAt = new Date(this.now() + cooldown).toISOString();
    }
    this.state[component] = e;
    this._save();
  }

  /** A live health observation cleared the failure — reset. */
  recordHealthy(component) {
    delete this.state[component];
    this._save();
  }

  /** Manual reset (human review resolved). */
  clear(component) {
    delete this.state[component];
    this._save();
  }

  /** Snapshot for telemetry (workspace state / Command Center). */
  getStates() {
    const out = {};
    for (const [name, e] of Object.entries(this.state)) {
      const nextAt = e.nextAttemptAt ? new Date(e.nextAttemptAt).getTime() : null;
      out[name] = {
        state: e.state,
        cycles: e.cycles,
        lastAttemptAt: e.lastAttemptAt || null,
        nextAttemptAt: e.nextAttemptAt || null,
        cooldownRemainingMs: nextAt && this.now() < nextAt ? nextAt - this.now() : 0,
        lastFailure: e.lastFailure || null,
        inFlight: !!(e.inFlightAt && this.now() - e.inFlightAt < this.config.inFlightTtlMs),
      };
    }
    return out;
  }
}

module.exports = { RecoveryThrottle, THROTTLE_DEFAULTS: DEFAULTS };
