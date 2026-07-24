'use strict';

const HModule = require('./HModule');

/**
 * Dashboard aggregates live operating-system state for the HYDI dashboard.
 *
 * It can be queried by the CLI, served via an API, or rendered by ProtoForge.
 */
class Dashboard extends HModule {
  constructor(kernel, manifest = {}) {
    super(kernel, {
      id: manifest.id || 'dashboard',
      name: manifest.name || 'HYDI Dashboard',
      version: manifest.version || '1.0.0',
      capabilities: ['dashboard', 'observability'],
      ...manifest,
    });
    this._snapshot = {};
    this._subscriptions = [];
  }

  async start() {
    await super.start();
    const subs = [
      this.kernel.eventBus.subscribe('published', () => this._tick()),
      this.kernel.eventBus.subscribe('health', () => this._tick()),
    ];
    this._subscriptions = subs;
    return this._tick();
  }

  async stop() {
    for (const id of this._subscriptions) {
      this.kernel.eventBus.unsubscribe('published', id);
      this.kernel.eventBus.unsubscribe('health', id);
    }
    this._subscriptions = [];
    await super.stop();
  }

  async _tick() {
    const health = this.kernel.healthMonitor.getLast();
    const modules = this.kernel.moduleRegistry.list();
    const intelligence = await this.kernel.intelligenceBus.getStatus().catch(() => ({}));
    const memory = this.kernel.memoryBus.adapter.store ? { entries: this.kernel.memoryBus.adapter.store.size } : {};

    this._snapshot = {
      generatedAt: new Date().toISOString(),
      kernel: this.kernel.getStatus(),
      health,
      modules,
      intelligence,
      memory,
      events: this.kernel.eventBus._sequence,
      services: {
        business: modules.filter((m) => m.id.includes('revenue') || m.id.includes('stripe') || m.id.includes('subscription')).length,
        printing: modules.filter((m) => m.id.includes('print') || m.id.includes('forge')).length,
        music: modules.filter((m) => m.id.includes('music') || m.id.includes('audio')).length,
        automation: modules.filter((m) => m.id.includes('automation') || m.id.includes('agent')).length,
        security: modules.filter((m) => m.id.includes('security') || m.id.includes('audit')).length,
      },
    };

    return this._snapshot;
  }

  getSnapshot() {
    return this._snapshot;
  }

  async health() {
    return {
      healthy: this._started,
      initialized: this._initialized,
      lastSnapshot: this._snapshot.generatedAt,
    };
  }
}

module.exports = Dashboard;
