/**
 * HEIDI Operational Intelligence — Runtime Observer
 *
 * WSL2, Docker daemon, container, and per-service health observation.
 * Distinguishes infrastructure failures from application failures.
 * Returns explicit states: HEALTHY, DEGRADED, UNAVAILABLE, UNKNOWN, NOT_CONFIGURED.
 */

const { execFile } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: options.timeout || 20000, ...options }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        error: err ? err.message : null,
      });
    });
  });
}

function wslCmd(args, options = {}) {
  return run('wsl', ['-d', 'Ubuntu', '-u', 'root', '-e', ...args], options);
}

function probe(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok: false, statusCode: null, latencyMs: null, error: 'no url' });
    const started = Date.now();
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        latencyMs: Date.now() - started,
        error: null,
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

function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new (require('net').Socket)();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, latencyMs: Date.now() - started, error: 'timeout' });
    }, timeoutMs);
    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true, latencyMs: Date.now() - started, error: null });
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: false, latencyMs: Date.now() - started, error: err.message });
    });
  });
}

class RuntimeObserver {
  constructor(options = {}) {
    this.manifestPath = options.manifestPath || path.join(__dirname, '..', '..', 'services-manifest.json');
    this.ursulaDir = options.ursulaDir || 'C:\\ProtoForge_Ecosystem\\Ursula_Suite';
    this.wslDistro = options.wslDistro || 'Ubuntu';
    this.projectRef = options.projectRef || 'HYDI-System-v2';
    this.services = this.loadManifest().services;
    this.lastContainerStates = new Map();
    this.lastRuntimeState = null;
    this.lastCheck = null;
  }

