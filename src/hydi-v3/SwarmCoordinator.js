'use strict';

const { EventEmitter } = require('events');

/**
 * SwarmCoordinator is the top-level orchestrator for the Phase 42
 * collaborative execution fabric. It wires together discovery, scoring,
 * planning, queueing, balancing, consensus, and metrics.
 */
class SwarmCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity || null;
    this.mesh = config.mesh || null;
    this.broker = config.broker || config.capabilityBroker || null;
    this.scorer = config.scorer || config.nodeScorer || null;
    this.monitor = config.monitor || config.resourceMonitor || null;
    this.planner = config.planner || config.executionPlanner || null;
    this.queue = config.queue || config.distributedQueue || null;
    this.balancer = config.balancer || config.workloadBalancer || null;
    this.migrator = config.migrator || config.taskMigrationManager || null;
    this.consensus = config.consensus || config.consensusManager || null;
    this.metrics = config.metrics || config.federationMetrics || null;
    this.dashboard = config.dashboard || config.swarmDashboard || null;
    this.policy = config.policy || null;
    this.contracts = config.serviceContract || null;
    this.logger = config.logger || console;
    this._started = false;
  }

  _call(obj, method) {
    if (obj && typeof obj[method] === 'function') obj[method]();
  }

  start() {
    if (this._started) return this;
    this._started = true;
    this._call(this.monitor, 'start');
    this._call(this.broker, 'start');
    this._call(this.queue, 'start');
    this._call(this.balancer, 'start');
    this._call(this.consensus, 'start');
    this._call(this.mesh, 'start');
    this.emit('started');
    return this;
  }

  stop() {
    this._started = false;
    this._call(this.mesh, 'stop');
    this._call(this.balancer, 'stop');
    this._call(this.queue, 'stop');
    this._call(this.broker, 'stop');
    this._call(this.monitor, 'stop');
    this._call(this.consensus, 'stop');
    this.emit('stopped');
    return this;
  }

  async submit(task, options = {}) {
    if (this.contracts) {
      const check = this.contracts.validate('SwarmCoordinator.submit', { task, options });
      if (!check.valid) return { success: false, error: check.error };
    }
    if (this.metrics) this.metrics.increment('tasksSubmitted');

    const result = await this.planner.execute(task, options);
    if (!result.success) return result;

    this.emit('submitted', result);
    return result;
  }

  queryCapability(capabilityId, options = {}) {
    if (!this.broker) return { success: false, error: 'no_broker' };
    return { success: true, providers: this.broker.findProviders(capabilityId, options) };
  }

  async propose(topic, value) {
    if (!this.consensus) return { success: false, error: 'no_consensus' };
    return this.consensus.propose(topic, value);
  }

  async decide(topic, timeoutMs) {
    if (!this.consensus) return { success: false, error: 'no_consensus' };
    return this.consensus.decide(topic, timeoutMs);
  }

  status() {
    return {
      started: this._started,
      nodes: this.mesh ? this.mesh.getPeers() : [],
      queue: this.queue ? this.queue.stats() : null,
      metrics: this.metrics ? this.metrics.snapshot() : null,
      consensus: this.consensus ? Array.from(this.consensus.decisions.values()).map((d) => d.topic) : [],
    };
  }

  onNodeFailed(nodeId) {
    if (this.balancer) this.balancer.rebalanceAfterFailure(nodeId);
    this.emit('node_failed', { nodeId });
    if (this.metrics) this.metrics.record('node_failure', 1, { nodeId });
  }
}

module.exports = SwarmCoordinator;
