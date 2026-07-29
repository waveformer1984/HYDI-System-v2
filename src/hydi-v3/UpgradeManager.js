'use strict';

const { EventEmitter } = require('events');
const EvolutionProposal = require('./EvolutionProposal');

class UpgradeManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.registry = config.registry || null;
    this.snapshotManager = config.snapshotManager || null;
    this.compatibility = config.compatibilityManager || null;
    this.logger = config.logger || console;
    this.proposals = [];
    this.history = [];
  }

  async discover() {
    if (!this.registry) return [];
    return this.registry.list().map((c) => ({
      name: c.name,
      current: c.version,
      proposed: this._bump(c.version),
      phase: c.phase,
    }));
  }

  _bump(version) {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }

  async analyze(candidate) {
    const compat = this.compatibility
      ? this.compatibility.validate(candidate.name, candidate.proposed, this._dependenciesFor(candidate.name))
      : { status: 'compatible', reasons: [] };
    const proposal = new EvolutionProposal({
      title: `Upgrade ${candidate.name} to ${candidate.proposed}`,
      change: { name: candidate.name, from: candidate.current, to: candidate.proposed },
      reason: 'Patch release from lifecycle discovery',
      benefit: 'Incremental improvement',
      affected: [candidate.name],
      risk: compat.status === 'blocked' ? 'high' : (compat.status === 'warning' ? 'medium' : 'low'),
      rollback: this.snapshotManager ? 'restore_pre_upgrade_snapshot' : 'manual_rollback',
      approvalRequired: compat.status === 'blocked' || compat.status === 'warning',
    });
    this.proposals.push(proposal);
    const success = compat.status !== 'blocked';
    return { success, candidate, compat, proposal, reasons: compat.reasons };
  }

  _dependenciesFor(name) {
    const c = this.registry ? this.registry.get(name) : null;
    return (c && c.dependencies) || [];
  }

  async snapshot() {
    if (!this.snapshotManager) return { success: false, error: 'no_snapshot_manager' };
    return this.snapshotManager.create('pre-upgrade');
  }

  async simulate(plan) {
    return { success: true, simulated: true, plan };
  }

  async execute(plan) {
    if (!this.registry) return { success: false, error: 'no_registry' };
    const { name, to } = plan;
    const from = (this.registry.get(name) || {}).version;
    const snap = plan.snapshotHash || null;
    const upgraded = this.registry.recordUpgrade({ name, from, to, snapshotHash: snap });
    if (!upgraded) return { success: false, error: 'upgrade_failed' };
    this.history.push({ at: Date.now(), name, from, to, snapshotHash: snap });
    this.emit('upgraded', upgraded);
    return { success: true, record: upgraded };
  }

  async validate(name) {
    const c = this.registry ? this.registry.get(name) : null;
    if (!c) return { success: false, error: 'not_found' };
    const ok = c.health !== 'unhealthy';
    return { success: ok, health: c.health };
  }

  async commit(plan) {
    this.emit('committed', plan);
    return { success: true, plan };
  }

  async runUpgrade(candidate, options = {}) {
    const phases = ['DISCOVER', 'ANALYZE', 'SNAPSHOT', 'SIMULATE', 'UPGRADE', 'VALIDATE', 'COMMIT'];
    const report = { states: [] };
    let lastSnapshot = null;
    for (const p of phases) {
      let result;
      try {
        switch (p) {
          case 'DISCOVER': result = { success: true, candidates: [candidate] }; break;
          case 'ANALYZE': result = await this.analyze(candidate); break;
          case 'SNAPSHOT':
            result = await this.snapshot();
            if (result && result.success) lastSnapshot = result.hash;
            break;
          case 'SIMULATE': result = await this.simulate(candidate); break;
          case 'UPGRADE': result = await this.execute({ name: candidate.name, to: candidate.proposed, snapshotHash: lastSnapshot }); break;
          case 'VALIDATE': result = await this.validate(candidate.name); break;
          case 'COMMIT': result = await this.commit(candidate); break;
          default: result = { success: false, error: 'unknown_phase' };
        }
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      report.states.push({ phase: p, success: result.success, result });
      if (!result.success && !options.continueOnFailure) {
        if (options.autoRollback && this.snapshotManager) {
          const restored = await this.snapshotManager.restore('latest');
          report.rollback = restored.success;
        }
        return { success: false, report };
      }
    }
    return { success: true, report };
  }

  getHistory() {
    return this.history.slice();
  }
}

module.exports = UpgradeManager;