  loadManifest() {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    } catch (e) {
      return { services: {} };
    }
  }

  async wsl() {
    const started = Date.now();
    const res = await run('wsl', ['-d', this.wslDistro, '-u', 'root', '--', 'echo', 'wsl-ready'], { timeout: 30000 });
    if (res.ok) {
      return { status: 'HEALTHY', detail: `WSL ${this.wslDistro} responded`, latencyMs: Date.now() - started };
    }
    if (res.error && (res.error.includes('not found') || res.error.includes('not installed') || res.error.includes('not recognized'))) {
      return { status: 'NOT_CONFIGURED', detail: res.error, latencyMs: Date.now() - started };
    }
    return { status: 'UNAVAILABLE', detail: res.error || res.stderr, latencyMs: Date.now() - started };
  }

  async dockerDaemon() {
    const started = Date.now();
    const res = await this.docker(['version', '--format', '{{.Server.Version}}']);
    if (res.ok && res.stdout) {
      return { status: 'HEALTHY', detail: `Docker daemon ${res.stdout}`, latencyMs: Date.now() - started };
    }
    if (res.error && (res.error.includes('not found') || res.error.includes('not installed') || res.error.includes('not recognized'))) {
      return { status: 'NOT_CONFIGURED', detail: res.error, latencyMs: Date.now() - started };
    }
    return { status: 'UNAVAILABLE', detail: res.error || res.stderr, latencyMs: Date.now() - started };
  }

  async docker(args, options = {}) {
    return run('docker', args, options);
  }

  async dockerCompose(cwd, subcommand, extraArgs = []) {
    return run('docker', ['compose', subcommand, ...extraArgs], { cwd });
  }

  async containerStates() {
    const res = await this.docker(['ps', '--all', '--format', '{{.Names}}\t{{.Status}}']);
    if (!res.ok) return { status: 'UNKNOWN', detail: res.error || res.stderr, states: [] };
    const states = res.stdout.split('\n').filter(Boolean).map((line) => {
      const [name, status] = line.split('\t');
      const lowerStatus = (status || '').toLowerCase();
      return {
        name: name || null,
        status: status || null,
        healthy: lowerStatus.includes('up (healthy)') || lowerStatus.includes('up ') || lowerStatus.startsWith('up'),
        crashed: lowerStatus.includes('exited'),
        restarting: lowerStatus.includes('restarting'),
        restarts: 0,
      };
    });
    this.lastContainerStates = new Map(states.map((s) => [s.name, s]));
    const running = states.filter((s) => s.healthy).length;
    const crashed = states.filter((s) => s.crashed).length;
    const restarting = states.filter((s) => s.restarting).length;
    return {
      status: crashed > 0 ? 'DEGRADED' : 'HEALTHY',
      detail: `${running} running, ${crashed} crashed, ${restarting} restarting, ${states.length} total`,
      states,
    };
  }

  async container(name) {
    const states = await this.containerStates();
    const found = states.states.find((s) => s.name === name);
    if (!found) return { status: 'UNAVAILABLE', detail: `container ${name} not found` };
    if (found.healthy) return { status: 'HEALTHY', detail: `${name}: ${found.status}`, restarts: found.restarts };
    if (found.restarting) return { status: 'DEGRADED', detail: `${name}: restarting`, restarts: found.restarts };
    if (found.crashed) return { status: 'UNAVAILABLE', detail: `${name}: ${found.status}`, restarts: found.restarts };
    return { status: 'UNKNOWN', detail: `${name}: ${found.status}`, restarts: found.restarts };
  }

  async composeService(service, cwd = this.ursulaDir) {
    const ps = await this.dockerCompose(cwd, 'ps', ['-q', service]);
    if (!ps.ok || ps.stdout.trim() === '') {
      return { status: 'UNAVAILABLE', detail: `compose service ${service} not running` };
    }
    const inspect = await this.docker(['inspect', '--format', '{{.State.Status}}\t{{.RestartCount}}', ps.stdout.trim()]);
    if (!inspect.ok) return { status: 'DEGRADED', detail: inspect.error || inspect.stderr };
    const [state, restarts] = inspect.stdout.split('\t');
    if (state === 'running') return { status: 'HEALTHY', detail: `${service} running`, restarts: parseInt(restarts, 10) || 0 };
    return { status: 'UNAVAILABLE', detail: `${service} state ${state}`, restarts: parseInt(restarts, 10) || 0 };
  }

  async serviceProbe(name) {
    const svc = this.services[name];
    if (!svc) return { status: 'NOT_CONFIGURED', detail: `service ${name} not in manifest` };
    if (!svc.healthCheck) return { status: 'HEALTHY', detail: `${name} has no health check; assuming up` };
    const res = await probe(svc.healthCheck, 5000);
    if (res.ok) return { status: 'HEALTHY', detail: `${name} ${svc.healthCheck} ${res.statusCode} in ${res.latencyMs}ms` };
    return { status: 'UNAVAILABLE', detail: `${name} ${svc.healthCheck} ${res.error || res.statusCode}`, latencyMs: res.latencyMs };
  }

  async kong() {
    const res = await probe('http://127.0.0.1:54321/auth/v1/health', 5000);
    if (res.ok) return { status: 'HEALTHY', detail: `Kong 54321 ${res.statusCode} in ${res.latencyMs}ms` };
    return { status: 'UNAVAILABLE', detail: `Kong 54321 ${res.error || res.statusCode}`, latencyMs: res.latencyMs };
  }

  async postgresTcp() {
    const res = await tcpProbe('127.0.0.1', 5432, 5000);
    if (res.ok) return { status: 'HEALTHY', detail: `Postgres TCP 5432 in ${res.latencyMs}ms` };
    return { status: 'UNAVAILABLE', detail: `Postgres TCP 5432 ${res.error}`, latencyMs: res.latencyMs };
  }

  async redisTcp() {
    const res = await tcpProbe('127.0.0.1', 6379, 5000);
    if (res.ok) return { status: 'HEALTHY', detail: `Redis TCP 6379 in ${res.latencyMs}ms` };
    return { status: 'UNAVAILABLE', detail: `Redis TCP 6379 ${res.error}`, latencyMs: res.latencyMs };
  }

  async supabaseDb() {
    const name = `supabase_db_${this.projectRef}`;
    return this.container(name);
  }

  async supabaseKong() {
    const name = `supabase_kong_${this.projectRef}`;
    return this.container(name);
  }

  async dockerResourcePressure() {
    // WSL is not the active runtime path; this probe is informational.
    const df = await wslCmd(['df', '-h', '/']);
    const mem = await wslCmd(['free', '-m']);
    const load = await wslCmd(['cat', '/proc/loadavg'], { timeout: 5000 });
    if (!df.ok && !mem.ok) {
      return { status: 'NOT_CONFIGURED', detail: 'WSL resource probe not available', disk: df.error, memory: mem.error, load: load.error };
    }
    return {
      status: 'HEALTHY',
      detail: 'WSL resource snapshot',
      disk: df.ok ? df.stdout : df.error,
      memory: mem.ok ? mem.stdout : mem.error,
      load: load.ok ? load.stdout : load.error,
    };
  }

  allProbes() {
    return {
      'wsl': () => this.wsl(),
      'docker-daemon': () => this.dockerDaemon(),
      'docker-containers': () => this.containerStates(),
      'docker-resource-pressure': () => this.dockerResourcePressure(),
      'kong': () => this.kong(),
      'supabase-db-container': () => this.supabaseDb(),
      'supabase-kong-container': () => this.supabaseKong(),
      'postgres-tcp': () => this.postgresTcp(),
      'redis-tcp': () => this.redisTcp(),
      'protohub-compose': () => this.composeService('protohub-api'),
      'postgres-compose': () => this.composeService('postgres'),
      'redis-compose': () => this.composeService('redis'),
      'memory-engine': () => this.serviceProbe('memory-engine'),
      'hydi-core': () => this.serviceProbe('hydi-core'),
      'heidi-bridge': () => this.serviceProbe('heidi-bridge'),
      'next-app': () => this.serviceProbe('next-app'),
      'heidi-mobile': () => this.serviceProbe('heidi-mobile'),
      'forge-loop': () => this.serviceProbe('forge-loop'),
    };
  }

  registerWith(aggregator) {
    const probes = this.allProbes();
    for (const [name, fn] of Object.entries(probes)) {
      aggregator.register(name, fn);
    }
    return this;
  }

  async inspectAll() {
    const out = {};
    for (const [name, fn] of Object.entries(this.allProbes())) {
      try {
        out[name] = await fn();
      } catch (e) {
        out[name] = { status: 'UNKNOWN', detail: e.message };
      }
    }
    this.lastCheck = out;
    return out;
  }

  snapshot() {
    return this.lastCheck;
  }
}

module.exports = { RuntimeObserver };
