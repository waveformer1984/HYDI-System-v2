/**
 * HEIDI Operational Control Plane — Controlled Executor
 *
 * Executes only explicitly allowlisted, typed local operations.
 * No generic shell or command interfaces are exposed.
 */

const { execFile } = require('child_process');

function runExecFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: options.timeout || 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`execFile failed: ${error.message}${stderr ? ` — ${stderr.trim()}` : ''}`));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

class ControlledExecutor {
  constructor(registry) {
    this.registry = registry;
    this.executors = new Map();
    this.allowed = this.buildAllowlist();
    this.registerDefaults();
  }

  buildAllowlist() {
    return {
      'docker.local': {
        'status': { resources: ['supabase_db', 'supabase_kong', 'supabase_inbucket', 'supabase_auth', 'supabase_rest'] },
        'restart_service': { resources: ['supabase_inbucket'] },
        'compose_restart': { resources: ['postgres', 'redis', 'protohub-api'] },
      },
      'database.local': {
        'status': { resources: ['supabase'] },
      },
      'wsl.local': {},
      'health.read': { 'read': { resources: ['any'] } },
      'health.recover': { 'recover': { resources: ['supabase_inbucket'] } },
      'test.run': { 'run': { resources: ['any'] } },
      'build.run': { 'run': { resources: ['any'] } },
      'git.local': { 'status': { resources: ['workspace'] } },
    };
  }

  validateTask(task) {
    const cap = this.allowed[task.capabilityId];
    if (!cap) throw new Error(`DENIED: target not allowed: ${task.capabilityId}`);

    const operation = task.parameters?.operation || task.parameters?.action;
    if (!operation) throw new Error('DENIED: missing operation');

    const allowedOps = cap[operation];
    if (!allowedOps) throw new Error(`DENIED: operation not allowed: ${operation}`);

    const resource = task.parameters?.resource;
    if (!resource) throw new Error('DENIED: missing resource');
    if (!allowedOps.resources.includes(resource) && !allowedOps.resources.includes('any')) {
      throw new Error(`DENIED: resource not allowed: ${resource}`);
    }

    return { target: task.capabilityId, operation, resource };
  }

  registerDefaults() {
    this.register('health.read', async () => ({ status: 'healthy', source: 'mock' }));
    this.register('health.recover', async (task) => {
      const service = task.parameters?.service;
      if (!service) throw new Error('service is required for recovery');
      if (!['supabase_inbucket'].includes(service)) {
        throw new Error(`DENIED: service not in recovery allowlist: ${service}`);
      }
      const containerName = this.containerName(service);
      return runExecFile('docker', ['restart', containerName]);
    });
    this.register('test.run', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('build.run', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('git.local', async () => ({ status: 'skipped', reason: 'no runner configured' }));

    this.register('docker.local', async (task) => {
      const { operation, resource } = this.validateTask(task);
      if (operation === 'status') {
        const containerName = this.containerName(resource);
        return runExecFile('docker', ['ps', '--filter', `name=${containerName}`, '--format', '{{.Names}}:{{.Status}}']);
      }
      if (operation === 'restart_service') {
        const containerName = this.containerName(resource);
        return runExecFile('docker', ['restart', containerName]);
      }
      if (operation === 'compose_restart') {
        const composeFile = 'C:\\ProtoForge_Ecosystem\\Ursula_Suite\\docker-compose.yml';
        return runExecFile('docker', ['compose', '-f', composeFile, 'restart', resource]);
      }
      throw new Error(`DENIED: operation not implemented: ${operation}`);
    });

    this.register('wsl.local', async () => ({ status: 'not_configured', reason: 'WSL execution is not enabled' }));

    this.register('database.local', async (task) => {
      const { operation, resource } = this.validateTask(task);
      if (operation === 'status') {
        const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
        const res = await fetch(`${url}/rest/v1/`);
        return { status: res.ok ? 'healthy' : 'degraded', statusCode: res.status };
      }
      throw new Error(`DENIED: operation not implemented: ${operation}`);
    });

    this.register('deploy.production', async () => { throw new Error('Production deployment requires explicit override'); });
    this.register('credential.production', async () => { throw new Error('Production credential changes require explicit override'); });
    this.register('financial.transaction', async () => { throw new Error('Financial transactions require explicit override'); });
    this.register('database.destructive', async () => { throw new Error('Destructive database operations require explicit override'); });
  }

  containerName(resource) {
    const base = resource.startsWith('supabase_') ? resource : `supabase_${resource}`;
    return `${base}_HYDI-System-v2`;
  }

  register(capabilityId, fn) {
    this.executors.set(capabilityId, fn);
    return this;
  }

  async execute(task) {
    const start = Date.now();
    let error = null;
    let result;
    let timer;

    try {
      const capability = this.registry.get(task.capabilityId);
      if (!capability) throw new Error(`Unregistered capability: ${task.capabilityId}`);

      const fn = this.executors.get(task.capabilityId);
      if (!fn) throw new Error(`No executor for capability: ${task.capabilityId}`);

      result = await Promise.race([
        fn(task),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), capability.timeoutMs);
        }),
      ]);

      for (let i = 0; i < capability.retryPolicy.maxRetries && !result; i++) {
        await this.delay(capability.retryPolicy.backoffMs * (i + 1));
        result = await fn(task);
      }
    } catch (e) {
      error = e.message;
    } finally {
      clearTimeout(timer);
    }

    const duration = Date.now() - start;
    if (error) return { success: false, error, duration };
    return { success: true, result, duration };
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { ControlledExecutor };
