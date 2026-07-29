'use strict';

const { EventEmitter } = require('events');
const NodeHeartbeat = require('./NodeHeartbeat');
const NodeScheduler = require('./NodeScheduler');

/**
 * NodeMesh composes transport, discovery, scheduling and health monitoring.
 * It is the only component that knows both the network layer and the
 * in-process DistributedCompute layer.
 */
class NodeMesh extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity;
    this.transport = config.transport;
    this.discovery = config.discovery || null;
    this.compute = config.compute || null;
    this.scheduler = config.scheduler || null;
    this.heartbeat = config.heartbeat || null;
    this.policy = config.policy || null;
    this.observability = config.observability || null;
    this.logger = config.logger || console;
    this.peers = new Map();
    this._onTransportMessage = (msg) => this._handleMessage(msg);
    this._onTransportPeer = (e) => this.emit('peer_connected', e);
    this._onTransportPeerDisconnect = (e) => this.emit('peer_disconnected', e);
    this._onDiscoveryCandidate = (c) => this.emit('candidate', c);
  }

  async start() {
    if (this.transport) {
      this.transport.on('message', this._onTransportMessage);
      this.transport.on('peer_connected', this._onTransportPeer);
      this.transport.on('peer_disconnected', this._onTransportPeerDisconnect);
      await this.transport.start();
    }
    if (this.discovery) {
      this.discovery.on('candidate', this._onDiscoveryCandidate);
      this.discovery.start();
    }
    if (this.compute) this.compute.start();
    if (!this.scheduler && this.compute) this.scheduler = new NodeScheduler({ compute: this.compute, policy: this.policy });
    if (!this.heartbeat && this.transport) {
      this.heartbeat = new NodeHeartbeat({ transport: this.transport });
    }
    if (this.heartbeat) this.heartbeat.start();
    this.emit('started');
    return this;
  }

  async stop() {
    if (this.heartbeat) this.heartbeat.stop();
    if (this.transport) {
      this.transport.off('message', this._onTransportMessage);
      this.transport.off('peer_connected', this._onTransportPeer);
      this.transport.off('peer_disconnected', this._onTransportPeerDisconnect);
      await this.transport.stop();
    }
    if (this.discovery) {
      this.discovery.off('candidate', this._onDiscoveryCandidate);
      this.discovery.stop();
    }
    if (this.compute) this.compute.stop();
    this.emit('stopped');
    return this;
  }

  async connect(nodeId, publicKey, address, nodeInfo = {}) {
    if (!this.transport) return { success: false, error: 'no_transport' };
    const peer = { nodeId, publicKey, address, ...nodeInfo, connectedAt: Date.now() };
    this.peers.set(nodeId, peer);
    await this.transport.connect(nodeId, publicKey, address);
    if (this.compute) {
      this.compute.registerNode({
        id: nodeId,
        cpu: nodeInfo.cpu || 1,
        ram: nodeInfo.ram || 1,
        gpu: nodeInfo.gpu || false,
        disk: nodeInfo.disk || 0,
        capabilities: nodeInfo.capabilities || [],
        latency: nodeInfo.latency || 0,
        workload: nodeInfo.workload || 0,
      });
    }
    this.emit('node_joined', { nodeId, peer });
    return { success: true, peer };
  }

  disconnect(nodeId) {
    const peer = this.peers.get(nodeId);
    if (!peer) return false;
    this.peers.delete(nodeId);
    if (this.transport) this.transport.disconnect(nodeId);
    if (this.compute) this.compute.deregisterNode(nodeId);
    this.emit('node_left', { nodeId });
    return true;
  }

  send(nodeId, type, payload) {
    if (!this.transport) return { success: false, error: 'no_transport' };
    return this.transport.send(nodeId, type, payload);
  }

  broadcast(type, payload) {
    if (!this.transport) return { success: false, error: 'no_transport' };
    return this.transport.broadcast(type, payload);
  }

  schedule(task, options = {}) {
    if (!this.scheduler) return { success: false, error: 'no_scheduler' };
    const result = this.scheduler.schedule(task, options);
    this.emit('work_assigned', result);
    return result;
  }

  _handleMessage(msg) {
    if (!msg || !msg.from) return;
    switch (msg.type) {
      case 'heartbeat':
        this._handleHeartbeat(msg);
        break;
      case 'capability_advert':
        this._handleCapabilityAdvert(msg);
        break;
      case 'task_advert':
      case 'task_result':
      case 'task_cancel':
        this.emit(msg.type, msg);
        break;
      default:
        this.emit('message', msg);
    }
  }

  _handleHeartbeat(msg) {
    if (this.compute) this.compute.heartbeat(msg.from, msg.payload);
    const healthy = this.heartbeat ? this.heartbeat.isAlive(msg.from) : true;
    if (!healthy) {
      this.emit('node_failed', { nodeId: msg.from });
    }
  }

  _handleCapabilityAdvert(msg) {
    const node = this.compute ? this.compute.getNode(msg.from) : null;
    if (node && msg.payload && msg.payload.capabilities) {
      node.capabilities = msg.payload.capabilities;
      node.gpu = msg.payload.gpu || node.gpu;
      node.ram = msg.payload.ram || node.ram;
      node.cpu = msg.payload.cpu || node.cpu;
    }
    this.emit('capability_advert', { from: msg.from, payload: msg.payload });
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  getTopology() {
    const leader = this.compute ? this.compute.getLeader() : null;
    return {
      self: this.identity ? this.identity.nodeId : null,
      peers: this.getPeers(),
      leader: leader ? { id: leader.id, capabilityScore: leader.capabilityScore } : null,
    };
  }

  healthCheck() {
    const heartbeatHealth = this.heartbeat ? this.heartbeat.getPeerHealth() : {};
    const computeStatus = this.compute ? this.compute.getStatus() : {};
    return {
      peers: this.peers.size,
      heartbeatHealth,
      computeStatus,
    };
  }
}

module.exports = NodeMesh;
