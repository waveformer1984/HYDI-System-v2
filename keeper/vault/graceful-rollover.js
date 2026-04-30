/**
 * Graceful Secret Rollover System
 * Because "secure rotation" becomes "self-inflicted outage" without this
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class GracefulRollover extends EventEmitter {
  constructor(vault, options = {}) {
    super();
    
    this.vault = vault;
    this.options = {
      dualKeyWindow: options.dualKeyWindow || 30 * 60 * 1000, // 30 minutes
      workerRefreshInterval: options.workerRefreshInterval || 5 * 60 * 1000, // 5 minutes
      forceRefreshAfter: options.forceRefreshAfter || 20 * 60 * 1000, // 20 minutes
      ...options
    };
    
    this.rollovers = new Map();
    this.workerRegistry = new Map();
    this.refreshQueue = [];
    this.isProcessing = false;
    
    // Start periodic checks
    this.startPeriodicChecks();
  }

  /**
   * Initiate graceful rollover
   */
  async initiateRollover(secretKey, newValue, metadata = {}) {
    const rolloverId = this.generateRolloverId();
    
    console.log(`[ROLLOVER] Initiating graceful rollover for ${secretKey}`);
    
    try {
      // Get current active version
      const current = await this.vault.getVersion(secretKey, await this.vault.getActiveVersion(secretKey));
      
      // Create new version
      const newVersion = await this.vault.set(secretKey, newValue, {
        ...metadata,
        rolloverId,
        previousVersion: current.version,
        status: 'activating'
      });
      
      // Track rollover
      this.rollovers.set(rolloverId, {
        secretKey,
        oldVersion: current.version,
        newVersion,
        status: 'dual_active',
        startedAt: Date.now(),
        workersRefreshed: new Set(),
        metadata
      });
      
      // Enable dual-key mode
      await this.enableDualKeyMode(secretKey, current.version, newVersion);
      
      // Start worker refresh process
      this.startWorkerRefresh(rolloverId);
      
      // Schedule deactivation of old key
      this.scheduleDeactivation(rolloverId);
      
      this.emit('rolloverStarted', rolloverId, secretKey);
      
      return {
        rolloverId,
        oldVersion: current.version,
        newVersion,
        estimatedCompletion: Date.now() + this.options.dualKeyWindow
      };
      
    } catch (error) {
      console.error(`[ROLLOVER] Failed to initiate rollover for ${secretKey}:`, error);
      throw error;
    }
  }

  /**
   * Enable dual-key mode (both old and new valid)
   */
  async enableDualKeyMode(secretKey, oldVersion, newVersion) {
    // In a real implementation, this would update the vault's validation logic
    // to accept both versions during the rollover window
    
    console.log(`[ROLLOVER] Dual-key mode enabled for ${secretKey}: v${oldVersion} + v${newVersion}`);
    
    // Store dual-key state
    await this.vault.set(`${secretKey}_dual_mode`, {
      enabled: true,
      oldVersion,
      newVersion,
      expiresAt: Date.now() + this.options.dualKeyWindow
    });
  }

  /**
   * Start refreshing all workers
   */
  async startWorkerRefresh(rolloverId) {
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover) return;
    
    console.log(`[ROLLOVER] Starting worker refresh for rollover ${rolloverId}`);
    
    // Get all active workers
    const workers = await this.getActiveWorkers();
    
    // Refresh workers in batches
    const batchSize = 5;
    for (let i = 0; i < workers.length; i += batchSize) {
      const batch = workers.slice(i, i + batchSize);
      await this.refreshWorkerBatch(batch, rolloverId);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Refresh a batch of workers
   */
  async refreshWorkerBatch(workers, rolloverId) {
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover) return;
    
    const refreshPromises = workers.map(worker => 
      this.refreshWorker(worker, rolloverId).catch(err => {
        console.error(`[ROLLOVER] Failed to refresh worker ${worker.id}:`, err);
        return { worker, error: err.message };
      })
    );
    
    const results = await Promise.all(refreshPromises);
    
    // Track successful refreshes
    results.forEach(result => {
      if (!result.error) {
        rollover.workersRefreshed.add(result.worker.id);
      }
    });
    
    // Check if all workers refreshed
    if (rollover.workersRefreshed.size >= workers.length) {
      await this.allWorkersRefreshed(rolloverId);
    }
  }

  /**
   * Refresh individual worker
   */
  async refreshWorker(worker, rolloverId) {
    console.log(`[ROLLOVER] Refreshing worker ${worker.id}`);
    
    // Send refresh signal to worker
    const response = await this.sendWorkerCommand(worker.id, {
      type: 'refresh_secrets',
      rolloverId,
      secrets: [this.rollovers.get(rolloverId).secretKey],
      timeout: 10000
    });
    
    if (response.success) {
      this.workerRegistry.set(worker.id, {
        ...worker,
        lastRefresh: Date.now(),
        rolloverIds: [...(worker.rolloverIds || []), rolloverId]
      });
    }
    
    return response;
  }

  /**
   * Handle all workers refreshed
   */
  async allWorkersRefreshed(rolloverId) {
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover || rollover.status !== 'dual_active') return;
    
    console.log(`[ROLLOVER] All workers refreshed for rollover ${rolloverId}`);
    
    // Can now deactivate old version sooner if needed
    // Or wait for the full window for safety
    rollover.status = 'ready_to_deactivate';
    
    this.emit('workersRefreshed', rolloverId);
  }

  /**
   * Schedule deactivation of old key
   */
  scheduleDeactivation(rolloverId) {
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover) return;
    
    const deactivateAt = rollover.startedAt + this.options.dualKeyWindow;
    
    setTimeout(async () => {
      await this.deactivateOldVersion(rolloverId);
    }, deactivateAt - Date.now());
    
    // Also check if we can deactivate early
    const earlyCheck = setInterval(async () => {
      const r = this.rollovers.get(rolloverId);
      if (!r || r.status === 'completed') {
        clearInterval(earlyCheck);
        return;
      }
      
      if (r.status === 'ready_to_deactivate' || 
          (Date.now() - r.startedAt > this.options.forceRefreshAfter)) {
        clearInterval(earlyCheck);
        await this.deactivateOldVersion(rolloverId);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Deactivate old version
   */
  async deactivateOldVersion(rolloverId) {
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover || rollover.status === 'completed') return;
    
    try {
      console.log(`[ROLLOVER] Deactivating old version v${rollover.oldVersion}`);
      
      // Deactivate old version
      await this.vault.deactivateVersion(rollover.secretKey, rollover.oldVersion);
      
      // Disable dual-key mode
      await this.vault.delete(`${rollover.secretKey}_dual_mode`);
      
      // Update status
      rollover.status = 'completed';
      rollover.completedAt = Date.now();
      
      // Clean up after delay
      setTimeout(() => {
        this.rollovers.delete(rolloverId);
      }, 60000); // Keep for 1 minute for queries
      
      this.emit('rolloverCompleted', rolloverId, rollover);
      
      console.log(`[ROLLOVER] Rollover ${rolloverId} completed successfully`);
      
    } catch (error) {
      console.error(`[ROLLOVER] Failed to deactivate old version:`, error);
      rollover.status = 'deactivation_failed';
      this.emit('rolloverFailed', rolloverId, error);
    }
  }

  /**
   * Get active version with dual-key support
   */
  async getActiveVersion(secretKey) {
    // Check if in dual-key mode
    try {
      const dualMode = await this.vault.get(`${secretKey}_dual_mode`);
      
      if (dualMode.enabled && Date.now() < dualMode.expiresAt) {
        // Return both versions during rollover
        return {
          dual: true,
          primary: dualMode.newVersion,
          secondary: dualMode.oldVersion,
          expiresAt: dualMode.expiresAt
        };
      }
    } catch {
      // Not in dual-key mode
    }
    
    // Return single active version
    return {
      dual: false,
      primary: await this.vault.getActiveVersion(secretKey)
    };
  }

  /**
   * Force refresh all workers for a secret
   */
  async forceRefresh(secretKey) {
    console.log(`[ROLLOVER] Force refreshing all workers for ${secretKey}`);
    
    const workers = await this.getActiveWorkers();
    const results = [];
    
    for (const worker of workers) {
      try {
        const result = await this.sendWorkerCommand(worker.id, {
          type: 'force_refresh',
          secrets: [secretKey],
          timeout: 5000
        });
        results.push({ worker: worker.id, success: true });
      } catch (error) {
        results.push({ worker: worker.id, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Check rollover status
   */
  getRolloverStatus(rolloverId = null) {
    if (rolloverId) {
      const rollover = this.rollovers.get(rolloverId);
      if (!rollover) return null;
      
      return {
        ...rollover,
        progress: {
          workersRefreshed: rollover.workersRefreshed.size,
          totalWorkers: this.workerRegistry.size,
          percentage: (rollover.workersRefreshed.size / Math.max(this.workerRegistry.size, 1)) * 100
        }
      };
    }
    
    // Return all active rollovers
    const all = {};
    for (const [id, rollover] of this.rollovers) {
      all[id] = {
        secretKey: rollover.secretKey,
        status: rollover.status,
        startedAt: rollover.startedAt,
        workersRefreshed: rollover.workersRefreshed.size
      };
    }
    
    return all;
  }

  /**
   * Emergency rollback
   */
  async emergencyRollback(rolloverId, reason) {
    console.log(`[ROLLOVER] Emergency rollback for rollover ${rolloverId}: ${reason}`);
    
    const rollover = this.rollovers.get(rolloverId);
    if (!rollover) {
      throw new Error('Rollover not found');
    }
    
    try {
      // Switch back to old version
      await this.vault.switchVersion(rollover.secretKey, rollover.oldVersion, `emergency_rollback: ${reason}`);
      
      // Mark new version as inactive
      await this.vault.deactivateVersion(rollover.secretKey, rollover.newVersion);
      
      // Force refresh all workers
      await this.forceRefresh(rollover.secretKey);
      
      // Update status
      rollover.status = 'rolled_back';
      rollover.rolledBackAt = Date.now();
      rollover.rollbackReason = reason;
      
      this.emit('emergencyRollback', rolloverId, reason);
      
      console.log(`[ROLLOVER] Emergency rollback completed`);
      
    } catch (error) {
      console.error(`[ROLLOVER] Emergency rollback failed:`, error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  generateRolloverId() {
    return 'rollover_' + crypto.randomBytes(16).toString('hex');
  }

  async getActiveWorkers() {
    // In real implementation, query worker registry
    return Array.from(this.workerRegistry.values());
  }

  async sendWorkerCommand(workerId, command) {
    // In real implementation, send command to worker via IPC/message queue
    return new Promise((resolve) => {
      // Simulate worker response
      setTimeout(() => {
        resolve({ success: true, workerId, command: command.type });
      }, 100);
    });
  }

  startPeriodicChecks() {
    // Check for stuck rollovers every minute
    setInterval(() => {
      this.checkStuckRollovers();
    }, 60000);
    
    // Clean up old data every hour
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000);
  }

  async checkStuckRollovers() {
    const now = Date.now();
    const stuckThreshold = this.options.dualKeyWindow * 2; // 2x the normal window
    
    for (const [id, rollover] of this.rollovers) {
      if (rollover.status === 'dual_active' && 
          now - rollover.startedAt > stuckThreshold) {
        console.warn(`[ROLLOVER] Detected stuck rollover ${id}, attempting recovery`);
        
        // Try to force completion
        await this.deactivateOldVersion(id);
      }
    }
  }

  async cleanupOldData() {
    // Clean up worker registry
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [id, worker] of this.workerRegistry) {
      if (worker.lastRefresh && worker.lastRefresh < cutoff) {
        this.workerRegistry.delete(id);
      }
    }
  }
}

module.exports = GracefulRollover;
