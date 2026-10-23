'use strict';

/**
 * Controlled failure injection for the endurance soak harness.
 *
 * This module performs REAL failure injection: it terminates and restarts
 * actual processes and containers. It is never loaded on the default path —
 * the harness only requires it when `--chaos` is passed explicitly.
 *
 * Every scenario reports, per the operational qualification standard:
 *   - timestamp of injection
 *   - the fault actually injected (or the reason it was skipped)
 *   - recovery duration measured against the service health endpoint
 *   - observed behaviour during the outage window
 *   - pass/fail
 *
 * A scenario that cannot perform its fault reports `status: 'skipped'` with a
 * reason. It never reports a pass it did not earn.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execFile } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60000, windowsHide: true, ...options }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : null });
    });
  });
}

/** Convert a Windows path to a WSL /mnt/<drive> path for bash -c commands. */
function toWslPath(p) {
  if (typeof p !== 'string') return p;
  if (!/^[A-Za-z]:[\\/]/.test(p)) return p.replace(/\\/g, '/');
  const drive = p[0].toLowerCase();
  const rest = p.slice(2).replace(/\\/g, '/');
  return `/mnt/${drive}${rest}`;
}

async function dockerVersion() {
  return execFileAsync('docker', ['--version']);
}

async function dockerCompose(cwd, subcommand, extraArgs = [], options = {}) {
  return execFileAsync('docker', ['compose', subcommand, ...extraArgs], { ...options, cwd });
}

/**
 * Capture live Docker runtime identity so the harness can prove it is targeting
 * the same daemon that hosts the qualification workload.
 */
async function runtimeIdentity() {
  const version = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}']);
  const context = await execFileAsync('docker', ['context', 'show']);
  const containerList = await execFileAsync('docker', ['ps', '--all', '--format', '{{.Names}}:{{.ID}}']);
  return {
    client: 'Windows docker CLI',
    serverVersion: version.ok ? version.stdout.trim() : null,
    context: context.ok ? context.stdout.trim() : null,
    containers: containerList.ok
      ? containerList.stdout.trim().split('\n').filter(Boolean)
      : [],
  };
}

async function resolveComposeService(cwd, service) {
  const ps = await dockerCompose(cwd, 'ps', ['-q', service], { timeout: 60000 });
  return { target: service, containerId: ps.ok ? ps.stdout.trim() : null, ok: ps.ok && ps.stdout.trim() !== '' };
}

/** Single health probe. Resolves {ok, statusCode, latencyMs} and never rejects. */
function probe(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok: false, statusCode: null, latencyMs: null, error: 'no health endpoint' });
    const started = Date.now();
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        latencyMs: Date.now() - started,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: null, latencyMs: Date.now() - started, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, statusCode: null, latencyMs: Date.now() - started, error: err.message });
    });
  });
}

/** Poll until healthy or timeout. Returns measured recovery duration. */
async function waitForHealthy(url, timeoutMs, intervalMs = 2000) {
  const started = Date.now();
  let attempts = 0;
  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    const res = await probe(url);
    if (res.ok) {
      return { recovered: true, recoveryMs: Date.now() - started, attempts };
    }
    await sleep(intervalMs);
  }
  return { recovered: false, recoveryMs: null, attempts, timedOutAfterMs: timeoutMs };
}

/** Confirm the endpoint actually stopped serving, so we know the fault landed. */
async function waitForUnhealthy(url, timeoutMs, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await probe(url, 2000);
    if (!res.ok) return { observedOutage: true, detectedAfterMs: Date.now() - started };
    await sleep(intervalMs);
  }
  return { observedOutage: false, detectedAfterMs: null };
}

