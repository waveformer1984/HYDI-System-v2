'use strict';

const LifecycleDashboard = require('./LifecycleDashboard');

class MarketplaceDashboard extends LifecycleDashboard {
  constructor(config = {}) {
    super(config);
    this.marketplace = config.marketplaceManager || null;
    this.capabilityRegistry = config.capabilityRegistry || null;
    this.publisherRegistry = config.publisherRegistry || null;
    this.dependencyResolver = config.dependencyResolver || null;
  }

  async installedCapabilities() {
    return this.capabilityRegistry ? this.capabilityRegistry.list() : [];
  }

  async availableUpdates() {
    if (!this.marketplace || !this.capabilityRegistry) return [];
    const installed = this.capabilityRegistry.list();
    const updates = [];
    for (const cap of installed) {
      const latest = this.marketplace.repositories.getCapability(cap.id);
      if (latest && latest.version !== cap.version) updates.push({ id: cap.id, current: cap.version, latest: latest.version });
    }
    return updates;
  }

  async trustLevels() {
    if (!this.capabilityRegistry || !this.publisherRegistry) return [];
    return this.capabilityRegistry.list().map((cap) => ({
      id: cap.id,
      publisher: cap.publisher,
      trust: this.publisherRegistry.getTrustLevel(cap.publisher),
    }));
  }

  async compatibilityIssues() {
    if (!this.dependencyResolver || !this.capabilityRegistry) return [];
    const installed = this.capabilityRegistry.list();
    const issues = [];
    for (const cap of installed) {
      const resolved = this.dependencyResolver.resolve(cap, new Map(installed.map((c) => [c.id, c])));
      if (!resolved.success) issues.push({ id: cap.id, ...resolved });
    }
    return issues;
  }

  async repositoryStatus() {
    return this.marketplace ? this.marketplace.listRepositories() : [];
  }

  async dependencyGraph() {
    if (!this.capabilityRegistry) return [];
    return this.capabilityRegistry.list().map((cap) => ({ id: cap.id, dependencies: cap.dependencies }));
  }

  async resourceConsumption() {
    if (!this.marketplace || !this.marketplace.sandbox) return {};
    return this.marketplace.sandbox.usage;
  }

  async fullReport() {
    const base = await super.fullReport();
    return {
      ...base,
      marketplace: {
        installed: await this.installedCapabilities(),
        updates: await this.availableUpdates(),
        trustLevels: await this.trustLevels(),
        permissionRequests: await this.installedCapabilities().then((caps) => caps.map((c) => ({ id: c.id, permissions: c.requiredPermissions }))),
        compatibilityIssues: await this.compatibilityIssues(),
        repositories: await this.repositoryStatus(),
        dependencyGraph: await this.dependencyGraph(),
        resourceConsumption: await this.resourceConsumption(),
      },
    };
  }
}

module.exports = MarketplaceDashboard;
