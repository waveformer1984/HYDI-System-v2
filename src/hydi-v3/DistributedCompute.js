'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

/**
 * DistributedCompute supports multiple execution nodes. Each node advertises
 * CPU, RAM, GPU, disk, capabilities, network latency, and workload.
 *
 * The scheduler assigns work automatically, handles node join/leave/failure,
 * and redistributes work.
 */
class DistributedCompute extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      heartbeatIntervalMs: config.heartbeatIntervalMs || 30000,
      nodeTimeoutMs: config.nodeTimeoutMs || 90000,
      defaultWeights: config.defaultWeights || { cpu: 0.3, ram: 0.3, latency: 0.2, workload: 0.2 },
      ...config,
    };

    this.nodes = new Map();
    this.workAssignments = new Map();
    this.checkTimer = null;
    this._destroyed = false;
  }

  start() {
    if (this._destroyed) return;
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.checkNodes(), this.config.heartbeatIntervalMs);
    if (this.checkTimer.unref) this.checkTimer.unref();
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.stop();
    this.nodes.clear();
    this.workAssignments.clear();
  }

  registerNode(node) {
    if (this._destroyed) return null;
    const nodeId = node.id || `node_${randomUUID()}`;
    const record = {
      id: nodeId,
      cpu: node.cpu || 0,
      ram: node.ram || 0,
      gpu: node.gpu || false,
      disk: node.disk || 0,
      capabilities: node.capabilities || [],
      latency: node.latency || 0,
      workload: node.workload || 0,
      lastHeartbeat: Date.now(),
      status: 'active',
      ...node,
    };
    this.nodes.set(nodeId, record);
    this.emit('node_joined', { nodeId, node: record });
    return nodeId;
  }

  heartbeat(nodeId, updates = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.lastHeartbeat = Date.now();
    node.status = 'active';
    node.workload = updates.workload !== undefined ? updates.workload : node.workload;
    node.latency = updates.latency !== undefined ? updates.latency : node.latency;
    node.cpu = updates.cpu !== undefined ? updates.cpu : node.cpu;
    node.ram = updates.ram !== undefined ? updates.ram : node.ram;
    this.emit('node_heartbeat', { nodeId, node });
    return true;
  }

  deregisterNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    this.nodes.delete(nodeId);
    this.emit('node_left', { nodeId });
    this.redistributeWork(nodeId);
    return true;
  }

  checkNodes() {
    if (this._destroyed) return;
    const now = Date.now();
    for (const [nodeId, node] of this.nodes) {
      if (now - node.lastHeartbeat > this.config.nodeTimeoutMs) {
        node.status = 'failed';
        this.emit('node_failed', { nodeId, node });
        this.redistributeWork(nodeId);
        this.nodes.delete(nodeId);
      }
    }
  }

  schedule(task, filter = {}) {
    const candidates = Array.from(this.nodes.values()).filter((n) => {
      if (n.status !== 'active') return false;
      if (filter.gpu && !n.gpu) return false;
      if (filter.minCPU && n.cpu < filter.minCPU) return false;
      if (filter.minRAM && n.ram < filter.minRAM) return false;
      if (filter.capability && !n.capabilities.includes(filter.capability)) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    const weights = this.config.defaultWeights;
    candidates.sort((a, b) => {
      const scoreA = this.scoreNode(a, weights);
      const scoreB = this.scoreNode(b, weights);
      return scoreB - scoreA;
    });

    const chosen = candidates[0];
    const assignment = { task, nodeId: chosen.id, assignedAt: Date.now() };
    this.workAssignments.set(task.id || randomUUID(), assignment);
    chosen.workload += 1;
    this.emit('work_assigned', assignment);
    return chosen.id;
  }

  scoreNode(node, weights) {
    const cpu = node.cpu || 0;
    const ram = node.ram || 0;
    const latency = node.latency || 0;
    const workload = node.workload || 0;
    return (
      cpu * weights.cpu +
      ram * weights.ram -
      latency * weights.latency -
      workload * weights.workload
    );
  }

  redistributeWork(failedNodeId) {
    const affected = [];
    for (const [taskId, assignment] of this.workAssignments) {
      if (assignment.nodeId === failedNodeId) {
        affected.push({ taskId, task: assignment.task });
      }
    }
    for (const { taskId, task } of affected) {
      this.workAssignments.delete(taskId);
      const newNode = this.schedule(task);
      this.emit('work_redistributed', { taskId, from: failedNodeId, to: newNode });
    }
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  getNodes() {
    return Array.from(this.nodes.values());
  }

  getStatus() {
    return {
      totalNodes: this.nodes.size,
      activeNodes: this.getNodes().filter((n) => n.status === 'active').length,
      failedNodes: this.getNodes().filter((n) => n.status === 'failed').length,
      assignments: this.workAssignments.size,
      nodes: this.getNodes(),
    };
  }

  getLocalNode() {
    return {
      id: 'local',
      cpu: 1,
      ram: 1,
      gpu: false,
      disk: 1,
      capabilities: ['general', 'cpu'],
      latency: 0,
      workload: 0,
      status: 'active',
      lastHeartbeat: Date.now(),
    };
  }
}

module.exports = DistributedCompute;
