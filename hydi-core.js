#!/usr/bin/env node
/**
 * HYDI Core
 * =========
 *
 * The autonomous operating system kernel for ProtoForge.
 * Coordinates memory, agents, orchestration, and learning.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { Agent, AgentRegistry } = require('./agent-framework');
const { TaskOrchestrator } = require('./task-orchestrator');

const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.hydi', 'logs');

// ============================================================================
// HYDI CORE
// ============================================================================

class HYDICore {
  constructor() {
    this.status = 'INITIALIZING';
    this.startTime = Date.now();
    this.agentRegistry = new AgentRegistry();
    this.taskOrchestrator = new TaskOrchestrator(this.agentRegistry);
    this.logger = this.createLogger();

    // Metrics
    this.metrics = {
      tasksExecuted: 0,
      agentsActive: 0,
      memoryUsage: 0,
      uptime: 0,
    };
  }

  createLogger() {
    return {
      info: (msg, data = {}) => this._log('INFO', msg, data),
      warn: (msg, data = {}) => this._log('WARN', msg, data),
      error: (msg, data = {}) => this._log('ERROR', msg, data),
    };
  }

  _log(level, message, data) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, component: 'hydi-core', message, ...data };
    console.log(`[${timestamp}] [${level}] [HYDI] ${message}`);

    const logFile = path.join(LOG_DIR, 'hydi-core.log');
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  }

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  async initialize() {
    this.logger.info('=== HYDI GENESIS v3 INITIALIZING ===');

    try {
      // Wait for dependencies
      await this.waitForDependencies();

      // Load agents
      await this.loadAgents();

      // Initialize agents
      await this.agentRegistry.initializeAll();

      this.status = 'RUNNING';
      this.logger.info('HYDI Core operational');
      this.logger.info(`Agents loaded: ${this.agentRegistry.agents.size}`);
    } catch (error) {
      this.logger.error('Failed to initialize HYDI', { error: error.message });
      throw error;
    }
  }

  async waitForDependencies() {
    this.logger.info('Waiting for dependencies...');

    const checks = [
      { name: 'Memory Engine', url: 'http://localhost:9998/health' },
      { name: 'Supervisor', url: 'http://localhost:9999/health' },
    ];

    for (const check of checks) {
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const response = await fetch(check.url);
          if (response.ok) {
            this.logger.info(`✓ ${check.name} ready`);
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!ready) {
        throw new Error(`${check.name} failed to start`);
      }
    }
  }

  async loadAgents() {
    this.logger.info('Loading agents...');

    // Load specialized agents
    let OperationsAgent;
    try {
      OperationsAgent = require('./agents/operations-agent');
    } catch (e) {
      this.logger.warn('Operations Agent not yet implemented, using base Agent');
      OperationsAgent = Agent;
    }

    // Create agent instances
    const agents = [
      new OperationsAgent(),

      new Agent({
        id: 'eng-agent',
        name: 'Engineering Agent',
        type: 'engineering',
        capabilities: ['code-review', 'testing', 'ci-cd', 'deployment'],
        dependencies: ['memory-engine'],
      }),

      new Agent({
        id: 'biz-agent',
        name: 'Business Agent',
        type: 'business',
        capabilities: ['crm', 'proposals', 'revenue-tracking', 'lead-scoring'],
        dependencies: ['memory-engine'],
      }),

      new Agent({
        id: 'res-agent',
        name: 'Research Agent',
        type: 'research',
        capabilities: ['grant-discovery', 'tech-monitoring', 'patent-search'],
        dependencies: ['memory-engine'],
      }),

      new Agent({
        id: 'studio-agent',
        name: 'Studio Agent',
        type: 'studio',
        capabilities: ['music-generation', 'midi-creation', 'sample-management'],
        dependencies: ['memory-engine'],
      }),

      new Agent({
        id: 'fab-agent',
        name: 'Fabrication Agent',
        type: 'fabrication',
        capabilities: ['cad-design', 'slicing', 'print-management', 'inventory'],
        dependencies: ['memory-engine'],
      }),
    ];

    for (const agent of agents) {
      this.agentRegistry.register(agent);
    }
  }

  // ========================================================================
  // TASK EXECUTION
  // ========================================================================

  async executeTask(taskDef) {
    this.metrics.tasksExecuted++;
    return this.taskOrchestrator.execute(taskDef);
  }

  // ========================================================================
  // CONTINUOUS OPERATIONS
  // ========================================================================

  async runContinuousOperations() {
    this.logger.info('Starting continuous operations loop');

    // Every 30 seconds: health check all agents
    setInterval(async () => {
      const health = await this.agentRegistry.healthCheckAll();
      const upAgents = Object.values(health).filter((h) => h).length;
      this.metrics.agentsActive = upAgents;

      if (upAgents < this.agentRegistry.agents.size) {
        this.logger.warn(`Agent health degraded: ${upAgents}/${this.agentRegistry.agents.size}`);
      }
    }, 30000);

    // Every 60 seconds: update metrics
    setInterval(() => {
      this.metrics.uptime = Date.now() - this.startTime;
      this.metrics.memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    }, 60000);

    // Every 24 hours: run maintenance
    setInterval(async () => {
      this.logger.info('Running daily maintenance...');
      // Archive old logs
      // Clean up expired cache
      // Verify backups
      // Optimize database
    }, 86400000);
  }

  // ========================================================================
  // STATUS & METRICS
  // ========================================================================

  getStatus() {
    return {
      status: this.status,
      uptime: Date.now() - this.startTime,
      agents: this.agentRegistry.getStatus(),
      tasks: this.taskOrchestrator.getStatus(),
      metrics: this.metrics,
      timestamp: new Date().toISOString(),
    };
  }

  // ========================================================================
  // GRACEFUL SHUTDOWN
  // ========================================================================

  async shutdown() {
    this.logger.info('HYDI shutting down gracefully...');
    this.status = 'STOPPING';

    await this.agentRegistry.shutdownAll();

    this.status = 'STOPPED';
    this.logger.info('HYDI shutdown complete');
  }
}

// ============================================================================
// HTTP INTERFACE
// ============================================================================

async function startServer(port = 9997) {
  const hydi = new HYDICore();

  await hydi.initialize();
  hydi.runContinuousOperations();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (url.pathname === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: hydi.status }));
      } else if (url.pathname === '/status') {
        res.writeHead(200);
        res.end(JSON.stringify(hydi.getStatus()));
      } else if (url.pathname === '/execute-task' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          const taskDef = JSON.parse(body);
          const result = await hydi.executeTask(taskDef);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
      } else if (url.pathname === '/agents') {
        res.writeHead(200);
        res.end(JSON.stringify(hydi.agentRegistry.getStatus()));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║  HYDI GENESIS v3 — AUTONOMOUS OS FOR PROTOFORGE               ║`);
    console.log(`╠════════════════════════════════════════════════════════════════╣`);
    console.log(`║  Status endpoint: http://localhost:${port}/status              ║`);
    console.log(`║  Agents: http://localhost:${port}/agents                   ║`);
    console.log(`║  Execute task: POST http://localhost:${port}/execute-task   ║`);
    console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => hydi.shutdown());
  process.on('SIGINT', () => hydi.shutdown());

  return { hydi, server };
}

// ============================================================================
// MAIN
// ============================================================================

if (require.main === module) {
  startServer(9997).catch((error) => {
    console.error('HYDI failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = { HYDICore, startServer };
