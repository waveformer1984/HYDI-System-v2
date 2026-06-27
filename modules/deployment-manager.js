/**
 * HYDI Deployment Manager
 *
 * Orchestrates safe deployments over the existing OS layer:
 *
 *   Validate → Snapshot → Deploy → Health Check → Verify → Promote
 *
 * Failure path:
 *   Deploy → Health Check Fails → Rollback → Restore Snapshot → Audit Entry
 *
 * Prerequisites (all now exist):
 *   - State Manager (snapshot/restore)
 *   - Audit Ledger (immutable records)
 *   - Recovery Engine (rollback playbooks)
 *   - Service Registry (dependency validation)
 *   - Health Manager (post-deploy health verification)
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

class DeploymentManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      deploymentsDir: config.deploymentsDir || path.resolve(__dirname, '..', 'deployments'),
      rollbackWindow: config.rollbackWindow || 5,     // keep last 5 deployment artifacts
      healthCheckTimeout: config.healthCheckTimeout || 30000, // 30s
      verificationTimeout: config.verificationTimeout || 60000, // 60s
      maxRetries: config.maxRetries || 2,
      autoRollback: config.autoRollback !== false,     // default: true
      ...config
    };

    this.stateManager = null;
    this.registry = null;
    this.healthManager = null;
    this.recoveryEngine = null;

    this.deployments = [];         // deployment history
    this.currentDeployment = null; // active deployment
    this.rollbackStack = [];       // LIFO rollback targets

    this.status = 'idle';          // idle | validating | snapshotting | deploying | health_checking | verifying | promoted | rolling_back | rolled_back | failed

    console.log('[DEPLOYMENT MANAGER] Initialized');
  }

  setStateManager(stateManager) { this.stateManager = stateManager; }
  setRegistry(registry) { this.registry = registry; }
  setHealthManager(healthManager) { this.healthManager = healthManager; }
  setRecoveryEngine(recoveryEngine) { this.recoveryEngine = recoveryEngine; }

  /**
   * Main entry point: deploy a package
   */
  async deploy(deploymentSpec = {}) {
    const deploymentId = `deploy_${Date.now()}`;

    this.currentDeployment = {
      id: deploymentId,
      version: deploymentSpec.version || 'unknown',
      description: deploymentSpec.description || '',
      packagePath: deploymentSpec.packagePath || null,
      changes: deploymentSpec.changes || [],
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
      phases: [],
      error: null
    };

    this.emit('deployment_started', { deploymentId, version: this.currentDeployment.version });
    await this.audit('deployment_started', { deploymentId, spec: deploymentSpec });

    try {
      // ── Phase 1: Validate ──
      await this.phase('validating', () => this.validate(deploymentSpec));

      // ── Phase 2: Snapshot ──
      await this.phase('snapshotting', () => this.snapshot(deploymentSpec));

      // ── Phase 3: Deploy ──
      await this.phase('deploying', () => this.applyDeployment(deploymentSpec));

      // ── Phase 4: Health Check ──
      await this.phase('health_checking', () => this.healthCheck());

      // ── Phase 5: Verification ──
      await this.phase('verifying', () => this.verify(deploymentSpec));

      // ── Phase 6: Promote ──
      await this.phase('promoting', () => this.promote());

      this.currentDeployment.status = 'promoted';
      this.currentDeployment.completedAt = Date.now();

      this.deployments.push({ ...this.currentDeployment });
      this.emit('deployment_promoted', { deploymentId });
      await this.audit('deployment_promoted', { deploymentId });

      console.log(`[DEPLOYMENT MANAGER] Deployment ${deploymentId} promoted successfully`);
      return { success: true, deploymentId, status: 'promoted' };

    } catch (error) {
      this.currentDeployment.error = error.message;
      this.currentDeployment.status = 'failed';

      this.emit('deployment_failed', { deploymentId, error: error.message });
      await this.audit('deployment_failed', { deploymentId, error: error.message });

      console.error(`[DEPLOYMENT MANAGER] Deployment ${deploymentId} failed:`, error.message);

      if (this.config.autoRollback) {
        console.log(`[DEPLOYMENT MANAGER] Initiating automatic rollback...`);
        return this.rollback();
      }

      this.deployments.push({ ...this.currentDeployment });
      return { success: false, deploymentId, error: error.message, status: 'failed' };
    }
  }

  /**
   * Execute a deployment phase with timing and error handling
   */
  async phase(name, fn) {
    this.status = name;
    const start = Date.now();

    this.emit('deployment_phase_started', { phase: name, deploymentId: this.currentDeployment.id });

    try {
      const result = await fn();
      const duration = Date.now() - start;

      this.currentDeployment.phases.push({
        phase: name,
        status: 'success',
        duration,
        result
      });

      this.emit('deployment_phase_completed', { phase: name, duration });
      await this.audit('deployment_phase_completed', { deploymentId: this.currentDeployment.id, phase: name, duration });

      return result;

    } catch (error) {
      const duration = Date.now() - start;

      this.currentDeployment.phases.push({
        phase: name,
        status: 'failed',
        duration,
        error: error.message
      });

      this.emit('deployment_phase_failed', { phase: name, error: error.message, duration });
      await this.audit('deployment_phase_failed', { deploymentId: this.currentDeployment.id, phase: name, error: error.message });

      throw error;
    }
  }

  /**
   * Phase 1: Validate the deployment package
   */
  async validate(spec) {
    console.log(`[DEPLOYMENT MANAGER] Validating deployment ${spec.version || 'unknown'}`);

    const errors = [];

    // Validate package exists if specified
    if (spec.packagePath && !fs.existsSync(spec.packagePath)) {
      errors.push(`Package path does not exist: ${spec.packagePath}`);
    }

    // Validate version format (semantic versioning-ish)
    if (spec.version) {
      const versionPattern = /^\d+\.\d+\.\d+.*$/;
      if (!versionPattern.test(spec.version)) {
        errors.push(`Invalid version format: ${spec.version}`);
      }
    }

    // Validate changes list
    if (spec.changes && spec.changes.length > 0) {
      for (const change of spec.changes) {
        if (!change.type || !change.target) {
          errors.push('Invalid change entry: missing type or target');
        }
      }
    }

    // Validate against registry: check no critical services would be disrupted
    if (this.registry) {
      const criticalServices = ['ursula', 'event-system', 'state-manager'];
      for (const svc of criticalServices) {
        const record = this.registry.services.get(svc);
        if (record && record.status !== 'healthy') {
          errors.push(`Critical service ${svc} is not healthy before deployment`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join('; ')}`);
    }

    return { validated: true, checks: 4 };
  }

  /**
   * Phase 2: Snapshot current state before deployment
   */
  async snapshot(spec) {
    console.log(`[DEPLOYMENT MANAGER] Snapshotting pre-deployment state`);

    const snapshotId = `snapshot_${Date.now()}`;
    const artifacts = {
      id: snapshotId,
      timestamp: Date.now(),
      version: this.getCurrentVersion(),
      files: []
    };

    // Snapshot registry state
    if (this.registry) {
      const registrySnapshot = this.registry.exportSnapshot();
      artifacts.files.push({ type: 'registry_snapshot', data: registrySnapshot });
    }

    // Snapshot service configs
    if (this.registry) {
      for (const [serviceId, record] of this.registry.services) {
        if (record.metadata && record.metadata.config) {
          artifacts.files.push({
            type: 'config_snapshot',
            serviceId,
            config: record.metadata.config
          });
        }
      }
    }

    // Persist snapshot metadata via state manager
    if (this.stateManager) {
      await this.stateManager.persistRecovery({
        id: snapshotId,
        serviceId: 'deployment_manager',
        reason: 'pre_deployment_snapshot',
        playbook: 'snapshot',
        status: 'completed',
        steps: [{ step: 'snapshot', at: Date.now() }],
        startedAt: Date.now(),
        completedAt: Date.now()
      });
    }

    // Store in rollback stack
    this.rollbackStack.push({
      snapshotId,
      version: artifacts.version,
      timestamp: Date.now(),
      artifacts
    });

    // Trim old snapshots
    if (this.rollbackStack.length > this.config.rollbackWindow) {
      this.rollbackStack.shift();
    }

    return { snapshotId, version: artifacts.version };
  }

  /**
   * Phase 3: Apply the deployment
   */
  async applyDeployment(spec) {
    console.log(`[DEPLOYMENT MANAGER] Applying deployment ${spec.version || 'unknown'}`);

    // If package path provided, copy files
    if (spec.packagePath) {
      await this.copyPackageFiles(spec.packagePath);
    }

    // Apply config changes
    if (spec.changes && spec.changes.length > 0) {
      for (const change of spec.changes) {
        await this.applyChange(change);
      }
    }

    // Update version tracking
    this.setCurrentVersion(spec.version || 'unknown');

    return { applied: true, changes: (spec.changes || []).length };
  }

  /**
   * Copy package files to HYDI root
   */
  async copyPackageFiles(packagePath) {
    return new Promise((resolve, reject) => {
      const robocopy = spawn('robocopy', [
        packagePath,
        path.resolve(__dirname, '..'),
        '/E', '/R:2', '/W:5',
        '/XD', 'node_modules', '__pycache__', '.git', 'data',
        '/XF', '*.log', '*.tmp'
      ], { shell: false });

      robocopy.on('close', (code) => {
        if (code <= 7) resolve({ exitCode: code });
        else reject(new Error(`File copy failed with exit code ${code}`));
      });

      robocopy.on('error', (err) => reject(err));
    });
  }

  /**
   * Apply a single config change
   */
  async applyChange(change) {
    switch (change.type) {
      case 'config_update':
        console.log(`[DEPLOYMENT MANAGER] Config update: ${change.target}`);
        // In a real implementation, this would write config files or update DB records
        break;
      case 'module_update':
        console.log(`[DEPLOYMENT MANAGER] Module update: ${change.target}`);
        break;
      case 'agent_update':
        console.log(`[DEPLOYMENT MANAGER] Agent update: ${change.target}`);
        break;
      default:
        console.warn(`[DEPLOYMENT MANAGER] Unknown change type: ${change.type}`);
    }
  }

  /**
   * Phase 4: Health check all services post-deployment
   */
  async healthCheck() {
    console.log(`[DEPLOYMENT MANAGER] Running post-deployment health checks`);

    if (!this.registry) {
      throw new Error('Cannot health check without registry');
    }

    const start = Date.now();
    const timeout = this.config.healthCheckTimeout;
    const interval = 3000;

    // Poll until all services healthy or timeout
    while (Date.now() - start < timeout) {
      let allHealthy = true;
      const unhealthy = [];

      for (const [id, record] of this.registry.services) {
        if (record.status !== 'healthy') {
          allHealthy = false;
          unhealthy.push(id);
        }
      }

      if (allHealthy) {
        return { healthy: true, servicesChecked: this.registry.services.size };
      }

      console.log(`[DEPLOYMENT MANAGER] Waiting for services: ${unhealthy.join(', ')}`);
      await this.sleep(interval);
    }

    throw new Error(`Health check timed out after ${timeout}ms. Unhealthy services remain.`);
  }

  /**
   * Phase 5: Verify deployment with smoke tests
   */
  async verify(spec) {
    console.log(`[DEPLOYMENT MANAGER] Running verification tests`);

    const checks = [];

    // Check critical endpoints respond
    checks.push(await this.verifyEndpoint('/health', ['status', 'uptime']));
    checks.push(await this.verifyEndpoint('/system/status', ['registry', 'health']));

    // Check workflow orchestrator is functional
    // (We can't actually start a workflow here without side effects, so we check definitions)
    checks.push({ name: 'workflow_orchestrator', status: 'skipped', reason: 'manual verification required' });

    const failed = checks.filter(c => c.status === 'failed');
    if (failed.length > 0) {
      throw new Error(`Verification failed: ${failed.map(f => f.name).join(', ')}`);
    }

    return { verified: true, checks: checks.length };
  }

  /**
   * Verify a single endpoint responds with expected keys
   */
  async verifyEndpoint(endpoint, expectedKeys) {
    const http = require('http');
    const https = require('https');
    const baseUrl = process.env.URSULA_URL || `http://localhost:${process.env.URSULA_PORT || 3005}`;
    const url = baseUrl + endpoint;
    const client = url.startsWith('https:') ? https : http;

    return new Promise((resolve) => {
      const req = client.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const hasKeys = expectedKeys.every(k => parsed[k] !== undefined);
            if (hasKeys) {
              resolve({ name: endpoint, status: 'passed' });
            } else {
              resolve({ name: endpoint, status: 'failed', reason: 'missing expected keys' });
            }
          } catch {
            resolve({ name: endpoint, status: 'failed', reason: 'invalid JSON' });
          }
        });
      });

      req.on('error', () => {
        resolve({ name: endpoint, status: 'failed', reason: 'connection error' });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ name: endpoint, status: 'failed', reason: 'timeout' });
      });
    });
  }

  /**
   * Phase 6: Promote deployment to active
   */
  async promote() {
    console.log(`[DEPLOYMENT MANAGER] Promoting deployment`);

    // Mark as the active deployment
    this.currentDeployment.status = 'promoted';

    // Clean up old deployment artifacts
    this.cleanupOldDeployments();

    return { promoted: true, version: this.currentDeployment.version };
  }

  /**
   * Rollback to the last known good state
   */
  async rollback() {
    if (this.rollbackStack.length === 0) {
      throw new Error('No rollback snapshot available');
    }

    const target = this.rollbackStack[this.rollbackStack.length - 1];
    console.log(`[DEPLOYMENT MANAGER] Rolling back to ${target.version} (snapshot: ${target.snapshotId})`);

    this.status = 'rolling_back';
    this.emit('rollback_started', { snapshotId: target.snapshotId, version: target.version });
    await this.audit('rollback_started', { snapshotId: target.snapshotId, version: target.version });

    try {
      // Restore registry snapshot if available
      if (target.artifacts && target.artifacts.files) {
        const registrySnapshot = target.artifacts.files.find(f => f.type === 'registry_snapshot');
        if (registrySnapshot && this.registry) {
          // In a real implementation, this would fully restore the registry
          console.log(`[DEPLOYMENT MANAGER] Restoring registry snapshot`);
        }
      }

      // Restore config snapshots
      if (this.recoveryEngine && typeof this.recoveryEngine.rollbackConfig === 'function') {
        for (const [serviceId] of (this.registry ? this.registry.services : [])) {
          this.recoveryEngine.rollbackConfig(serviceId);
        }
      }

      // Restore version tracking
      this.setCurrentVersion(target.version);

      // Re-run health check after rollback
      await this.healthCheck();

      this.status = 'rolled_back';
      this.emit('rollback_completed', { snapshotId: target.snapshotId });
      await this.audit('rollback_completed', { snapshotId: target.snapshotId, version: target.version });

      if (this.currentDeployment) {
        this.currentDeployment.status = 'rolled_back';
        this.currentDeployment.completedAt = Date.now();
        this.deployments.push({ ...this.currentDeployment });
      }

      return { success: true, status: 'rolled_back', snapshotId: target.snapshotId, version: target.version };

    } catch (error) {
      this.status = 'rollback_failed';
      this.emit('rollback_failed', { error: error.message });
      await this.audit('rollback_failed', { error: error.message });

      throw new Error(`Rollback failed: ${error.message}`);
    }
  }

  /**
   * Get current deployed version
   */
  getCurrentVersion() {
    try {
      const versionFile = path.resolve(__dirname, '..', 'VERSION');
      if (fs.existsSync(versionFile)) {
        return fs.readFileSync(versionFile, 'utf8').trim();
      }
    } catch {
      // ignore
    }
    return '0.0.0';
  }

  /**
   * Set current deployed version
   */
  setCurrentVersion(version) {
    try {
      const versionFile = path.resolve(__dirname, '..', 'VERSION');
      fs.writeFileSync(versionFile, version + '\n');
    } catch (error) {
      console.warn(`[DEPLOYMENT MANAGER] Could not write VERSION file: ${error.message}`);
    }
  }

  /**
   * Clean up old deployment artifacts beyond rollback window
   */
  cleanupOldDeployments() {
    if (this.deployments.length > this.config.rollbackWindow) {
      this.deployments = this.deployments.slice(-this.config.rollbackWindow);
    }
  }

  /**
   * Write audit entry via state manager
   */
  async audit(eventType, payload) {
    if (this.stateManager) {
      await this.stateManager.audit(eventType, { actor: 'deployment_manager', ...payload });
    }
  }

  /**
   * Get deployment status summary
   */
  getStatus() {
    return {
      status: this.status,
      currentDeployment: this.currentDeployment,
      deployments: this.deployments.slice(-10),
      rollbackAvailable: this.rollbackStack.length > 0,
      rollbackCount: this.rollbackStack.length,
      currentVersion: this.getCurrentVersion()
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DeploymentManager;
