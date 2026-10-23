/**
 * HEIDI Operational Intelligence — WSL Executor
 *
 * Bounded WSL Docker and docker compose execution capability.
 * No arbitrary shell commands. Operations and resources are allowlisted.
 */

const { execFile } = require('child_process');

function runExecFile(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: options.timeout || 120000, ...options }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        error: err ? err.message : null,
      });
    });
  });
}

function wslDocker(args) {
  return runExecFile('docker', args);
}

function wslCompose(cwd, subcommand, extraArgs = []) {
  return runExecFile('docker', ['compose', subcommand, ...extraArgs], { cwd });
}

class WslExecutor {
  constructor(options = {}) {
    this.distro = options.distro || 'Ubuntu';
    this.ursulaDir = options.ursulaDir || 'C:\\ProtoForge_Ecosystem\\Ursula_Suite';
    this.allowlist = this.buildAllowlist();
  }

  buildAllowlist() {
    return {
      'wsl_docker.local': {
        status: {
          resources: ['supabase_db', 'supabase_kong', 'supabase_inbucket', 'supabase_auth', 'supabase_rest'],
        },
        restart_container: {
          resources: ['supabase_db', 'supabase_kong', 'supabase_inbucket', 'supabase_auth', 'supabase_rest'],
        },
      },
      'wsl_compose.local': {
        status: {
          resources: ['postgres', 'redis', 'protohub-api'],
        },
        start: {
          resources: ['postgres', 'redis', 'protohub-api'],
        },
        restart: {
          resources: ['postgres', 'redis', 'protohub-api'],
          // require cooldown between restarts? enforced elsewhere
        },
      },
    };
  }

  containerName(resource) {
    const base = resource.startsWith('supabase_') ? resource : `supabase_${resource}`;
    return `${base}_HYDI-System-v2`;
  }

  validateTask(task) {
    const cap = this.allowlist[task.capabilityId];
    if (!cap) throw new Error(`DENIED: target not allowed: ${task.capabilityId}`);

    const operation = task.parameters?.operation || task.parameters?.action;
    if (!operation) throw new Error('DENIED: missing operation');

    const allowedOps = cap[operation];
    if (!allowedOps) throw new Error(`DENIED: operation not allowed: ${operation}`);

    const resource = task.parameters?.resource;
    if (!resource) throw new Error('DENIED: missing resource');
    if (!allowedOps.resources.includes(resource)) {
      throw new Error(`DENIED: resource not allowed: ${resource}`);
    }

    return { target: task.capabilityId, operation, resource };
  }

  async execute(task) {
    const { operation, resource } = this.validateTask(task);

    if (task.capabilityId === 'wsl_docker.local') {
      if (operation === 'status') {
        const container = this.containerName(resource);
        return wslDocker(['ps', '--filter', `name=${container}`, '--format', '{{.Names}}:{{.Status}}:{{.RestartCount}}'], this.distro);
      }
      if (operation === 'restart_container') {
        const container = this.containerName(resource);
        const res = await wslDocker(['restart', container], this.distro);
        if (res.ok) return { success: true, status: 'restarted', detail: res.stdout };
        return { success: false, error: res.error || res.stderr };
      }
    }

    if (task.capabilityId === 'wsl_compose.local') {
      if (operation === 'status') {
        const res = await wslCompose(this.ursulaDir, 'ps', ['-q', resource], this.distro);
        if (res.ok && res.stdout) return { success: true, running: res.stdout.trim() !== '', detail: res.stdout };
        return { success: false, error: res.error || res.stderr };
      }
      if (operation === 'start') {
        const res = await wslCompose(this.ursulaDir, 'start', [resource], this.distro);
        if (res.ok) return { success: true, status: 'started', detail: res.stdout };
        return { success: false, error: res.error || res.stderr };
      }
      if (operation === 'restart') {
        const res = await wslCompose(this.ursulaDir, 'restart', [resource], this.distro);
        if (res.ok) return { success: true, status: 'restarted', detail: res.stdout };
        return { success: false, error: res.error || res.stderr };
      }
    }

    throw new Error(`DENIED: operation not implemented: ${operation}`);
  }

  async identity() {
    const version = await wslDocker(['version', '--format', '{{.Server.Version}}']);
    const context = await wslDocker(['context', 'show']);
    const list = await wslDocker(['ps', '--all', '--format', '{{.Names}}:{{.ID}}']);
    return {
      client: 'Windows docker CLI via WslExecutor',
      serverVersion: version.ok ? version.stdout.trim() : null,
      context: context.ok ? context.stdout.trim() : null,
      containers: list.ok ? list.stdout.trim().split('\n').filter(Boolean) : [],
    };
  }

  static registerWith(executor, registry, options) {
    const wsl = new WslExecutor(options);

    registry.register({
      id: 'wsl_docker.local',
      description: 'WSL Docker container operations',
      riskLevel: 'LOW',
      environment: 'local',
      timeoutMs: 120000,
      retryPolicy: { maxRetries: 1, backoffMs: 2000 },
    });

    registry.register({
      id: 'wsl_compose.local',
      description: 'WSL docker compose operations',
      riskLevel: 'LOW',
      environment: 'local',
      timeoutMs: 120000,
      retryPolicy: { maxRetries: 1, backoffMs: 2000 },
    });

    executor.register('wsl_docker.local', (task) => wsl.execute(task));
    executor.register('wsl_compose.local', (task) => wsl.execute(task));
    return wsl;
  }
}

module.exports = { WslExecutor };
