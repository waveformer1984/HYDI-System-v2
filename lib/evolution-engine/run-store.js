'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const STATES = Object.freeze([
  'proposed',
  'approved',
  'running',
  'verifying',
  'ready_for_review',
  'failed',
  'rolled_back',
  'cancelled',
  'blocked',
]);

const LEASE_MS = 120_000;

/**
 * File-backed evolution runs (survives mobile disconnect; reconcile on resume).
 */
class EvolutionRunStore {
  /**
   * @param {{ rootDir?: string, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.rootDir = opts.rootDir || path.join(process.cwd(), '.runtime', 'evolution', 'runs');
    this.now = opts.now || (() => Date.now());
    this.emergencyStopPath = path.join(path.dirname(this.rootDir), 'EMERGENCY_STOP');
  }

  ensureDirs() {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  isEmergencyStop() {
    if (process.env.EVOLUTION_EMERGENCY_STOP === '1') return true;
    return fs.existsSync(this.emergencyStopPath);
  }

  setEmergencyStop(reason = 'operator') {
    this.ensureDirs();
    fs.writeFileSync(
      this.emergencyStopPath,
      JSON.stringify({ at: new Date().toISOString(), reason }),
    );
    return { ok: true, path: this.emergencyStopPath };
  }

  clearEmergencyStop() {
    if (fs.existsSync(this.emergencyStopPath)) fs.unlinkSync(this.emergencyStopPath);
    return { ok: true };
  }

  /**
   * @param {string} idempotencyKey
   */
  findByIdempotency(idempotencyKey) {
    if (!idempotencyKey || !fs.existsSync(this.rootDir)) return null;
    for (const f of fs.readdirSync(this.rootDir)) {
      if (!f.endsWith('.json')) continue;
      const run = JSON.parse(fs.readFileSync(path.join(this.rootDir, f), 'utf8'));
      if (run.idempotency_key === idempotencyKey) return run;
    }
    return null;
  }

  /**
   * @param {object} partial
   */
  createRun(partial) {
    this.ensureDirs();
    if (partial.idempotency_key) {
      const existing = this.findByIdempotency(partial.idempotency_key);
      if (existing) return { duplicate: true, run: existing };
    }
    const run = {
      run_id: randomBytes(8).toString('hex'),
      state: 'proposed',
      created_at: new Date(this.now()).toISOString(),
      updated_at: new Date(this.now()).toISOString(),
      idempotency_key: partial.idempotency_key || null,
      contract: partial.contract || null,
      item_id: partial.item_id || null,
      attempt_id: null,
      lease_holder: null,
      lease_expires_at: null,
      evidence_path: null,
      ...partial,
    };
    this._write(run);
    return { duplicate: false, run };
  }

  get(runId) {
    const p = path.join(this.rootDir, `${runId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  /**
   * @param {string} runId
   * @param {string} workerId
   */
  claimLease(runId, workerId) {
    const run = this.get(runId);
    if (!run) return { ok: false, error: 'run_not_found' };
    const now = this.now();
    if (run.lease_holder && run.lease_expires_at && Date.parse(run.lease_expires_at) > now && run.lease_holder !== workerId) {
      return { ok: false, error: 'lease_held', holder: run.lease_holder };
    }
    run.lease_holder = workerId;
    run.lease_expires_at = new Date(now + LEASE_MS).toISOString();
    run.updated_at = new Date(now).toISOString();
    this._write(run);
    return { ok: true, run };
  }

  transition(runId, nextState, patch = {}) {
    if (!STATES.includes(nextState)) {
      return { ok: false, error: 'invalid_state', state: nextState };
    }
    const run = this.get(runId);
    if (!run) return { ok: false, error: 'run_not_found' };
    run.state = nextState;
    run.updated_at = new Date(this.now()).toISOString();
    Object.assign(run, patch);
    this._write(run);
    return { ok: true, run };
  }

  _write(run) {
    const p = path.join(this.rootDir, `${run.run_id}.json`);
    fs.writeFileSync(p, JSON.stringify(run, null, 2));
  }
}

module.exports = { EvolutionRunStore, STATES, LEASE_MS };
