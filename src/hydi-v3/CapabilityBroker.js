'use strict';

const { EventEmitter } = require('events');
const ServiceContract = require('./ServiceContract');

/**
 * CapabilityBroker answers: "Which trusted node can perform this capability
 * right now?" It integrates with the local CapabilityRegistry, MarketplaceManager,
 * and NodeMesh to find and advertise capability providers.
 */
class CapabilityBroker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.registry = config.capabilityRegistry || null;
    this.marketplace = config.marketplaceManager || null;
    this.mesh = config.mesh || null;
    this.identity = config.identity || null;
    this.policy = config.policy || null;
    this.logger = config.logger || console;
    this.serviceContract = new ServiceContract({ logger: this.logger });
    this.serviceContract.define('capabilityBroker.query', {
      version: '1.0.0',
      inputs: ['capability'],
      outputs: ['provider'],
      optional: ['filters'],
    });
    this.providers = new Map();
    this._onAdvert = (msg) => this._handleAdvert(msg);
    this._onQuery = (msg) => this._handleQuery(msg);
    if (this.mesh) {
      this.mesh.on('capability_advert', this._onAdvert);
      this.mesh.on('capability_query', this._onQuery);
    }
  }

  start() {
    this.advertiseLocal();
    this.emit('started');
    return this;
  }

  stop() {
    if (this.mesh) {
      this.mesh.off('capability_advert', this._onAdvert);
      this.mesh.off('capability_query', this._onQuery);
    }
    this.emit('stopped');
    return this;
  }

  findProviders(capabilityId, options = {}) {
    const local = this.localCapabilities();
    const results = [];
    if (this.registry) {
      const cap = this.registry.get(capabilityId);
      if (cap) results.push({ nodeId: this.identity ? this.identity.nodeId : 'local', source: 'registry', capability: cap });
    }
    if (this.marketplace && typeof this.marketplace.search === 'function') {
      const market = this.marketplace.search({ id: capabilityId });
      for (const c of market) results.push({ nodeId: this.identity ? this.identity.nodeId : 'local', source: 'marketplace', capability: c });
    }
    for (const [nodeId, caps] of this.providers) {
      if (caps.includes(capabilityId)) {
        results.push({ nodeId, source: 'mesh', capabilityId });
      }
    }
    if (options.trusted && this.policy) {
      return results.filter((p) => this.policy.validateAction('use_capability', { nodeId: p.nodeId, capability: capabilityId }).allowed);
    }
    return results;
  }

  hasCapability(nodeId, capabilityId) {
    if (this.registry && nodeId === (this.identity ? this.identity.nodeId : 'local')) {
      return this.registry.get(capabilityId) !== null;
    }
    const caps = this.providers.get(nodeId);
    return caps ? caps.includes(capabilityId) : false;
  }

  localCapabilities() {
    const list = this.registry ? this.registry.list() : [];
    return list.map((c) => c.id);
  }

  advertiseLocal() {
    const caps = this.localCapabilities();
    if (this.mesh && this.mesh.broadcast) {
      this.mesh.broadcast('capability_advert', { capabilities: caps, ts: Date.now() });
    }
    this.emit('advertised', { nodeId: this.identity ? this.identity.nodeId : 'local', capabilities: caps });
  }

  _handleAdvert(msg) {
    const { from, payload } = msg;
    if (!from || !payload || !Array.isArray(payload.capabilities)) return;
    this.providers.set(from, payload.capabilities);
    this.emit('provider_updated', { nodeId: from, capabilities: payload.capabilities });
  }

  _handleQuery(msg) {
    const { from, payload } = msg;
    if (!from || !payload || !payload.capabilityId) return;
    const providers = this.findProviders(payload.capabilityId, { trusted: true });
    if (this.mesh && this.mesh.send) {
      this.mesh.send(from, 'capability_result', { capabilityId: payload.capabilityId, providers });
    }
    this.emit('query_answered', { from, capabilityId: payload.capabilityId, providers });
  }
}

module.exports = CapabilityBroker;
