'use strict';

const { EventEmitter } = require('events');
const InvariantRegistry = require('./InvariantRegistry');
const ArchitectureAudit = require('./ArchitectureAudit');
const ArchitectureInvariant = require('./ArchitectureInvariant');
const path = require('path');

/**
 * ArchitectureGuard runs the registered architecture invariants and produces
 * a score, report, and audit trail. It can be used in tests, in CI, or via
 * the `hydi architecture` CLI.
 */
class ArchitectureGuard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.projectRoot = config.projectRoot || process.cwd();
    this.registry = config.invariantRegistry || new InvariantRegistry();
    this.audit = config.architectureAudit || new ArchitectureAudit({ lifecycleRegistry: config.lifecycleRegistry });
    this.results = [];
    this.lastRun = null;
  }

  add(invariant) {
    if (!(invariant instanceof ArchitectureInvariant)) {
      invariant = new ArchitectureInvariant(invariant);
    }
    this.registry.register(invariant);
    return this;
  }

  verify() {
    const start = Date.now();
    const invariants = this.registry.list();
    this.results = [];

    for (const invariant of invariants) {
      const result = invariant.verify(this);
      this.audit.record(result);
      this.results.push(result);
      this.emit('invariant', result);
    }

    const counts = this._counts();
    const total = invariants.length;
    const score = total === 0 ? 1 : parseFloat((counts.pass / total).toFixed(2));
    const status = counts.fail === 0 ? 'pass' : 'fail';

    this.lastRun = {
      ts: Date.now(),
      duration: Date.now() - start,
      status,
      score,
      counts,
      results: this.results,
    };

    this.emit('verified', this.lastRun);
    return this.lastRun;
  }

  _counts() {
    const c = { pass: 0, fail: 0, warning: 0, manual: 0, error: 0 };
    for (const r of this.results) {
      c[r.status] = (c[r.status] || 0) + 1;
    }
    return c;
  }

  healthScore() {
    if (!this.lastRun) this.verify();
    return this.lastRun.score;
  }

  failures() {
    return this.results.filter((r) => r.status === 'fail' || r.status === 'error');
  }

  warnings() {
    return this.results.filter((r) => r.status === 'warning');
  }

  manual() {
    return this.results.filter((r) => r.status === 'manual');
  }

  relative(filePath) {
    return path.relative(this.projectRoot, filePath);
  }
}

module.exports = ArchitectureGuard;
