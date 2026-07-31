'use strict';

const BaseConnector = require('./BaseConnector');
const ConnectorRegistry = require('./ConnectorRegistry');
const ConnectorHealth = require('./ConnectorHealth');
const ConnectorConfiguration = require('./ConnectorConfiguration');
const ConnectorMetrics = require('./ConnectorMetrics');
const { run } = require('./ConnectorLifecycle');

class ConnectorManager extends BaseConnector {
  constructor(config = {}) {
    super({ ...config, name: 'ConnectorManager' });
    this.connectors = new Map();
    this.registry = ConnectorRegistry;
    this.configuration = new ConnectorConfiguration(this.dataPath);
    this.metrics = new ConnectorMetrics();
    this.config = config.configuration || {};
  }

  configure(configuration) {
    this.config = { ...this.config, ...configuration };
    return this;
  }

  async start() {
    await this.configuration.load();
    const connectorConfigs = this.config.connectors || [];
    for (const cfg of connectorConfigs) {
      this._add(cfg);
    }

    for (const connector of this.connectors.values()) {
      if (!connector._isEnabled()) {
        connector._notConfigured('disabled in configuration');
        continue;
      }
      await run(connector, () => connector.start(), this.config.retry || {});
      connector.on('event', (event) => {
        this.metrics.record(connector.name, 'emitted');
        this.emit('event', event);
      });
    }

    this.state = 'running';
  }

  async stop() {
    for (const connector of [...this.connectors.values()].reverse()) {
      try {
        await connector.stop();
      } catch (error) {
        this.logger.error(`[ConnectorManager] failed to stop ${connector.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.state = 'stopped';
  }

  _add(cfg) {
    const type = cfg.type;
    const name = cfg.name || type;
    if (!type || !this.registry.isRegistered(type)) {
      this.logger.error(`[ConnectorManager] unknown connector type: ${type}`);
      return;
    }
    const connector = this.registry.create(type, {
      ...cfg,
      eventBus: this.eventBus,
      dataPath: this.dataPath,
      logger: this.logger,
      configuration: cfg,
      context: this.context,
      name,
    });
    this.connectors.set(name, connector);
  }

  healthCheck() {
    const aggregated = ConnectorHealth.aggregate([...this.connectors.values()]);
    this.state = aggregated.ok ? 'running' : 'degraded';
    return {
      ok: aggregated.ok,
      name: this.name,
      state: this.state,
      connectors: aggregated,
    };
  }

  status() {
    return [...this.connectors.values()].map((c) => c.status());
  }

  getConnector(name) {
    return this.connectors.get(name);
  }

  list() {
    return [...this.connectors.values()];
  }

  getMetrics() {
    const statusMetrics = this.status().reduce(
      (acc, s) => {
        acc.emitted += s.metrics.emitted;
        acc.errors += s.metrics.errors;
        return acc;
      },
      { emitted: 0, errors: 0 },
    );
    return {
      ...this.metrics.aggregate(),
      ...statusMetrics,
    };
  }

  async reconnect(name) {
    const connector = this.connectors.get(name);
    if (!connector) throw new Error(`Connector ${name} not found`);
    return connector.reconnect();
  }
}

module.exports = ConnectorManager;
