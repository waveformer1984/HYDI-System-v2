#!/usr/bin/env node
/**
 * HYDI System Process Supervisor
 * ===============================
 * Orchestrates startup, shutdown, and health monitoring of all HYDI services.
 *
 * Purpose:
 *   - Centralized port registry (prevents EADDRINUSE conflicts)
 *   - Dependency-aware startup (respects service dependencies)
 *   - Health checking (validates readiness before declaring service UP)
 *   - Automatic restart (exponential backoff for crashed services)
 *   - Graceful shutdown (coordinates SIGTERM across all processes)
 *   - Structured logging (journald-compatible JSON for all events)
 *
 * Usage:
 *   node supervisor.js                          (start all services)
 *   node supervisor.js --service next-app       (start only next-app)
 *   node supervisor.js --dry-run                (plan startup, don't launch)
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// ============================================================================
// GLOBAL CONFIG & STATE
// ============================================================================

const SUPERVISOR_VERSION = '1.0.0';
const PORT_REGISTRY_FILE = path.join(os.homedir(), '.hydi', 'port-registry.json');
const MANIFEST_FILE = path.join(__dirname, 'services-manifest.json');
const LOG_DIR = path.join(os.homedir(), '.hydi', 'logs');
const HEALTH_CHECK_INTERVAL = 30000; // 30s
const STARTUP_TIMEOUT = 60000; // 60s per service
const SIGNAL_TIMEOUT = 10000; // 10s for graceful shutdown

let services = {};
let portRegistry = {};
let supervisor = {
  startTime: Date.now(),
  state: 'STARTING',
  processes: {},
  health: {},
  crashes: {}, // {serviceName: [timestamp, timestamp, ...]}
};

// ============================================================================
// LOGGING
// ============================================================================

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(level, serviceName, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    service: serviceName || 'supervisor',
    message,
    ...meta,
  };

  // Console output
  const levelColor = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  }[level] || '';
  const reset = '\x1b[0m';

  console.log(`${levelColor}[${timestamp}] [${level}] [${serviceName || 'supervisor'}] ${message}${reset}`);

  // File logging (journald format)
  const logFile = path.join(LOG_DIR, `${serviceName || 'supervisor'}.log`);
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// ============================================================================
// PORT MANAGEMENT
// ============================================================================

function loadPortRegistry() {
  ensureLogDir();
  try {
    if (fs.existsSync(PORT_REGISTRY_FILE)) {
      portRegistry = JSON.parse(fs.readFileSync(PORT_REGISTRY_FILE, 'utf8'));
      log('INFO', 'supervisor', `Loaded port registry: ${Object.keys(portRegistry).join(', ')}`);
    }
  } catch (e) {
    log('WARN', 'supervisor', `Could not load port registry: ${e.message}`);
    portRegistry = {};
  }
}

function savePortRegistry() {
  const dir = path.dirname(PORT_REGISTRY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PORT_REGISTRY_FILE, JSON.stringify(portRegistry, null, 2));
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(false);
      else resolve(true); // Other errors, assume port available
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function reservePort(serviceName, port) {
  const available = await isPortAvailable(port);
  if (!available) {
    log('ERROR', serviceName, `Port ${port} is in use`);
    return false;
  }
  portRegistry[serviceName] = { port, reserved: new Date().toISOString() };
  savePortRegistry();
  log('SUCCESS', serviceName, `Reserved port ${port}`);
  return true;
}

function releasePort(serviceName) {
  delete portRegistry[serviceName];
  savePortRegistry();
}

// ============================================================================
// SERVICE MANIFEST MANAGEMENT
// ============================================================================

function loadManifest() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    services = manifest.services || {};
    log('INFO', 'supervisor', `Loaded manifest: ${Object.keys(services).length} services`);
    return true;
  } catch (e) {
    log('ERROR', 'supervisor', `Could not load manifest: ${e.message}`);
    return false;
  }
}

function validateManifest() {
  const required = ['cmd', 'cwd', 'port', 'healthCheck', 'dependencies'];
  for (const [name, svc] of Object.entries(services)) {
    for (const field of required) {
      if (!(field in svc)) {
        log('ERROR', 'supervisor', `Service ${name} missing required field: ${field}`);
        return false;
      }
    }
  }
  log('INFO', 'supervisor', 'Manifest validation passed');
  return true;
}

// ============================================================================
// DEPENDENCY RESOLUTION (Topological Sort)
// ============================================================================

function resolveDependencies(serviceName) {
  const resolved = [];
  const visiting = new Set();

  function visit(name) {
    if (resolved.includes(name)) return;
    if (visiting.has(name)) {
      log('ERROR', 'supervisor', `Circular dependency detected: ${name}`);
      throw new Error(`Circular dependency: ${name}`);
    }

    visiting.add(name);
    const svc = services[name];
    if (svc && svc.dependencies) {
      for (const dep of svc.dependencies) {
        if (dep in services) {
          visit(dep);
        }
      }
    }
    visiting.delete(name);
    resolved.push(name);
  }

  visit(serviceName);
  return resolved;
}

function computeStartupOrder(serviceNames) {
  const order = [];
  const added = new Set();

  for (const name of serviceNames) {
    const deps = resolveDependencies(name);
    for (const dep of deps) {
      if (!added.has(dep)) {
        order.push(dep);
        added.add(dep);
      }
    }
  }

  return order;
}

// ============================================================================
// HEALTH CHECKING
// ============================================================================

async function checkServiceHealth(serviceName, healthCheckUrl) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    http.get(healthCheckUrl, { timeout: 5000 }, (res) => {
      clearTimeout(timeout);
      resolve(res.statusCode === 200);
    }).on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function waitForServiceReady(serviceName, maxWait = STARTUP_TIMEOUT) {
  const svc = services[serviceName];
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const healthy = await checkServiceHealth(serviceName, svc.healthCheck);
    if (healthy) {
      supervisor.health[serviceName] = { status: 'UP', checkedAt: new Date().toISOString() };
      log('SUCCESS', serviceName, 'Health check passed');
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000)); // Retry every 2s
  }

  supervisor.health[serviceName] = { status: 'UNHEALTHY', checkedAt: new Date().toISOString() };
  log('ERROR', serviceName, `Health check failed after ${maxWait / 1000}s`);
  return false;
}

// ============================================================================
// PROCESS MANAGEMENT
// ============================================================================

function getExponentialBackoff(serviceName, attempt) {
  // Crashes: [timestamp, timestamp, ...]
  const crashes = supervisor.crashes[serviceName] || [];
  const recentCrashes = crashes.filter((t) => Date.now() - t < 3600000); // Last hour

  if (recentCrashes.length === 0) return 0; // No backoff on first crash
  if (recentCrashes.length === 1) return 2000; // 2s
  if (recentCrashes.length === 2) return 5000; // 5s
  if (recentCrashes.length === 3) return 15000; // 15s
  if (recentCrashes.length >= 4) return 60000; // 60s (max)
  return 0;
}

async function startService(serviceName) {
  const svc = services[serviceName];

  if (!svc) {
    log('ERROR', 'supervisor', `Unknown service: ${serviceName}`);
    return false;
  }

  // Check dependencies
  for (const dep of svc.dependencies || []) {
    const depHealth = supervisor.health[dep];
    if (!depHealth || depHealth.status !== 'UP') {
      log('WARN', serviceName, `Dependency not ready: ${dep}`);
      return false;
    }
  }

  // Reserve port
  const portOk = await reservePort(serviceName, svc.port);
  if (!portOk) {
    log('ERROR', serviceName, `Could not reserve port ${svc.port}`);
    return false;
  }

  // Prepare environment
  const env = { ...process.env, PORT: svc.port.toString() };
  if (svc.env) Object.assign(env, svc.env);

  // Launch process (Windows-aware)
  log('INFO', serviceName, `Launching: ${svc.cmd}`);
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : 'bash';
  const shellArgs = isWindows ? ['/d', '/s', '/c', svc.cmd] : ['-c', svc.cmd];

  const proc = spawn(shell, shellArgs, {
    cwd: svc.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach((line) => {
      if (line.trim()) log('INFO', serviceName, line);
    });
  });

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach((line) => {
      if (line.trim()) log('ERROR', serviceName, line);
    });
  });

  proc.on('exit', (code) => {
    if (code !== 0) {
      log('ERROR', serviceName, `Process exited with code ${code}`);
      supervisor.crashes[serviceName] = supervisor.crashes[serviceName] || [];
      supervisor.crashes[serviceName].push(Date.now());
      releasePort(serviceName);
      scheduleRestart(serviceName);
    }
  });

  supervisor.processes[serviceName] = proc;
  supervisor.health[serviceName] = { status: 'STARTING', startedAt: new Date().toISOString() };

  // Wait for health check
  const healthy = await waitForServiceReady(serviceName);
  if (!healthy) {
    log('ERROR', serviceName, 'Health check failed');
    proc.kill('SIGTERM');
    return false;
  }

  return true;
}

function scheduleRestart(serviceName) {
  const backoff = getExponentialBackoff(serviceName, (supervisor.crashes[serviceName] || []).length);
  if (backoff > 30000) {
    log('ERROR', serviceName, `Too many crashes (${(supervisor.crashes[serviceName] || []).length}), giving up`);
    return;
  }

  log('INFO', serviceName, `Scheduling restart in ${backoff / 1000}s`);
  setTimeout(() => {
    log('INFO', serviceName, 'Attempting restart...');
    startService(serviceName);
  }, backoff);
}

// ============================================================================
// STARTUP
// ============================================================================

async function startup(serviceNames) {
  log('INFO', 'supervisor', `=== SUPERVISOR START (v${SUPERVISOR_VERSION}) ===`);
  log('INFO', 'supervisor', `Services to start: ${serviceNames.join(', ')}`);

  loadPortRegistry();

  if (!validateManifest()) {
    log('ERROR', 'supervisor', 'Manifest validation failed');
    process.exit(1);
  }

  // Compute startup order
  const order = computeStartupOrder(serviceNames);
  log('INFO', 'supervisor', `Startup order: ${order.join(' -> ')}`);

  // Launch each service
  for (const serviceName of order) {
    const started = await startService(serviceName);
    if (!started && services[serviceName].required) {
      log('ERROR', 'supervisor', `Required service failed: ${serviceName}`);
      process.exit(1);
    }
  }

  supervisor.state = 'RUNNING';
  log('SUCCESS', 'supervisor', 'All services started');

  // Health check loop
  startHealthCheckLoop();
}

// ============================================================================
// HEALTH MONITORING
// ============================================================================

function startHealthCheckLoop() {
  setInterval(async () => {
    for (const [serviceName, health] of Object.entries(supervisor.health)) {
      const svc = services[serviceName];
      if (!svc) continue;

      const wasUp = health.status === 'UP';
      const isUp = await checkServiceHealth(serviceName, svc.healthCheck);

      if (wasUp && !isUp) {
        log('WARN', serviceName, 'Health check failed (was UP)');
        supervisor.health[serviceName].status = 'DEGRADED';
      } else if (!wasUp && isUp) {
        log('SUCCESS', serviceName, 'Health check recovered');
        supervisor.health[serviceName].status = 'UP';
      }
    }
  }, HEALTH_CHECK_INTERVAL);
}

// ============================================================================
// SHUTDOWN
// ============================================================================

async function gracefulShutdown() {
  log('INFO', 'supervisor', 'Graceful shutdown initiated');
  supervisor.state = 'STOPPING';

  const promises = [];
  for (const [serviceName, proc] of Object.entries(supervisor.processes)) {
    log('INFO', serviceName, 'Sending SIGTERM');
    proc.kill('SIGTERM');

    // Force kill after timeout
    const p = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          log('WARN', serviceName, 'Force killing (didn\'t respond to SIGTERM)');
          proc.kill('SIGKILL');
        }
        resolve();
      }, SIGNAL_TIMEOUT);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    promises.push(p);
  }

  await Promise.all(promises);
  log('INFO', 'supervisor', 'All services stopped');
  process.exit(0);
}

// ============================================================================
// MAIN
// ============================================================================

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

ensureLogDir();
log('INFO', 'supervisor', `Supervisor starting (PID ${process.pid})`);

// Load manifest FIRST, before parsing service names
if (!loadManifest()) {
  log('ERROR', 'supervisor', 'Failed to load manifest');
  process.exit(1);
}

// Now parse what to start
const serviceFilter = args.includes('--service') ? args[args.indexOf('--service') + 1] : null;
let serviceNames = Object.keys(services);
if (serviceFilter) {
  serviceNames = [serviceFilter];
}

// Handle signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start
if (dryRun) {
  validateManifest();
  const order = computeStartupOrder(serviceNames);
  console.log('\n=== DRY RUN ===');
  console.log(`Will start in order: ${order.join(' -> ')}`);
  for (const svc of order) {
    console.log(`\n${svc}:`);
    console.log(`  cmd: ${services[svc].cmd}`);
    console.log(`  port: ${services[svc].port}`);
    console.log(`  deps: ${(services[svc].dependencies || []).join(', ') || 'none'}`);
  }
} else {
  startup(serviceNames);
}

// Status endpoint (for monitoring) — only in real mode
if (!dryRun) {
  const STATUS_PORT = 9999;
  http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        uptime: Date.now() - supervisor.startTime,
        state: supervisor.state,
        health: supervisor.health,
        processes: Object.keys(supervisor.processes),
      }, null, 2));
    } else if (req.url === '/health') {
      const isHealthy = Object.values(supervisor.health).every((h) => h.status === 'UP');
      res.writeHead(isHealthy ? 200 : 503);
      res.end(JSON.stringify({ status: isHealthy ? 'UP' : 'DEGRADED' }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }).listen(STATUS_PORT, '127.0.0.1', () => {
    log('INFO', 'supervisor', `Status endpoint listening on :${STATUS_PORT}`);
  });
}

module.exports = { supervisor, startService, gracefulShutdown };
