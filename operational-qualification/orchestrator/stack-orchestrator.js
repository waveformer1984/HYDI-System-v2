/**
 * Stack Orchestrator
 * Manages HYDI stack lifecycle (startup, shutdown, restart)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class StackOrchestrator {
  constructor(config) {
    this.config = config;
    this.services = new Map();
    this.startTime = null;
    this.shutdownTime = null;
  }

  /**
   * Start the complete HYDI stack
   */
  async start() {
    console.log('[Orchestrator] Starting HYDI stack...');
    this.startTime = Date.now();

    const startupOrder = this.determineStartupOrder();

    for (const service of startupOrder) {
      await this.startService(service);
      await this.waitForServiceHealth(service);
    }

    console.log('[Orchestrator] HYDI stack started successfully');
    return {
      status: 'started',
      startTime: this.startTime,
      services: Array.from(this.services.keys())
    };
  }

  /**
   * Stop the complete HYDI stack
   */
  async stop() {
    console.log('[Orchestrator] Stopping HYDI stack...');

    const shutdownOrder = this.determineShutdownOrder();

    for (const service of shutdownOrder) {
      await this.stopService(service);
    }

    this.shutdownTime = Date.now();
    const uptime = this.shutdownTime - this.startTime;

    console.log('[Orchestrator] HYDI stack stopped successfully');
    return {
      status: 'stopped',
      shutdownTime: this.shutdownTime,
      uptimeMs: uptime
    };
  }

  /**
   * Restart a specific service
   */
  async restartService(serviceName) {
    console.log(`[Orchestrator] Restarting service: ${serviceName}`);

    await this.stopService(serviceName);
    await this.startService(serviceName);
    await this.waitForServiceHealth(serviceName);

    console.log(`[Orchestrator] Service restarted: ${serviceName}`);
    return { status: 'restarted', service: serviceName };
  }

  /**
   * Get stack status
   */
  getStatus() {
    const services = {};
    this.services.forEach((process, name) => {
      services[name] = {
        pid: process.pid,
        running: !process.killed,
        startTime: process.startTime
      };
    });

    return {
      status: this.startTime && !this.shutdownTime ? 'running' : 'stopped',
      startTime: this.startTime,
      shutdownTime: this.shutdownTime,
      uptimeMs: this.startTime && !this.shutdownTime ? Date.now() - this.startTime : 0,
      services
    };
  }

  /**
   * Determine startup order based on dependencies
   */
  determineStartupOrder() {
    const manifest = this.loadManifest();
    const services = Object.keys(manifest.services);
    const order = [];
    const started = new Set();

    while (started.size < services.length) {
      let progress = false;

      for (const serviceName of services) {
        if (started.has(serviceName)) continue;

        const service = manifest.services[serviceName];
        const dependencies = service.dependencies || [];

        if (dependencies.every(dep => started.has(dep))) {
          order.push(serviceName);
          started.add(serviceName);
          progress = true;
        }
      }

      if (!progress) {
        throw new Error('Circular dependency detected in service manifest');
      }
    }

    return order;
  }

  /**
   * Determine shutdown order (reverse of startup)
   */
  determineShutdownOrder() {
    return this.determineStartupOrder().reverse();
  }

  /**
   * Start a single service
   */
  async startService(serviceName) {
    console.log(`[Orchestrator] Starting service: ${serviceName}`);

    const manifest = this.loadManifest();
    const service = manifest.services[serviceName];

    if (!service) {
      throw new Error(`Service not found in manifest: ${serviceName}`);
    }

    const process = spawn(service.cmd, {
      cwd: service.cwd || process.cwd(),
      env: { ...process.env, ...service.env },
      shell: true
    });

    process.startTime = Date.now();

    process.stdout.on('data', (data) => {
      console.log(`[${serviceName}] ${data.toString().trim()}`);
    });

    process.stderr.on('data', (data) => {
      console.error(`[${serviceName}] ${data.toString().trim()}`);
    });

    process.on('error', (error) => {
      console.error(`[Orchestrator] Service error: ${serviceName}`, error);
    });

    process.on('exit', (code, signal) => {
      console.log(`[Orchestrator] Service exited: ${serviceName} (code: ${code}, signal: ${signal})`);
      this.services.delete(serviceName);
    });

    this.services.set(serviceName, process);
    console.log(`[Orchestrator] Service started: ${serviceName} (PID: ${process.pid})`);
  }

  /**
   * Stop a single service
   */
  async stopService(serviceName) {
    console.log(`[Orchestrator] Stopping service: ${serviceName}`);

    const process = this.services.get(serviceName);

    if (!process) {
      console.log(`[Orchestrator] Service not running: ${serviceName}`);
      return;
    }

    process.kill('SIGTERM');

    // Wait for graceful shutdown
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!process.killed) {
          console.log(`[Orchestrator] Force killing service: ${serviceName}`);
          process.kill('SIGKILL');
        }
        resolve();
      }, 30000); // 30 second timeout

      process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.services.delete(serviceName);
    console.log(`[Orchestrator] Service stopped: ${serviceName}`);
  }

  /**
   * Wait for service to become healthy
   */
  async waitForServiceHealth(serviceName) {
    console.log(`[Orchestrator] Waiting for service health: ${serviceName}`);

    const manifest = this.loadManifest();
    const service = manifest.services[serviceName];
    const healthCheck = service.healthCheck;

    if (!healthCheck) {
      console.log(`[Orchestrator] No health check for: ${serviceName}`);
      return;
    }

    const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max
    const attemptInterval = 2000; // 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const healthy = await this.checkHealth(healthCheck);
        if (healthy) {
          console.log(`[Orchestrator] Service healthy: ${serviceName}`);
          return;
        }
      } catch (error) {
        console.log(`[Orchestrator] Health check failed (attempt ${i + 1}/${maxAttempts}): ${serviceName}`);
      }

      await new Promise(resolve => setTimeout(resolve, attemptInterval));
    }

    throw new Error(`Service failed to become healthy: ${serviceName}`);
  }

  /**
   * Check service health
   */
  async checkHealth(healthCheckUrl) {
    const fetch = require('node-fetch');
    const response = await fetch(healthCheckUrl);
    return response.ok;
  }

  /**
   * Load services manifest
   */
  loadManifest() {
    const manifestPath = path.join(process.cwd(), 'services-manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(manifestContent);
  }
}

module.exports = StackOrchestrator;
