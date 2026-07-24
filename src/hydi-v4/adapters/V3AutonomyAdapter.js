'use strict';

const HModule = require('../HModule');
const AutonomyManager = require('../../hydi-v3');

/**
 * V3AutonomyAdapter wraps the stable V3 HYDIAutonomyManager as a V4 kernel module.
 *
 * This adapter lets the V4 kernel orchestrate the proven V3 autonomy layer
 * without redesigning it. All V3 capabilities are exposed as V4 capability topics.
 */
class V3AutonomyAdapter extends HModule {
  constructor(kernel, manifest = {}, components = {}) {
    super(kernel, {
      id: manifest.id || 'hydi-v3-autonomy',
      name: manifest.name || 'HYDI V3 Autonomy',
      version: manifest.version || '3.0.0',
      capabilities: [
        'mission-planning',
        'decision-intelligence',
        'self-healing',
        'reflection',
        'observability',
        'security-audit',
        'performance-benchmark',
      ],
      ...manifest,
    });
    this.v3Components = components;
    this.manager = null;
  }

  async initialize() {
    const config = {
      dataPath: this.kernel.config.dataPath,
      enableGracefulShutdown: false,
      enableWatchdog: false,
      enableHeartbeat: false,
      enableDistributedCompute: false,
      enableSelfHealing: false,
      enableMemoryIntegrity: false,
      enableObservability: false,
      enableSecurity: false,
      enableCudaPool: false,
      ...(this.v3Components.config || {}),
    };
    this.manager = new AutonomyManager({ ...this.v3Components, config });
    this._initialized = true;
  }

  async start() {
    if (!this.manager) await this.initialize();
    await this.manager.start();
    this._started = true;
  }

  async stop() {
    if (this.manager) {
      await this.manager.stop();
    }
    this._started = false;
  }

  async dispose() {
    if (this.manager) {
      this.manager.destroy();
      this.manager = null;
    }
    this._initialized = false;
  }

  async health() {
    if (!this.manager) return { healthy: false, initialized: false };
    return {
      healthy: this._started,
      initialized: this._initialized,
      v3Status: this.manager.getStatus(),
    };
  }
}

module.exports = V3AutonomyAdapter;
