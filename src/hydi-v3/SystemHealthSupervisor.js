'use strict';

const { EventEmitter } = require('events');
const RecoveryManager = require('./RecoveryManager');

class SystemHealthSupervisor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.subsystems = config.subsystems || {};
    this.recovery = config.recovery || new RecoveryManager({ logger: config.logger || console });
    this.snapshotStore = config.snapshotStore || null;
    this.intervalMs = config.intervalMs || 5000;
    this.snapshotIntervalMs = config.snapshotIntervalMs || 60000;
    this.logger = config.logger || console;
    this._timer = null;
    this._snapshotTimer = null;
    this._started = false;
    this._shutdown = false;
  }

  start() {
    if (this._started) return this;
    this._started = true;
    this._timer = setInterval(() => this.check(), this.intervalMs);
    if (this.snapshotStore && this.snapshotIntervalMs > 0) {
      this._snapshotTimer = setInterval(() => this.capture(), this.snapshotIntervalMs);
    }
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    this._timer = null;
    this._snapshotTimer = null;
    this._started = false;
    return this;
  }

  async check() {
    if (this._shutdown) return;
    const findings = [];
    for (const [name, fn] of Object.entries(this.subsystems)) {
      try {
        const result = await fn();
        if (result && result.healthy === false) {
          findings.push({ type: result.symptom || `${name}_unavailable`, target: name, detail: result.detail });
        }
      } catch (err) {
        findings.push({ type: `${name}_unavailable`, target: name, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    if (findings.length === 0) {
      this.emit('health', { ok: true });
      return { ok: true };
    }

    const fatal = findings.find((f) => this.recovery.taxonomy.isFatal(f));
    if (fatal) {
      this._shutdown = true;
      this.emit('fatal', fatal);
      this.stop();
      return { ok: false, fatal };
    }

    const results = [];
    for (const f of findings) {
      const r = await this.recovery.recover(f, { supervisor: this });
      results.push({ finding: f, result: r });
    }
    this.emit('health', { ok: false, findings, results });
    return { ok: false, findings, results };
  }

  async capture() {
    if (!this.snapshotStore) return null;
    const context = { subsystems: {}, meta: {} };
    for (const [name, fn] of Object.entries(this.subsystems)) {
      try {
        const s = await fn();
        context.subsystems[name] = s;
      } catch (e) {
        context.subsystems[name] = { healthy: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const snap = await this.snapshotStore.capture(context);
    this.emit('snapshot', snap);
    return snap;
  }
}

module.exports = SystemHealthSupervisor;
