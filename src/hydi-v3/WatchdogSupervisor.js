'use strict';

const { EventEmitter } = require('events');

/**
 * WatchdogSupervisor monitors every registered agent for dead loops, blocked
 * promises, high memory usage, heartbeat timeout, and excessive retries.
 *
 * Emits:
 *   - agent_healthy({ agentId, status })
 *   - agent_warning({ agentId, status, issues })
 *   - agent_dead({ agentId, status, reason })
 *   - agent_recovered({ agentId, attempts })
 *   - agent_restart_failed({ agentId, reason })
 */
class WatchdogSupervisor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      checkIntervalMs: config.checkIntervalMs || 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs || 90000,
      maxMemoryRatio: config.maxMemoryRatio || 0.9,
      maxRetries: config.maxRetries || 5,
      maxRestarts: config.maxRestarts || 3,
      restartBackoffMs: config.restartBackoffMs || 5000,
      ...config,
    };

    this.agents = new Map();
    this.checkTimer = null;
    this._destroyed = false;
  }

  /**
   * Register an agent for supervision.
   * @param {string} agentId
   * @param {object} agent - must implement getStatus() and optionally start()/stop()/restart()
   * @param {object} metadata - optional agent metadata
   */
  registerAgent(agentId, agent, metadata = {}) {
    if (this._destroyed) return;
    this.agents.set(agentId, {
      agent,
      metadata,
      status: null,
      restartCount: 0,
      lastRestartAt: 0,
      issues: [],
      state: 'healthy',
    });
    this.emit('agent_registered', { agentId, metadata });
  }

  unregisterAgent(agentId) {
    this.agents.delete(agentId);
    this.emit('agent_unregistered', { agentId });
  }

  start() {
    if (this._destroyed) return;
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.checkAgents(), this.config.checkIntervalMs);
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
    this.agents.clear();
  }

  /**
   * Snapshot the watchdog's current view of all agents.
   */
  getStatus() {
    const status = { healthy: 0, warning: 0, dead: 0, agents: {} };
    for (const [id, entry] of this.agents) {
      if (entry.state === 'healthy') status.healthy++;
      else if (entry.state === 'warning') status.warning++;
      else status.dead++;
      status.agents[id] = {
        state: entry.state,
        issues: entry.issues,
        restartCount: entry.restartCount,
        lastStatusAt: entry.status?.timestamp || null,
      };
    }
    return status;
  }

  async checkAgents() {
    if (this._destroyed) return;

    const now = Date.now();
    for (const [agentId, entry] of this.agents) {
      const issues = [];
      let status = null;

      try {
        status = typeof entry.agent.getStatus === 'function'
          ? await entry.agent.getStatus()
          : null;
      } catch (err) {
        issues.push(`status_error: ${err.message}`);
      }

      entry.status = status;

      if (!status) {
        issues.push('no_status');
      } else {
        if (status.timestamp && now - status.timestamp > this.config.heartbeatTimeoutMs) {
          issues.push('heartbeat_timeout');
        }
        if (typeof status.memory === 'number' && status.memory > this.config.maxMemoryRatio) {
          issues.push('high_memory');
        }
        if (typeof status.cpu === 'number' && status.cpu > 0.95) {
          issues.push('high_cpu');
        }
        if (typeof status.queueDepth === 'number' && status.queueDepth > 1000) {
          issues.push('queue_backlog');
        }
        if (typeof status.activeLoopCount === 'number' && status.activeLoopCount > 50) {
          issues.push('dead_loop');
        }
        if (typeof status.retryCount === 'number' && status.retryCount > this.config.maxRetries) {
          issues.push('excessive_retries');
        }
        if (status.blockedPromise === true) {
          issues.push('blocked_promise');
        }
      }

      entry.issues = issues;

      const criticalIssues = ['heartbeat_timeout', 'dead_loop', 'blocked_promise', 'status_error', 'no_status'];
      const isCritical = issues.some((i) => criticalIssues.some((c) => i === c || i.startsWith(`${c}:`)));

      if (issues.length === 0) {
        entry.state = 'healthy';
        this.emit('agent_healthy', { agentId, status });
        continue;
      }

      if (issues.length > 0 && issues.length < 3 && !isCritical) {
        entry.state = 'warning';
        this.emit('agent_warning', { agentId, status, issues });
        continue;
      }

      entry.state = 'dead';
      this.emit('agent_dead', { agentId, status, issues, reason: issues.join(', ') });
      await this.attemptRecovery(agentId, entry, status);
    }
  }

  async attemptRecovery(agentId, entry, status) {
    if (entry.restartCount >= this.config.maxRestarts) {
      this.emit('agent_restart_failed', { agentId, reason: 'max_restarts_exceeded' });
      return;
    }

    const now = Date.now();
    const backoff = entry.restartCount === 0
      ? 0
      : Math.min(this.config.restartBackoffMs * Math.pow(2, entry.restartCount - 1), 60000);
    if (entry.restartCount > 0 && now - entry.lastRestartAt < backoff) {
      return;
    }

    entry.restartCount++;
    entry.lastRestartAt = now;

    try {
      const agent = entry.agent;
      if (typeof agent.stop === 'function') await agent.stop();
      if (typeof agent.start === 'function') await agent.start();
      entry.state = 'healthy';
      entry.issues = [];
      this.emit('agent_recovered', { agentId, attempts: entry.restartCount, status });
    } catch (err) {
      this.emit('agent_restart_failed', { agentId, reason: err.message, attempts: entry.restartCount });
    }
  }

  /**
   * Manually force a restart of an agent. Used by self-healing.
   */
  async restartAgent(agentId) {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    await this.attemptRecovery(agentId, entry, entry.status);
    return true;
  }
}

module.exports = WatchdogSupervisor;
