'use strict';

class LifecycleDashboard {
  constructor(config = {}) {
    this.registry = config.registry || null;
    this.upgradeManager = config.upgradeManager || null;
    this.pluginRuntime = config.pluginRuntime || null;
    this.snapshotManager = config.snapshotManager || null;
    this.compatibilityManager = config.compatibilityManager || null;
    this.recoveryManager = config.recoveryManager || null;
    this.telemetry = config.telemetry || null;
    this.optimizer = config.optimizer || null;
  }

  async lifecycleStatus() {
    if (!this.registry) return null;
    const report = this.registry.healthReport();
    const proposals = this.registry.getProposals();
    const upgrades = this.registry.getUpgradeHistory(20);
    return { ...report, proposalCount: proposals.length, recentUpgrades: upgrades };
  }

  async upgradeHistory() {
    return this.upgradeManager ? this.upgradeManager.getHistory() : [];
  }

  async snapshotHealth() {
    if (!this.snapshotManager) return null;
    const list = await this.snapshotManager.list();
    return { total: list.length, latest: list[0] || null };
  }

  async compatibilityState() {
    if (!this.compatibilityManager || !this.registry) return null;
    const targets = this.registry.list().map((c) => ({ name: c.name, version: this._bump(c.version), dependencies: c.dependencies }));
    return this.compatibilityManager.checkGraph(targets);
  }

  _bump(version) {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }

  async pluginPermissions() {
    return this.pluginRuntime ? this.pluginRuntime.securityReport() : [];
  }

  async fullReport() {
    return {
      generatedAt: new Date().toISOString(),
      lifecycle: await this.lifecycleStatus(),
      upgrades: await this.upgradeHistory(),
      snapshots: await this.snapshotHealth(),
      compatibility: await this.compatibilityState(),
      plugins: await this.pluginPermissions(),
    };
  }
}

module.exports = LifecycleDashboard;
