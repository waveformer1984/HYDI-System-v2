/**
 * HEIDI Operational Control Plane — Local Health Probes
 *
 * Bounded probes for local-first infrastructure. No external internet checks.
 * Returns one of: HEALTHY, DEGRADED, UNAVAILABLE, NOT_CONFIGURED.
 */

const { execFile } = require('child_process');

function runExecFile(file, args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? ` — ${stderr.trim()}` : ''}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

class LocalHealthProbes {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
    this.ollamaUrl = options.ollamaUrl || process.env.LOCAL_MODEL_URL || 'http://127.0.0.1:11434';
    this.projectRef = options.projectRef || 'HYDI-System-v2';
    this._fetch = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    this._execFile = options.execFile || runExecFile;
  }

  async persistence() {
    try {
      if (!this._fetch) return { status: 'NOT_CONFIGURED', detail: 'fetch not available' };
      const res = await this._fetch(`${this.supabaseUrl}/rest/v1/`);
      if (res.ok || res.status === 401) {
        return { status: 'HEALTHY', detail: `Supabase REST reachable (${res.status})` };
      }
      return { status: 'DEGRADED', detail: `Supabase REST returned ${res.status}` };
    } catch (err) {
      return { status: 'UNAVAILABLE', detail: err.message };
    }
  }

  async postgres() {
    try {
      const out = await this._execFile('docker', ['ps', '--filter', `name=supabase_db_${this.projectRef}`, '--format', '{{.Names}}:{{.Status}}']);
      if (out.includes('Up')) return { status: 'HEALTHY', detail: out };
      if (out.includes('Exited') || out.includes('Restarting')) return { status: 'DEGRADED', detail: out };
      return { status: 'UNAVAILABLE', detail: out };
    } catch (err) {
      if (err.message.includes('docker') && err.message.includes('not')) {
        return { status: 'NOT_CONFIGURED', detail: err.message };
      }
      return { status: 'UNAVAILABLE', detail: err.message };
    }
  }

  async ollama() {
    if (process.env.ENABLE_LOCAL_MODEL !== 'true' || process.env.LOCAL_MODEL_URL === '') {
      return { status: 'NOT_CONFIGURED', detail: 'local model not enabled' };
    }
    try {
      const res = await this._fetch(`${this.ollamaUrl}/api/tags`);
      if (res.ok) return { status: 'HEALTHY', detail: 'Ollama responding' };
      return { status: 'DEGRADED', detail: `Ollama returned ${res.status}` };
    } catch (err) {
      return { status: 'UNAVAILABLE', detail: err.message };
    }
  }

  async docker() {
    try {
      const out = await this._execFile('docker', ['version', '--format', '{{.Server.Version}}']);
      return { status: 'HEALTHY', detail: `Docker ${out}` };
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('not installed')) {
        return { status: 'NOT_CONFIGURED', detail: err.message };
      }
      return { status: 'UNAVAILABLE', detail: err.message };
    }
  }

  async workers() {
    // Placeholder: real worker queue depth would query the local actions table.
    // For now, report NOT_CONFIGURED until a worker monitor is registered.
    return { status: 'NOT_CONFIGURED', detail: 'worker queue monitor not registered' };
  }

  async controlPlane() {
    return { status: 'HEALTHY', detail: 'Heidi control plane is active' };
  }

  async inbucket() {
    return this.service('inbucket');
  }

  async service(name) {
    const containerName = `supabase_${name}_${this.projectRef}`;
    try {
      const out = await this._execFile('docker', ['ps', '--filter', `name=${containerName}`, '--format', '{{.Names}}:{{.Status}}']);
      if (out.includes('Up')) return { status: 'HEALTHY', detail: out };
      if (out.includes('Exited') || out.includes('Restarting')) return { status: 'UNAVAILABLE', detail: out };
      return { status: 'UNAVAILABLE', detail: out };
    } catch (err) {
      return { status: 'UNAVAILABLE', detail: err.message };
    }
  }

  all() {
    return {
      persistence: () => this.persistence(),
      postgres: () => this.postgres(),
      ollama: () => this.ollama(),
      docker: () => this.docker(),
      workers: () => this.workers(),
      controlPlane: () => this.controlPlane(),
      inbucket: () => this.inbucket(),
    };
  }
}

function registerWith(aggregator, options = {}) {
  const probes = new LocalHealthProbes(options);
  for (const [name, fn] of Object.entries(probes.all())) {
    aggregator.register(name, fn);
  }
  return probes;
}

module.exports = { LocalHealthProbes, registerWith };