function loadManifest() {
  const manifestPath = path.join(REPO_ROOT, 'services-manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/** PIDs listening on a TCP port. Returns [] when none or when unsupported. */
async function pidsOnPort(port) {
  if (!port) return [];
  if (process.platform === 'win32') {
    const { ok, stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP']);
    if (!ok) return [];
    const pids = new Set();
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
      if (m && Number(m[1]) === Number(port)) pids.add(Number(m[2]));
    }
    return [...pids];
  }
  const { ok, stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  if (!ok) return [];
  return stdout.split('\n').map((l) => Number(l.trim())).filter(Boolean);
}

async function killPid(pid, force) {
  if (process.platform === 'win32') {
    const args = force ? ['/PID', String(pid), '/F', '/T'] : ['/PID', String(pid), '/T'];
    return execFileAsync('taskkill', args);
  }
  return execFileAsync('kill', [force ? '-9' : '-15', String(pid)]);
}

/**
 * Base scenario: kill whatever listens on a manifest service's port, restart it
 * from the manifest command, and measure recovery against its health check.
 */
class ServiceRestartScenario {
  constructor(serviceName, options = {}) {
    this.name = options.name || `restart-${serviceName}`;
    this.serviceName = serviceName;
    this.description = options.description || `Terminate and restart the "${serviceName}" service`;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 120000;
    this.force = options.force !== false;
    this.destructive = true;
  }

  async resolve() {
    const manifest = loadManifest();
    const service = manifest.services[this.serviceName];
    if (!service) return { ok: false, target: this.serviceName, reason: 'not in services-manifest.json' };
    const pids = await pidsOnPort(service.port);
    return {
      ok: pids.length > 0,
      target: this.serviceName,
      port: service.port,
      pids,
      healthCheck: service.healthCheck,
      reason: pids.length === 0 ? 'no listening PID found' : undefined,
    };
  }

  async run(ctx) {
    const manifest = loadManifest();
    const service = manifest.services[this.serviceName];
    if (!service) {
      return { status: 'skipped', reason: `service "${this.serviceName}" not present in services-manifest.json` };
    }

    const healthUrl = service.healthCheck;
    if (!healthUrl) {
      return { status: 'skipped', reason: `service "${this.serviceName}" has no healthCheck endpoint; recovery cannot be measured` };
    }

    const preFlight = await probe(healthUrl);
    if (!preFlight.ok) {
      return {
        status: 'skipped',
        reason: `service "${this.serviceName}" was not healthy before injection (${preFlight.error || 'HTTP ' + preFlight.statusCode}); refusing to attribute recovery to chaos`,
        preFlight,
      };
    }

    const pids = await pidsOnPort(service.port);
    if (pids.length === 0) {
      return { status: 'skipped', reason: `no listening PID found on port ${service.port}; fault could not be injected` };
    }

    const injectedAt = new Date().toISOString();
    const killResults = [];
    for (const pid of pids) killResults.push({ pid, ...(await killPid(pid, this.force)) });

    const outage = await waitForUnhealthy(healthUrl, 15000);
    if (!outage.observedOutage) {
      return {
        status: 'failed',
        injectedAt,
        injectedFault: `terminated PID(s) ${pids.join(', ')} on port ${service.port}`,
        observedBehaviour: 'health endpoint never went unhealthy; the fault did not take effect and no recovery was exercised',
        killResults,
        recoveryMs: null,
      };
    }

    // Restart from the manifest definition unless the supervisor owns recovery.
    let restart = null;
    if (!ctx.supervised) {
      restart = await this.restartFromManifest(service);
    }

    const recovery = await waitForHealthy(healthUrl, this.recoveryTimeoutMs);

    return {
      status: recovery.recovered ? 'passed' : 'failed',
      injectedAt,
      injectedFault: `terminated PID(s) ${pids.join(', ')} listening on port ${service.port}`,
      observedBehaviour: recovery.recovered
        ? `health endpoint went down after ${outage.detectedAfterMs}ms and returned healthy after ${recovery.recoveryMs}ms across ${recovery.attempts} probes`
        : `health endpoint went down after ${outage.detectedAfterMs}ms and did NOT return healthy within ${this.recoveryTimeoutMs}ms`,
      recoveryMs: recovery.recoveryMs,
      outageDetectedAfterMs: outage.detectedAfterMs,
      killResults,
      restart,
      recoveredBy: ctx.supervised ? 'supervisor' : 'harness (manifest cmd)',
    };
  }

  async restartFromManifest(service) {
    const child = spawn(service.cmd, {
      cwd: service.cwd || REPO_ROOT,
      env: { ...process.env, ...(service.env || {}) },
      shell: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    child.unref();
    return { spawned: true, pid: child.pid, cmd: service.cmd };
  }
}

/** Restart a docker compose service (Redis, PostgreSQL, ProtoHub). */
class DockerServiceRestartScenario {
  constructor(composeService, options = {}) {
    this.name = options.name || `restart-${composeService}`;
    this.composeService = composeService;
    this.description = options.description || `Restart the "${composeService}" container via docker compose`;
    this.cwd = options.cwd;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 180000;
    this.healthUrl = options.healthUrl || null;
    this.tcpCheck = options.tcpCheck || null;
    this.destructive = true;
  }

  async resolve() {
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : null;
    if (!cwd) return { ok: false, target: this.composeService, reason: `project directory not found: ${this.cwd}` };
    const resolved = await resolveComposeService(cwd, this.composeService);
    return { ...resolved, runtime: 'Windows docker compose' };
  }

  async run() {
    const version = await dockerVersion();
    if (!version.ok) {
      return { status: 'skipped', reason: 'docker CLI is not available on this host' };
    }

    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : null;
    if (!cwd) {
      return { status: 'skipped', reason: `docker compose project directory not found: ${this.cwd}` };
    }

    const ps = await dockerCompose(cwd, 'ps', ['-q', this.composeService]);
    if (!ps.ok || ps.stdout.trim() === '') {
      return { status: 'skipped', reason: `container "${this.composeService}" is not running; fault could not be injected` };
    }

    const injectedAt = new Date().toISOString();
    const restart = await dockerCompose(cwd, 'restart', [this.composeService], { timeout: 120000 });
    if (!restart.ok) {
      return {
        status: 'failed',
        injectedAt,
        injectedFault: `docker compose restart ${this.composeService}`,
        observedBehaviour: `restart command failed: ${restart.error || restart.stderr.trim()}`,
        recoveryMs: null,
      };
    }

    const recovery = this.healthUrl
      ? await waitForHealthy(this.healthUrl, this.recoveryTimeoutMs)
      : await this.waitForTcp();

    return {
      status: recovery.recovered ? 'passed' : 'failed',
      injectedAt,
      injectedFault: `docker compose restart ${this.composeService}`,
      observedBehaviour: recovery.recovered
        ? `dependency accepted connections again after ${recovery.recoveryMs}ms`
        : `dependency did not become reachable within ${this.recoveryTimeoutMs}ms`,
      recoveryMs: recovery.recoveryMs,
      recoveredBy: 'docker compose',
    };
  }

  async waitForTcp() {
    if (!this.tcpCheck) {
      return { recovered: false, recoveryMs: null, note: 'no readiness check configured' };
    }
    const { tcpProbe } = require('./soak-metrics');
    const started = Date.now();
    while (Date.now() - started < this.recoveryTimeoutMs) {
      const res = await tcpProbe(this.tcpCheck.host, this.tcpCheck.port, 2000);
      if (res.reachable) return { recovered: true, recoveryMs: Date.now() - started };
      await sleep(2000);
    }
    return { recovered: false, recoveryMs: null };
  }
}

/**
 * Delayed dependency startup: stop a dependency, hold it down for a fixed
 * window, then bring it back and measure how long the dependent service takes
 * to recover.
 */
class DelayedDependencyScenario {
  constructor(options) {
    this.name = options.name;
    this.description = options.description;
    this.composeService = options.composeService;
    this.cwd = options.cwd;
    this.downtimeMs = options.downtimeMs || 30000;
    this.dependentHealthUrl = options.dependentHealthUrl;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 180000;
    this.destructive = true;
  }

  async resolve() {
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : null;
    if (!cwd) return { ok: false, target: this.composeService, reason: `project directory not found: ${this.cwd}` };
    const resolved = await resolveComposeService(cwd, this.composeService);
    return { ...resolved, runtime: 'Windows docker compose' };
  }

  async run() {
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : null;
    if (!cwd) return { status: 'skipped', reason: `docker compose project directory not found: ${this.cwd}` };

    const ps = await dockerCompose(cwd, 'ps', ['-q', this.composeService]);
    if (!ps.ok || ps.stdout.trim() === '') {
      return { status: 'skipped', reason: `container "${this.composeService}" is not running; fault could not be injected` };
    }

    const injectedAt = new Date().toISOString();
    const stop = await dockerCompose(cwd, 'stop', [this.composeService], { timeout: 60000 });
    if (!stop.ok) {
      return { status: 'failed', injectedAt, injectedFault: `stop ${this.composeService}`, observedBehaviour: stop.error, recoveryMs: null };
    }

    const duringOutage = await probe(this.dependentHealthUrl);
    await sleep(this.downtimeMs);
    await dockerCompose(cwd, 'start', [this.composeService], { timeout: 120000 });

    const recovery = await waitForHealthy(this.dependentHealthUrl, this.recoveryTimeoutMs);

    return {
      status: recovery.recovered ? 'passed' : 'failed',
      injectedAt,
      injectedFault: `stopped "${this.composeService}" for ${this.downtimeMs}ms, then started it`,
      observedBehaviour: `dependent endpoint during outage: ${duringOutage.ok ? 'still healthy (degraded-tolerant)' : 'unhealthy'}; ` +
        (recovery.recovered
          ? `recovered ${recovery.recoveryMs}ms after dependency restart`
          : `did not recover within ${this.recoveryTimeoutMs}ms`),
      recoveryMs: recovery.recoveryMs,
      dependentHealthyDuringOutage: duringOutage.ok,
      recoveredBy: 'docker compose start + dependent reconnect',
    };
  }
}

/**
 * Build the scenario registry from the services manifest.
 * `ursulaDir` is where the Ursula docker compose project lives.
 */
function buildScenarios(options = {}) {
  const ursulaDir = options.ursulaDir || 'C:\\ProtoForge_Ecosystem\\Ursula_Suite';

  return [
    new ServiceRestartScenario('next-app', {
      name: 'restart-next',
      description: 'Terminate the Next.js frontend/API process and verify it returns to health',
      recoveryTimeoutMs: 300000,
    }),
    new ServiceRestartScenario('heidi-bridge', {
      name: 'kill-bridge',
      description: 'Terminate the Heidi Bridge process and verify it returns to health',
    }),
    new ServiceRestartScenario('hydi-core', {
      name: 'restart-core',
      description: 'Terminate the HYDI Core orchestrator and verify it returns to health',
    }),
    new ServiceRestartScenario('memory-engine', {
      name: 'restart-memory-engine',
      description: 'Terminate the Memory Engine and verify it returns to health',
    }),
    new DockerServiceRestartScenario('redis', {
      name: 'restart-redis',
      cwd: ursulaDir,
      tcpCheck: { host: '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) },
      description: 'Restart the Redis container and verify it accepts connections again',
    }),
    new DockerServiceRestartScenario('postgres', {
      name: 'restart-postgres',
      cwd: ursulaDir,
      tcpCheck: { host: '127.0.0.1', port: Number(process.env.PGPORT || 5432) },
      description: 'Restart the PostgreSQL container and verify it accepts connections again',
    }),
    new DockerServiceRestartScenario('protohub-api', {
      name: 'restart-protohub',
      cwd: ursulaDir,
      healthUrl: 'http://localhost:4000/health',
      description: 'Restart the ProtoHub API container and verify its health endpoint recovers',
    }),
    new DelayedDependencyScenario({
      name: 'delayed-postgres-startup',
      composeService: 'postgres',
      cwd: ursulaDir,
      downtimeMs: Number(process.env.CHAOS_DEPENDENCY_DOWNTIME_MS || 30000),
      dependentHealthUrl: 'http://localhost:3000/api/health',
      description: 'Hold PostgreSQL down, then restore it and measure dependent recovery',
    }),
  ];
}

class ChaosOrchestrator {
  constructor(options = {}) {
    this.scenarios = buildScenarios(options);
    this.selected = options.scenarios && options.scenarios.length
      ? this.scenarios.filter((s) => options.scenarios.includes(s.name))
      : this.scenarios;
    this.supervised = options.supervised || false;
    this.dryRun = options.dryRun || false;
    this.logger = options.logger;
    this.results = [];
  }

  list() {
    return this.scenarios.map((s) => ({ name: s.name, description: s.description, destructive: s.destructive }));
  }

  /** Run one scenario by name and record a fully attributed result. */
  async runScenario(scenario) {
    const startedAt = Date.now();

    if (this.dryRun) {
      let resolved;
      try {
        resolved = await scenario.resolve();
      } catch (err) {
        resolved = { ok: false, reason: `resolve threw: ${err.message}` };
      }
      const result = {
        scenario: scenario.name,
        description: scenario.description,
        status: resolved && resolved.ok ? 'dry-run-resolved' : 'dry-run-unresolved',
        reason: resolved && resolved.ok ? 'dry run: no fault injected' : `dry run: target unresolved (${resolved.reason || 'unknown'})`,
        target: resolved,
        injectedAt: new Date(startedAt).toISOString(),
      };
      this.results.push(result);
      return result;
    }

    let outcome;
    try {
      outcome = await scenario.run({ supervised: this.supervised });
    } catch (err) {
      outcome = {
        status: 'failed',
        injectedAt: new Date(startedAt).toISOString(),
        injectedFault: scenario.description,
        observedBehaviour: `scenario threw: ${err.message}`,
        recoveryMs: null,
      };
    }

    const result = {
      scenario: scenario.name,
      description: scenario.description,
      durationMs: Date.now() - startedAt,
      ...outcome,
    };
    this.results.push(result);
    if (this.logger) {
      this.logger.warn(`chaos scenario ${result.scenario}: ${result.status}`, {
        recoveryMs: result.recoveryMs ?? null,
        reason: result.reason || undefined,
      });
    }
    return result;
  }

  nextScenario(index) {
    if (this.selected.length === 0) return null;
    return this.selected[index % this.selected.length];
  }

  summarise() {
    const by = (s) => this.results.filter((r) => r.status === s);
    const recoveries = this.results
      .filter((r) => typeof r.recoveryMs === 'number')
      .map((r) => r.recoveryMs);
    return {
      totalInjected: this.results.length,
      passed: by('passed').length,
      failed: by('failed').length,
      skipped: by('skipped').length,
      recoveryMs: recoveries.length
        ? {
            min: Math.min(...recoveries),
            max: Math.max(...recoveries),
            avg: Math.round(recoveries.reduce((a, b) => a + b, 0) / recoveries.length),
          }
        : null,
      results: this.results,
    };
  }
}

module.exports = {
  ChaosOrchestrator,
  ServiceRestartScenario,
  DockerServiceRestartScenario,
  DelayedDependencyScenario,
  buildScenarios,
  probe,
  waitForHealthy,
  runtimeIdentity,
  resolveComposeService,
};
