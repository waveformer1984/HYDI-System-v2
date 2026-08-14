/**
 * HEIDI Operational Control Plane — Controlled Executor
 */

const { exec } = require('child_process');
const { promisify } = require('util');

class ControlledExecutor {
  constructor(registry) {
    this.registry = registry;
    this.executors = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register('health.read', async () => ({ status: 'healthy', source: 'mock' }));
    this.register('health.recover', async (task) => {
      const { service } = task.parameters || {};
      if (!service) throw new Error('service is required for recovery');
      return { status: 'recovered', service };
    });
    this.register('test.run', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('build.run', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('git.local', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('docker.local', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('wsl.local', async (task) => this.runShell(task.parameters?.command));
    this.register('database.local', async () => ({ status: 'skipped', reason: 'no runner configured' }));
    this.register('deploy.production', async () => { throw new Error('Production deployment requires explicit override'); });
    this.register('credential.production', async () => { throw new Error('Production credential changes require explicit override'); });
    this.register('financial.transaction', async () => { throw new Error('Financial transactions require explicit override'); });
    this.register('database.destructive', async () => { throw new Error('Destructive database operations require explicit override'); });
  }

  register(capabilityId, fn) {
    this.executors.set(capabilityId, fn);
    return this;
  }

  async runShell(command) {
    if (!command) throw new Error('No command provided');
    const forbidden = ['rm -rf /', 'mkfs', 'dd if=', 'format c:'];
    if (forbidden.some(f => command.toLowerCase().includes(f.toLowerCase()))) {
      throw new Error('Command failed safety check');
    }
    const execAsync = promisify(exec);
    return execAsync(command, { timeout: 120000 });
  }

  async execute(task) {
    const capability = this.registry.get(task.capabilityId);
    if (!capability) throw new Error(`Unregistered capability: ${task.capabilityId}`);

    const fn = this.executors.get(task.capabilityId);
    if (!fn) throw new Error(`No executor for capability: ${task.capabilityId}`);

    const start = Date.now();
    let result;
    let error = null;
    let timer;
    try {
      result = await Promise.race([
        fn(task),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), capability.timeoutMs);
        }),
      ]);
    } catch (e) {
      error = e.message;
    } finally {
      clearTimeout(timer);
    }

    for (let i = 0; i < capability.retryPolicy.maxRetries && error; i++) {
      await this.delay(capability.retryPolicy.backoffMs * (i + 1));
      try {
        result = await fn(task);
        error = null;
        break;
      } catch (e) {
        error = e.message;
      }
    }

    return {
      success: !error,
      result: error ? null : result,
      error,
      duration: Date.now() - start,
    };
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { ControlledExecutor };
