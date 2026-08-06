/**
 * Stack Orchestrator
 * Manages HYDI stack lifecycle (startup, shutdown, restart)
 */

const { spawn, execSync } = require('child_process');
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
    this.services.forEach((child, name) => {
      services[name] = {
        pid: child.pid,
        running: !child.killed,
        startTime: child.startTime
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
   * Kill any process listening on the given port, ignoring errors.
   * This prevents EADDRINUSE from a stale service from a previous run.
   */
  killPortListeners(port) {
    if (!port) return;
    try {
      const script = `try { $conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop; foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } } catch { } ; exit 0`;
      execSync(`pwsh -NoProfile -Command "${script}"`, { stdio: 'ignore', timeout: 10000 });
      console.log(`[Orchestrator] Cleared listeners on port ${port}`);
    } catch (error) {
      console.warn(`[Orchestrator] Could not clear listeners on port ${port}:`, error.message);
    }
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

    // Pre-empt any stale listener on the configured port before we check health
    // or attempt to bind. Without this, a leftover process (e.g. a previous
    // `next dev`) keeps the port and the newly spawned service exits with
    // EADDRINUSE, while the health check passes against the stale instance.
    this.killPortListeners(service.port);

    // Stale-instance guard: if the service's health endpoint already answers
    // BEFORE we spawn it, a leftover instance (e.g. a `next dev` from an
    // earlier session) is squatting on the port. The spawn below will fail or
    // idle with EADDRINUSE, waitForServiceHealth will then "pass" against the
    // stale process, and every workload runs against code/env we did not
    // launch — the harness-generated HYDI_SERVICE_SECRET in particular will
    // not match, producing blanket 401s on authenticated routes. Warn loudly;
    // qualification results in this state are not evidence about HEAD.
    if (service.healthCheck) {
      try {
        const alreadyUp = await this.checkHealth(service.healthCheck);
        if (alreadyUp) {
          console.warn(
            `[Orchestrator] WARNING: ${serviceName} already answers at ` +
            `${service.healthCheck} before spawn. A stale instance is likely ` +
            `running with a different environment (secrets, code version). ` +
            `Kill it and re-run, or this qualification is not valid evidence.`
          );
        }
      } catch (_) { /* not answering — expected */ }
    }

    // NOTE: this local must not be named `process`. Doing so shadows the
    // global `process` for the whole function scope, and the `process.cwd()` /
    // `process.env` references in this very initialiser then hit the temporal
    // dead zone, throwing "Cannot access 'process' before initialization" on
    // every call. That defect made the entire harness unrunnable.
    const child = spawn(service.cmd, {
      cwd: service.cwd || process.cwd(),
      // HYDI_REQUIRE_SUPERVISOR=false: this harness orchestrates services
      // itself — there is no supervisor.js in the loop, so services must not
      // hard-block on its /status endpoint (see hydi-core.waitForDependencies).
      env: { ...process.env, HYDI_REQUIRE_SUPERVISOR: 'false', ...service.env },
      shell: true
    });

    child.startTime = Date.now();

    child.stdout.on('data', (data) => {
      console.log(`[${serviceName}] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[${serviceName}] ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      console.error(`[Orchestrator] Service error: ${serviceName}`, error);
    });

    child.on('exit', (code, signal) => {
      console.log(`[Orchestrator] Service exited: ${serviceName} (code: ${code}, signal: ${signal})`);
      this.services.delete(serviceName);
    });

    this.services.set(serviceName, child);
    console.log(`[Orchestrator] Service started: ${serviceName} (PID: ${child.pid})`);
  }

  /**
   * Stop a single service
   */
  async stopService(serviceName) {
    console.log(`[Orchestrator] Stopping service: ${serviceName}`);

    const child = this.services.get(serviceName);

    if (!child) {
      console.log(`[Orchestrator] Service not running: ${serviceName}`);
      return;
    }

    child.kill('SIGTERM');

    // Wait for graceful shutdown
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          console.log(`[Orchestrator] Force killing service: ${serviceName}`);
          child.kill('SIGKILL');
        }
        resolve();
      }, this.config?.stack?.shutdownTimeout || 30000);

      child.on('exit', () => {
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

    const maxAttempts = this.config?.stack?.healthCheckMaxAttempts || 30;
    const attemptInterval = this.config?.stack?.healthCheckInterval || 2000;

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

    if (service && service.required === false) {
      console.warn(`[Orchestrator] Optional service not healthy, continuing: ${serviceName}`);
      return;
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
    // Resolved relative to the repo root, not process.cwd(), so the harness
    // behaves identically regardless of where it is invoked from.
    if (this._manifest) return this._manifest;
    const manifestPath = path.join(__dirname, '..', '..', 'services-manifest.json');
    this._manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return this._manifest;
  }
}

module.exports = StackOrchestrator;
