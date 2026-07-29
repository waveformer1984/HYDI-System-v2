'use strict';

const { EventEmitter } = require('events');
const ServiceContract = require('./ServiceContract');

/**
 * FederationGateway is the single entry point for federation interactions:
 * remote execution, capability lookup, lifecycle and marketplace
 * synchronization, and governance event distribution. Every action emits an
 * audit record and, when provided, forwards to lifecycle and observability.
 */
class FederationGateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.taskManager = config.taskManager || null;
    this.memoryStore = config.memoryStore || null;
    this.policy = config.policy || null;
    this.marketplace = config.marketplace || null;
    this.lifecycle = config.lifecycle || null;
    this.observability = config.observability || null;
    this.logger = config.logger || console;
    this.serviceContract = new ServiceContract({ logger: this.logger });
    this.serviceContract.define('federation.remoteExecute', {
      version: '1.0.0',
      inputs: ['from', 'task'],
      outputs: ['success', 'result'],
      optional: ['requestedBy'],
    });
    this.serviceContract.define('federation.capabilityQuery', {
      version: '1.0.0',
      inputs: ['from', 'capability'],
      outputs: ['providers'],
      optional: ['filters'],
    });
    this.audit = [];
    this._onMessage = (msg) => this._route(msg);
    if (this.mesh) this.mesh.on('message', this._onMessage);
  }

  _route(msg) {
    switch (msg.type) {
      case 'remote_execute':
        this._receiveRemoteExecute(msg);
        break;
      case 'capability_query':
        this._receiveCapabilityQuery(msg);
        break;
      case 'lifecycle_sync':
        this._receiveLifecycleSync(msg);
        break;
      case 'marketplace_sync':
        this._receiveMarketplaceSync(msg);
        break;
      case 'governance_event':
        this._receiveGovernanceEvent(msg);
        break;
      default:
        this.emit('unknown_message', msg);
    }
  }

  _audit(action, payload) {
    const record = { at: Date.now(), action, payload, nodeId: this.mesh ? this.mesh.identity.nodeId : 'local' };
    this.audit.push(record);
    if (this.lifecycle && typeof this.lifecycle.recordProposal === 'function') this.lifecycle.recordProposal(record);
    this.emit('audit', record);
  }

  executeRemote(nodeId, task) {
    if (this.policy) {
      const decision = this.policy.validateAction('remote_execute', { nodeId, task });
      if (!decision.allowed) return { success: false, error: decision.reason };
    }
    this._audit('execute_remote', { nodeId, task });
    if (this.mesh) this.mesh.send(nodeId, 'remote_execute', { task, requestedBy: this.mesh.identity.nodeId });
    return { success: true, sent: true, task };
  }

  _receiveRemoteExecute(msg) {
    const { task, requestedBy } = msg.payload || {};
    if (!task) return;
    if (this.taskManager) {
      this.taskManager.advertise(task, { requestedBy });
    }
    this._audit('remote_execute_received', { from: msg.from, task });
    this.emit('remote_execute', { from: msg.from, task });
  }

  lookupCapability(capabilityId, nodeId) {
    this._audit('capability_lookup', { capabilityId, nodeId });
    if (this.marketplace && typeof this.marketplace.search === 'function') {
      return { success: true, results: this.marketplace.search({ id: capabilityId }) };
    }
    if (this.mesh) this.mesh.send(nodeId, 'capability_query', { capabilityId });
    return { success: true, sent: true, capabilityId };
  }

  _receiveCapabilityQuery(msg) {
    const { capabilityId } = (msg && msg.payload) || {};
    const results = this.marketplace ? this.marketplace.search({ id: capabilityId }) : [];
    if (this.mesh) this.mesh.send(msg.from, 'capability_result', { capabilityId, results });
    this.emit('capability_result', { from: msg.from, capabilityId, results });
  }

  syncLifecycle(targetNodeId) {
    const components = this.lifecycle && typeof this.lifecycle.list === 'function' ? this.lifecycle.list() : [];
    this._audit('sync_lifecycle', { target: targetNodeId, components: components.length });
    if (this.mesh) this.mesh.send(targetNodeId, 'lifecycle_sync', { components });
    return { success: true, sent: true };
  }

  _receiveLifecycleSync(msg) {
    const { components } = (msg && msg.payload) || {};
    this.emit('lifecycle_sync', { from: msg.from, components });
    this._audit('lifecycle_sync_received', { from: msg.from, components: (components || []).length });
  }

  syncMarketplace(targetNodeId) {
    const installed = this.marketplace && typeof this.marketplace.listInstalled === 'function'
      ? this.marketplace.listInstalled()
      : [];
    this._audit('sync_marketplace', { target: targetNodeId, installed: installed.length });
    if (this.mesh) this.mesh.send(targetNodeId, 'marketplace_sync', { installed });
    return { success: true, sent: true };
  }

  _receiveMarketplaceSync(msg) {
    const { installed } = (msg && msg.payload) || {};
    this.emit('marketplace_sync', { from: msg.from, installed });
    this._audit('marketplace_sync_received', { from: msg.from, installed: (installed || []).length });
  }

  emitGovernance(event) {
    this._audit('governance_event', event);
    if (this.observability && typeof this.observability.recordBusinessSignal === 'function') {
      this.observability.recordBusinessSignal({ type: 'federation_governance', payload: event });
    }
    if (this.mesh) this.mesh.broadcast('governance_event', event);
    return { success: true };
  }

  _receiveGovernanceEvent(msg) {
    this.emit('governance_event', { from: msg.from, event: msg.payload });
    this._audit('governance_event_received', { from: msg.from, event: msg.payload });
  }

  getAudit(limit = 100) {
    return this.audit.slice(-limit);
  }
}

module.exports = FederationGateway;
