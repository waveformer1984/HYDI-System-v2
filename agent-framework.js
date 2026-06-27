#!/usr/bin/env node
/**
 * HYDI Agent Framework
 * ====================
 *
 * Defines the base Agent class and agent lifecycle.
 * All agents inherit from this and implement specialized behaviors.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.hydi', 'logs');

// ============================================================================
// BASE AGENT CLASS
// ============================================================================

class Agent {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type; // 'operations', 'engineering', 'business', 'research', 'studio', 'fabrication'
    this.capabilities = config.capabilities || [];
    this.dependencies = config.dependencies || [];
    this.status = 'INITIALIZING';
    this.lastHealthCheck = null;
    this.tasksCompleted = 0;
    this.tasksFailure = 0;
    this.averageTaskDuration = 0;

    this.logger = this.createLogger();
  }

  createLogger() {
    return {
      info: (msg, data = {}) => this._log('INFO', msg, data),
      warn: (msg, data = {}) => this._log('WARN', msg, data),
      error: (msg, data = {}) => this._log('ERROR', msg, data),
      debug: (msg, data = {}) => this._log('DEBUG', msg, data),
    };
  }

  _log(level, message, data) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, agent: this.id, message, ...data };
    console.log(`[${timestamp}] [${level}] [${this.id}] ${message}`);

    const logFile = path.join(LOG_DIR, `agent-${this.id}.log`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  }

  // ========================================================================
  // LIFECYCLE
  // ========================================================================

  async initialize() {
    this.logger.info(`Initializing ${this.name}`);
    this.status = 'READY';
  }

  async healthCheck() {
    this.lastHealthCheck = Date.now();
    return this.status === 'READY';
  }

  async shutdown() {
    this.logger.info('Shutting down gracefully');
    this.status = 'STOPPED';
  }

  // ========================================================================
  // TASK EXECUTION
  // ========================================================================

  async execute(task) {
    const startTime = Date.now();

    try {
      this.logger.info(`Executing task: ${task.id}`, { type: task.type });

      // Validate task
      if (!this.canExecute(task)) {
        throw new Error(`Agent cannot execute task type: ${task.type}`);
      }

      // Execute the actual task
      const result = await this.performTask(task);

      const duration = Date.now() - startTime;
      this.tasksCompleted++;
      this.averageTaskDuration =
        (this.averageTaskDuration * (this.tasksCompleted - 1) + duration) / this.tasksCompleted;

      this.logger.info(`Task completed: ${task.id}`, {
        duration,
        averageTaskDuration: this.averageTaskDuration,
      });

      return {
        success: true,
        taskId: task.id,
        result,
        duration,
        agent: this.id,
      };
    } catch (error) {
      this.tasksFailure++;
      this.logger.error(`Task failed: ${task.id}`, { error: error.message });

      return {
        success: false,
        taskId: task.id,
        error: error.message,
        agent: this.id,
      };
    }
  }

  // Override these in subclasses
  canExecute(task) {
    return this.capabilities.includes(task.type);
  }

  async performTask(task) {
    throw new Error('performTask must be implemented by subclass');
  }

  // ========================================================================
  // LEARNING
  // ========================================================================

  async recordSuccess(task, result) {
    this.logger.info(`Recording success for task: ${task.id}`);

    // Call memory engine to update procedural workflows
    try {
      const response = await fetch('http://localhost:9998/update-confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          agent: this.id,
          success: true,
          duration: Date.now() - task.startTime,
          result,
        }),
      });

      if (!response.ok) {
        this.logger.warn('Failed to record success in memory');
      }
    } catch (e) {
      this.logger.warn('Memory engine unavailable', { error: e.message });
    }
  }

  async recordFailure(task, error) {
    this.logger.info(`Recording failure for task: ${task.id}`);

    try {
      await fetch('http://localhost:9998/update-confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          agent: this.id,
          success: false,
          error: error.message,
        }),
      });
    } catch (e) {
      this.logger.warn('Memory engine unavailable', { error: e.message });
    }
  }

  // ========================================================================
  // STATUS
  // ========================================================================

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      tasksCompleted: this.tasksCompleted,
      tasksFailure: this.tasksFailure,
      successRate: this.tasksCompleted / (this.tasksCompleted + this.tasksFailure) || 0,
      averageTaskDuration: Math.round(this.averageTaskDuration),
      lastHealthCheck: this.lastHealthCheck,
    };
  }
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

class AgentRegistry {
  constructor() {
    this.agents = new Map();
  }

  register(agent) {
    this.agents.set(agent.id, agent);
    console.log(`[Agent Registry] Registered: ${agent.name}`);
  }

  get(agentId) {
    return this.agents.get(agentId);
  }

  getByType(type) {
    return Array.from(this.agents.values()).filter((a) => a.type === type);
  }

  getByCapability(capability) {
    return Array.from(this.agents.values()).filter((a) => a.capabilities.includes(capability));
  }

  async initializeAll() {
    console.log('[Agent Registry] Initializing all agents...');
    for (const agent of this.agents.values()) {
      await agent.initialize();
    }
  }

  async healthCheckAll() {
    const results = {};
    for (const agent of this.agents.values()) {
      results[agent.id] = await agent.healthCheck();
    }
    return results;
  }

  getStatus() {
    const statuses = {};
    for (const [id, agent] of this.agents) {
      statuses[id] = agent.getStatus();
    }
    return statuses;
  }

  async shutdownAll() {
    console.log('[Agent Registry] Shutting down all agents...');
    for (const agent of this.agents.values()) {
      await agent.shutdown();
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  Agent,
  AgentRegistry,
};
