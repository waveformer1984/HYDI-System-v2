/**
 * HYDI Recovery Engine
 *
 * Self-healing layer for the operating system.
 *
 * Capabilities:
 *   - Restart failed services
 *   - Rollback bad deployments
 *   - Restore configs
 *   - Trigger backups
 *   - Validate dependencies
 *
 * Recovery Playbook:
 *   Service Down
 *     -> Restart
 *     -> Recheck
 *     -> Rollback
 *     -> Escalate
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class RecoveryEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      maxRetries: 3,
      retryDelay: 5000,
      rollbackWindow: 10,         // Keep last 10 config backups
      backupDir: path.resolve(__dirname, '..', 'recovery_backups'),
      checkInterval: 30000,         // 30s recheck after recovery
      ...config
    };

    this.registry = null;
    this.eventSystem = null;
    this.playbooks = new Map();     // failureType -> recovery playbook
    this.recoveryLog = [];            // history of recovery attempts
    this.pendingRecoveries = new Set(); // serviceIds currently being recovered

    this.initializePlaybooks();

    console.log('[RECOVERY ENGINE] Initialized');
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setEventSystem(eventSystem) {
    this.eventSystem = eventSystem;
  }

  /**
   * Define built-in recovery playbooks
   */
  initializePlaybooks() {
    this.playbooks.set('default', this.defaultPlaybook.bind(this));
    this.playbooks.set('missed_polls', this.restartPlaybook.bind(this));
    this.playbooks.set('health_check_failed', this.restartPlaybook.bind(this));
    this.playbooks.set('dead', this.restartPlaybook.bind(this));
    this.playbooks.set('config_corrupt', this.rollbackPlaybook.bind(this));
    this.playbooks.set('dependency_failed', this.dependencyPlaybook.bind(this));
    this.playbooks.set('memory_leak', this.restartPlaybook.bind(this));
  }

  /**
   * Main entry point: recover a service
   */
  async recover(serviceId, reason = 'unknown') {
    if (this.pendingRecoveries.has(serviceId)) {
      console.log(`[RECOVERY ENGINE] Recovery already in progress for ${serviceId}`);
      return { status: 'already_in_progress' };
    }

    this.pendingRecoveries.add(serviceId);

    const record = this.registry ? this.registry.services.get(serviceId) : null;
    const playbookName = this.resolvePlaybook(reason, record);
    const playbook = this.playbooks.get(playbookName) || this.playbooks.get('default');

    console.log(`[RECOVERY ENGINE] Starting recovery for ${serviceId} (reason: ${reason}, playbook: ${playbookName})`);

    const attempt = {
      id: `recovery_${Date.now()}_${serviceId}`,
      serviceId,
      reason,
      playbook: playbookName,
      startedAt: Date.now(),
      steps: [],
      status: 'running'
    };

    this.recoveryLog.push(attempt);

    try {
      const result = await playbook(serviceId, reason, attempt);
      attempt.status = result.success ? 'success' : 'failed';
      attempt.result = result;
      attempt.completedAt = Date.now();

      if (result.success) {
        this.emit('recovery_success', { serviceId, attempt });
        this.publishEvent('recovery_success', { serviceId, reason, attempt: attempt.id });
      } else {
        this.emit('recovery_failed', { serviceId, attempt, reason: result.reason });
        this.publishEvent('recovery_failed', { serviceId, reason, attempt: attempt.id, failureReason: result.reason });
      }

      return result;
    } catch (error) {
      attempt.status = 'error';
      attempt.error = error.message;
      attempt.completedAt = Date.now();

      this.emit('recovery_error', { serviceId, error: error.message });
      this.publishEvent('recovery_error', { serviceId, reason, error: error.message });

      return { success: false, reason: error.message };
    } finally {
      this.pendingRecoveries.delete(serviceId);
    }
  }

  /**
   * Resolve which playbook to run based on reason and service metadata
   */
  resolvePlaybook(reason, record) {
    if (this.playbooks.has(reason)) return reason;
    if (record && record.metadata && record.metadata.playbook) {
      return record.metadata.playbook;
    }
    return 'default';
  }

  /**
   * Default recovery: try restart, then escalate
   */
  async defaultPlaybook(serviceId, reason, attempt) {
    attempt.steps.push({ step: 'restart', at: Date.now() });
    const restartResult = await this.restartService(serviceId);

    if (restartResult.success) {
      attempt.steps.push({ step: 'recheck', at: Date.now() });
      const recheck = await this.recheckService(serviceId);

      if (recheck.healthy) {
        return { success: true, action: 'restart', message: 'Service restarted and healthy' };
      }
    }

    attempt.steps.push({ step: 'escalate', at: Date.now() });
    return { success: false, action: 'escalate', reason: 'Restart and recheck failed' };
  }

  /**
   * Restart playbook: force restart then recheck
   */
  async restartPlaybook(serviceId, reason, attempt) {
    attempt.steps.push({ step: 'restart', at: Date.now() });
    const restartResult = await this.restartService(serviceId);

    if (restartResult.success) {
      attempt.steps.push({ step: 'recheck', at: Date.now() });
      const recheck = await this.recheckService(serviceId);

      if (recheck.healthy) {
        return { success: true, action: 'restart', message: 'Service restarted successfully' };
      }
    }

    attempt.steps.push({ step: 'escalate', at: Date.now() });
    return { success: false, action: 'escalate', reason: restartResult.error || 'Restart failed' };
  }

  /**
   * Rollback playbook: restore last known good config
   */
  async rollbackPlaybook(serviceId, reason, attempt) {
    attempt.steps.push({ step: 'rollback', at: Date.now() });
    const rollbackResult = await this.rollbackConfig(serviceId);

    if (rollbackResult.success) {
      attempt.steps.push({ step: 'restart', at: Date.now() });
      await this.restartService(serviceId);

      attempt.steps.push({ step: 'recheck', at: Date.now() });
      const recheck = await this.recheckService(serviceId);

      if (recheck.healthy) {
        return { success: true, action: 'rollback', message: 'Config restored and service healthy' };
      }
    }

    attempt.steps.push({ step: 'escalate', at: Date.now() });
    return { success: false, action: 'escalate', reason: rollbackResult.error || 'Rollback failed' };
  }

  /**
   * Dependency playbook: try to restart missing dependencies first
   */
  async dependencyPlaybook(serviceId, reason, attempt) {
    const record = this.registry ? this.registry.services.get(serviceId) : null;
    if (!record) {
      return { success: false, reason: 'Service not in registry' };
    }

    const deps = Array.from(record.dependencies || []);
    attempt.steps.push({ step: 'check_dependencies', dependencies: deps, at: Date.now() });

    for (const depId of deps) {
      const dep = this.registry.services.get(depId);
      if (!dep || dep.status !== 'healthy') {
        console.log(`[RECOVERY ENGINE] Recovering dependency ${depId} for ${serviceId}`);
        await this.recover(depId, 'dependency_failed');
      }
    }

    // Now restart the original service
    return this.restartPlaybook(serviceId, reason, attempt);
  }

  /**
   * Restart a service by its configured restart command
   */
  async restartService(serviceId) {
    const record = this.registry ? this.registry.services.get(serviceId) : null;
    if (!record) {
      return { success: false, error: 'Service not found in registry' };
    }

    const restartCmd = record.metadata && record.metadata.restartCommand
      ? record.metadata.restartCommand
      : null;

    if (restartCmd) {
      return this.executeCommand(restartCmd, serviceId);
    }

    // If it's an external URL/port, we can't directly restart it
    if (record.url || record.port) {
      console.warn(`[RECOVERY ENGINE] External service ${serviceId} has no restart command; cannot auto-restart`);
      return { success: false, error: 'No restart command configured for external service' };
    }

    // For in-process modules, signal a restart request
    this.emit('restart_requested', { serviceId, record });
    return { success: true, message: 'Restart request emitted; in-process restart required' };
  }

  /**
   * Execute a shell command to restart/recover a service
   */
  executeCommand(command, serviceId) {
    return new Promise((resolve) => {
      const child = spawn(command, { shell: true, detached: true });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          resolve({ success: false, error: `Exit code ${code}`, stderr, stdout });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      // Timeout after 30s
      setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ success: false, error: 'Restart command timed out' });
      }, 30000);
    });
  }

  /**
   * Recheck a service after recovery attempt
   */
  async recheckService(serviceId) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const record = this.registry ? this.registry.services.get(serviceId) : null;
        if (!record) {
          resolve({ healthy: false, reason: 'Service not in registry' });
          return;
        }

        if (record.status === 'healthy') {
          resolve({ healthy: true, status: record.status });
        } else {
          resolve({ healthy: false, status: record.status });
        }
      }, this.config.checkInterval);
    });
  }

  /**
   * Rollback configuration for a service
   */
  async rollbackConfig(serviceId) {
    const backupPath = path.join(this.config.backupDir, `${serviceId}_config_backup.json`);

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'No backup available for rollback' };
    }

    try {
      const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

      // Emit rollback event so the service can consume its restored config
      this.emit('config_rollback', { serviceId, config: backupData });

      return { success: true, message: 'Config restored from backup' };
    } catch (error) {
      return { success: false, error: `Rollback failed: ${error.message}` };
    }
  }

  /**
   * Snapshot current service config for future rollback
   */
  snapshotConfig(serviceId, configData) {
    try {
      if (!fs.existsSync(this.config.backupDir)) {
        fs.mkdirSync(this.config.backupDir, { recursive: true });
      }

      const backupPath = path.join(this.config.backupDir, `${serviceId}_config_backup.json`);
      fs.writeFileSync(backupPath, JSON.stringify(configData, null, 2));

      console.log(`[RECOVERY ENGINE] Config snapshot saved for ${serviceId}`);
      return { success: true };
    } catch (error) {
      console.error(`[RECOVERY ENGINE] Failed to snapshot config for ${serviceId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Publish an event to the event system if available
   */
  publishEvent(topic, payload) {
    if (this.eventSystem && this.eventSystem.publishSystemEvent) {
      this.eventSystem.publishSystemEvent(topic, payload, { priority: 'high' });
    }
  }

  /**
   * Get recovery statistics
   */
  getStats() {
    const total = this.recoveryLog.length;
    const successes = this.recoveryLog.filter(r => r.status === 'success').length;
    const failures = this.recoveryLog.filter(r => r.status === 'failed' || r.status === 'error').length;
    const pending = this.pendingRecoveries.size;

    return {
      total,
      successes,
      failures,
      pending,
      recentAttempts: this.recoveryLog.slice(-10)
    };
  }
}

module.exports = RecoveryEngine;
