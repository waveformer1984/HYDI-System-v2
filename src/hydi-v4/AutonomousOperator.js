'use strict';

const HModule = require('./HModule');
const DoctorCLI = require('./DoctorCLI');

/**
 * AutonomousOperator continuously runs diagnostic, repair, and optimization
 * routines. It is the engine behind Phase Eight autonomous operations.
 */
class AutonomousOperator extends HModule {
  constructor(kernel, manifest = {}) {
    super(kernel, {
      id: manifest.id || 'autonomous-operator',
      name: manifest.name || 'Autonomous Operator',
      version: manifest.version || '1.0.0',
      capabilities: ['autonomy', 'diagnostics', 'repair', 'optimization'],
      ...manifest,
    });
    this.doctor = new DoctorCLI(kernel);
    this.schedule = manifest.schedule || { intervalMs: 60000, operations: ['doctor', 'audit', 'benchmark'] };
    this._timer = null;
    this._running = false;
    this.history = [];
  }

  async start() {
    await super.start();
    this._running = true;
    this._timer = setInterval(() => this.runCycle(), this.schedule.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  async stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await super.stop();
  }

  async runCycle(operations = this.schedule.operations) {
    const results = {};
    for (const op of operations) {
      try {
        const result = await this.doctor.run([op]);
        results[op] = { ok: result.ok, at: new Date().toISOString() };
        if (!result.ok && op !== 'repair') {
          const repair = await this.doctor.run(['repair']);
          results.repair = { ok: repair.ok, at: new Date().toISOString() };
        }
      } catch (err) {
        results[op] = { ok: false, error: err.message };
      }
    }
    this.history.push({ at: new Date().toISOString(), results });
    if (this.history.length > 1000) this.history.shift();
    this.kernel.telemetry?.record('autonomous_cycle', 1, { operations: operations.join(',') });
    return results;
  }

  async run(op, args = []) {
    return this.doctor.run([op, ...args]);
  }

  getHistory(limit = 10) {
    return this.history.slice(-limit);
  }

  async health() {
    return {
      healthy: this._running,
      initialized: this._initialized,
      lastRun: this.history[this.history.length - 1] || null,
    };
  }
}

module.exports = AutonomousOperator;
