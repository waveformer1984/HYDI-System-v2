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
    this.leaderId = null;
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
      registeredAt: node.registeredAt || Date.now(),
      status: 'active',
      ...node,
    };
    record.capabilityScore = this.computeCapabilityScore(record);
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

  computeCapabilityScore(node) {
    const cpu = node.cpu || 0;
    const ram = node.ram || 0;
    const disk = node.disk || 0;
    const gpu = node.gpu ? 1 : 0;
    const caps = Array.isArray(node.capabilities) ? node.capabilities.length : 0;
    return cpu + ram + disk + gpu + caps * 0.5;
  }

  electLeader() {
    const active = this.getNodes().filter((n) => n.status === 'active');
    if (active.length === 0) {
      this.leaderId = null;
      return null;
    }

    active.sort((a, b) => {
      const scoreA = a.capabilityScore || this.computeCapabilityScore(a);
      const scoreB = b.capabilityScore || this.computeCapabilityScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const ageA = a.registeredAt || 0;
      const ageB = b.registeredAt || 0;
      if (ageA !== ageB) return ageA - ageB;
      return a.id.localeCompare(b.id);
    });

    this.leaderId = active[0].id;
    return active[0];
  }

  getLeader() {
    const leader = this.nodes.get(this.leaderId);
    if (!leader || leader.status !== 'active') return this.electLeader();
    return leader;
  }

  getLoadReport() {
    const nodes = this.getNodes();
    const totalWorkload = nodes.reduce((sum, n) => sum + (n.workload || 0), 0);
    const average = nodes.length > 0 ? totalWorkload / nodes.length : 0;
    return {
      totalNodes: nodes.length,
      activeNodes: nodes.filter((n) => n.status === 'active').length,
      totalWorkload,
      averageWorkload: average,
      nodes: nodes.map((n) => ({
        id: n.id,
        workload: n.workload,
        status: n.status,
        capabilityScore: n.capabilityScore || this.computeCapabilityScore(n),
      })),
    };
  }

  migrateMission(missionId, fromNodeId, toNodeId) {
    const assignment = this.workAssignments.get(missionId);
    if (!assignment || assignment.nodeId !== fromNodeId) return false;
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode || toNode.status !== 'active') return false;

    assignment.nodeId = toNodeId;
    fromNode.workload -= 1;
    toNode.workload += 1;
    this.emit('work_migrated', { missionId, from: fromNodeId, to: toNodeId });
    return true;
  }

  workStealing() {
    const active = this.getNodes().filter((n) => n.status === 'active');
    if (active.length < 2) return null;

    active.sort((a, b) => a.workload - b.workload);
    const idle = active[0];
    const overloaded = active[active.length - 1];

    if (overloaded.workload <= idle.workload || overloaded.workload === 0) return null;

    for (const [taskId, assignment] of this.workAssignments) {
      if (assignment.nodeId === overloaded.id) {
        assignment.nodeId = idle.id;
        overloaded.workload -= 1;
        idle.workload += 1;
        this.emit('work_stolen', { taskId, from: overloaded.id, to: idle.id });
        return { taskId, from: overloaded.id, to: idle.id };
      }
    }

    return null;
  }

  rebalance() {
    const active = this.getNodes().filter((n) => n.status === 'active');
    if (active.length === 0 || this.workAssignments.size === 0) return { moved: 0 };

    const total = this.workAssignments.size;
    const totalScore = active.reduce((sum, n) => sum + (n.capabilityScore || this.computeCapabilityScore(n)), 0);
    if (totalScore <= 0) return { moved: 0 };

    const targets = active
      .map((n) => ({
        node: n,
        target: Math.floor(total * (n.capabilityScore || this.computeCapabilityScore(n)) / totalScore),
        current: n.workload,
      }))
      .sort((a, b) => (b.node.capabilityScore || this.computeCapabilityScore(b.node)) - (a.node.capabilityScore || this.computeCapabilityScore(a.node)));

    let distributed = targets.reduce((sum, t) => sum + t.target, 0);
    let remainder = total - distributed;
    for (const t of targets) {
      if (remainder <= 0) break;
      t.target += 1;
      remainder -= 1;
    }

    const sources = targets.filter((t) => t.current > t.target);
    const sinks = targets.filter((t) => t.current < t.target);
    let moved = 0;

    for (const sink of sinks) {
      while (sink.current < sink.target) {
        const source = sources.find((s) => s.current > s.target);
        if (!source) break;

        let migrated = false;
        for (const [taskId, assignment] of this.workAssignments) {
          if (assignment.nodeId === source.node.id) {
            assignment.nodeId = sink.node.id;
            source.current -= 1;
            sink.current += 1;
            source.node.workload -= 1;
            sink.node.workload += 1;
            moved += 1;
            migrated = true;
            this.emit('work_rebalanced', { taskId, from: source.node.id, to: sink.node.id });
            break;
          }
        }
        if (!migrated) break;
      }
    }

    return { moved };
  }

  autoDiscover() {
    const local = this.getLocalNode();
    const discovered = [];
    for (let i = 1; i <= 3; i += 1) {
      const node = {
        ...local,
        id: `local-node-${i}`,
        address: '127.0.0.1',
        capabilities: [...local.capabilities, 'local'],
        latency: 0,
        workload: 0,
        status: 'active',
        lastHeartbeat: Date.now(),
      };
      if (!this.nodes.has(node.id)) {
        this.registerNode(node);
        discovered.push(node.id);
      }
    }
    return discovered;
  }
}

module.exports = DistributedCompute;
