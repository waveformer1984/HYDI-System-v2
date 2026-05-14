/**
 * ProtoForge Nexus — Unified Agent Coordination Layer
 *
 * Wires Heidi (agent), Ursula (monitor), and ProtoForge (orchestrator)
 * into a single coherent runtime. Each component registers here;
 * the Nexus routes messages, maintains system state, and exposes
 * a unified status API for the operator.
 *
 * Architecture:
 *   Agent registers → Nexus tracks liveness
 *   Agent emits event → Nexus routes to subscribers
 *   Operator queries → Nexus compiles brief from all agents
 */

const EventEmitter = require('events');

const AGENT_TIMEOUT_MS = 60_000; // agent considered stale after 60s silence

class ProtoForgeNexus extends EventEmitter {
  constructor(config = {}) {
    super();
    this.agents = new Map();      // name → AgentRecord
    this.messageLog = [];         // last N cross-agent messages
    this.maxLogSize = config.maxLogSize || 200;
    this.state = 'initializing';
    this._startTime = Date.now();
  }

  // ─── Agent Registration ───────────────────────────────────────────────────

  register(name, capabilities = [], meta = {}) {
    const existing = this.agents.get(name);
    const record = {
      name,
      capabilities: new Set(capabilities),
      status: 'online',
      lastSeen: Date.now(),
      registeredAt: existing?.registeredAt ?? Date.now(),
      meta,
      subscriptions: new Set(),
    };
    this.agents.set(name, record);
    this.emit('agent:registered', { name, capabilities });
    if (this.state === 'initializing' && this.agents.size >= 1) {
      this.state = 'running';
    }
    return record;
  }

  heartbeat(name) {
    const agent = this.agents.get(name);
    if (!agent) return false;
    agent.lastSeen = Date.now();
    agent.status = 'online';
    return true;
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  /**
   * Route a message from one agent to another (or broadcast with to='*').
   * Returns the message record.
   */
  send(from, to, action, payload = {}) {
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      from,
      to,
      action,
      payload,
    };

    this.messageLog.push(msg);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog.shift();
    }

    if (to === '*') {
      this.emit('broadcast', msg);
    } else {
      this.emit(`message:${to}`, msg);
    }
    this.emit('message', msg);

    return msg;
  }

  subscribe(agentName, eventPattern, handler) {
    const agent = this.agents.get(agentName);
    if (agent) agent.subscriptions.add(eventPattern);
    this.on(eventPattern, handler);
  }

  // ─── State Queries ────────────────────────────────────────────────────────

  getAgentStatus(name) {
    const agent = this.agents.get(name);
    if (!agent) return null;
    const staleness = Date.now() - agent.lastSeen;
    return {
      name: agent.name,
      status: staleness > AGENT_TIMEOUT_MS ? 'stale' : agent.status,
      lastSeenMs: staleness,
      capabilities: [...agent.capabilities],
      meta: agent.meta,
    };
  }

  getAllAgentStatuses() {
    return [...this.agents.keys()].map(n => this.getAgentStatus(n));
  }

  /**
   * Return a plain-English brief of the whole system for the operator.
   * Each registered agent can inject its own brief via nexus.send().
   */
  getSystemBrief(agentBriefs = {}) {
    const uptime = Math.floor((Date.now() - this._startTime) / 1000);
    const agentList = this.getAllAgentStatuses();
    const online = agentList.filter(a => a.status === 'online').map(a => a.name);
    const stale = agentList.filter(a => a.status === 'stale').map(a => a.name);

    const lines = [
      `ProtoForge Nexus — uptime ${uptime}s`,
      `Agents online: ${online.length ? online.join(', ') : 'none'}`,
      stale.length ? `Stale/offline: ${stale.join(', ')}` : null,
    ];

    for (const [agent, brief] of Object.entries(agentBriefs)) {
      if (brief) lines.push(`[${agent}] ${brief}`);
    }

    lines.push(`Recent messages: ${this.messageLog.length} in log`);
    return lines.filter(Boolean).join('\n');
  }

  getFullStatus() {
    return {
      nexusState: this.state,
      uptimeMs: Date.now() - this._startTime,
      agents: this.getAllAgentStatuses(),
      recentMessages: this.messageLog.slice(-20),
    };
  }
}

module.exports = new ProtoForgeNexus(); // singleton
module.exports.ProtoForgeNexus = ProtoForgeNexus;
