'use strict';

const HModule = require('./HModule');
const HardwareDiscovery = require('../hydi-v3/HardwareDiscovery');

/**
 * SystemIntelligence continuously measures the host and the kernel so HYDI
 * can make scheduling, routing, and resource-allocation decisions.
 */
class SystemIntelligence extends HModule {
  constructor(kernel, manifest = {}) {
    super(kernel, {
      id: manifest.id || 'system-intelligence',
      name: manifest.name || 'System Intelligence',
      version: manifest.version || '1.0.0',
      capabilities: ['metrics', 'hardware-discovery', 'scheduling'],
      ...manifest,
    });
    this.hardware = new HardwareDiscovery(manifest.hardware);
    this.metrics = new Map();
    this._timer = null;
    this._intervalMs = manifest.intervalMs || 30000;
  }

  async start() {
    await super.start();
    this._record('startup_time', process.uptime() * 1000, { unit: 'ms' });
    this._timer = setInterval(() => this.sample(), this._intervalMs);
    if (this._timer.unref) this._timer.unref();
    return this.sample();
  }

  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await super.stop();
  }

  async sample() {
    const mem = process.memoryUsage();
    const inventory = await this.hardware.getInventory().catch(() => ({ gpus: [], fallback: true }));
    const gpus = inventory.gpus || [];
    const healthy = gpus.filter((g) => g.isHealthy).length;

    const health = this.kernel.healthMonitor.getLast();
    const modules = this.kernel.moduleRegistry.list();

    const snapshot = {
      timestamp: new Date().toISOString(),
      memory: {
        heapUsed: mem.heapUsed,
        rss: mem.rss,
        external: mem.external,
      },
      gpus: {
        total: gpus.length,
        healthy,
        vramFreeBytes: gpus.reduce((sum, g) => sum + (g.vramFreeBytes || 0), 0),
      },
      modules: {
        total: modules.length,
        running: modules.filter((m) => m.running).length,
        failed: health?.failed || 0,
      },
      events: this.kernel.eventBus._sequence,
      queueDepth: health?.failed ? health.total - health.healthy : 0,
    };

    this._record('memory.heapUsed', mem.heapUsed);
    this._record('memory.rss', mem.rss);
    this._record('gpu.healthy', healthy);
    this._record('modules.running', snapshot.modules.running);
    this._record('events.total', snapshot.events);

    return snapshot;
  }

  _record(name, value, tags = {}) {
    this.metrics.set(name, { value, tags, at: Date.now() });
    this.kernel.telemetry?.record(name, value, tags);
  }

  getMetric(name) {
    return this.metrics.get(name);
  }

  getSnapshot() {
    return Object.fromEntries(this.metrics);
  }

  async recommendAdapter(request) {
    const status = await this.kernel.intelligenceBus.getStatus();
    const healthy = Object.entries(status).filter(([, s]) => s.available);
    if (healthy.length === 0) return null;
    const choice = healthy.sort((a, b) => (b[1].score || 0) - (a[1].score || 0))[0];
    return { name: choice[0], adapter: choice[1] };
  }

  async health() {
    return {
      healthy: this._started,
      initialized: this._initialized,
      samples: this.metrics.size,
    };
  }
}

module.exports = SystemIntelligence;
