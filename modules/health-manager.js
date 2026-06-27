/**
 * HYDI Health Manager
 *
 * Polls all registered services, detects failures, generates events,
 * and triggers recovery via the recovery engine.
 *
 * Responsibilities:
 *   - Poll /health endpoints (or in-process health) on a cadence
 *   - Detect status transitions (healthy -> suspect -> failed -> dead)
 *   - Emit health events into the event system
 *   - Trigger recovery playbooks when services fail
 *   - Maintain health history for trend analysis
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class HealthManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      pollInterval: 10000,          // 10s default poll
      fastPollInterval: 3000,       // 3s when service is suspect
      recoveryTimeout: 60000,       // 60s max recovery attempt
      maxRecoveryAttempts: 3,       // 3 strikes before escalation
      historyRetention: 100,        // snapshots per service
      ...config
    };

    this.registry = null;           // ServiceRegistry instance
    this.recoveryEngine = null;     // RecoveryEngine instance (optional)
    this.eventSystem = null;        // ProtoForgeEventSystem instance (optional)

    this.pollTimers = new Map();    // serviceId -> intervalId
    this.recoveryAttempts = new Map();// serviceId -> count
    this.healthSnapshots = new Map();// serviceId -> Array<snapshots>
    this.lastPoll = new Map();       // serviceId -> timestamp

    this.running = false;

    console.log('[HEALTH MANAGER] Initialized');
  }

  /**
   * Wire up dependencies
   */
  setRegistry(registry) {
    this.registry = registry;
    registry.on('service_heartbeat', (evt) => {
      this.storeSnapshot(evt.serviceId, evt.health);
    });
  }

  setRecoveryEngine(engine) {
    this.recoveryEngine = engine;
  }

  setEventSystem(eventSystem) {
    this.eventSystem = eventSystem;
  }

  /**
   * Start the health monitoring loop
   */
  start() {
    if (this.running) return;
    this.running = true;

    console.log('[HEALTH MANAGER] Starting health monitoring...');

    // Listen for registry events
    if (this.registry) {
      this.registry.on('service_registered', (evt) => {
        this.startPolling(evt.serviceId);
      });

      this.registry.on('service_unregistered', (evt) => {
        this.stopPolling(evt.serviceId);
      });

      this.registry.on('service_failed', (evt) => {
        this.handleServiceFailed(evt.serviceId, evt.reason);
      });

      this.registry.on('service_dead', (evt) => {
        this.handleServiceDead(evt.serviceId);
      });

      // Start polling for existing services
      for (const id of this.registry.services.keys()) {
        this.startPolling(id);
      }
    }

    // Global health sweep every pollInterval
    this.sweepTimer = setInterval(() => {
      this.globalHealthSweep();
    }, this.config.pollInterval);
  }

  /**
   * Stop the health manager
   */
  stop() {
    this.running = false;

    for (const [id, timer] of this.pollTimers) {
      clearInterval(timer);
    }
    this.pollTimers.clear();

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    console.log('[HEALTH MANAGER] Stopped');
  }

  /**
   * Start polling a specific service
   */
  startPolling(serviceId) {
    if (this.pollTimers.has(serviceId)) return;

    const record = this.registry.services.get(serviceId);
    if (!record) return;

    const isExternal = record.url || record.port;
    const interval = isExternal ? this.config.fastPollInterval : this.config.pollInterval;

    const timer = setInterval(async () => {
      await this.pollService(serviceId);
    }, interval);

    this.pollTimers.set(serviceId, timer);

    // Immediate first poll
    this.pollService(serviceId).catch(() => {});
  }

  /**
   * Stop polling a specific service
   */
  stopPolling(serviceId) {
    const timer = this.pollTimers.get(serviceId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(serviceId);
    }
    this.recoveryAttempts.delete(serviceId);
  }

  /**
   * Poll a single service and update registry
   */
  async pollService(serviceId) {
    const record = this.registry.services.get(serviceId);
    if (!record) return;

    this.lastPoll.set(serviceId, Date.now());

    let healthResult = null;

    try {
      if (record.url || record.port) {
        healthResult = await this.pollExternalService(record);
      } else {
        healthResult = await this.pollInternalService(record);
      }
    } catch (error) {
      healthResult = {
        status: 'failed',
        error: error.message,
        uptime: 0,
        memory: null,
        cpu: null
      };
    }

    // Update registry heartbeat
    this.registry.heartbeat(serviceId, healthResult);

    // Store snapshot
    this.storeSnapshot(serviceId, healthResult);

    // Check for state transitions
    this.evaluateStateTransition(serviceId, record, healthResult);
  }

  /**
   * Poll an external HTTP service
   */
  async pollExternalService(record) {
    const http = require('http');
    const https = require('https');

    const url = record.url || `http://localhost:${record.port}/health`;
    const protocol = url.startsWith('https') ? https : http;

    return new Promise((resolve, reject) => {
      const req = protocol.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              status: parsed.status || 'unknown',
              uptime: parsed.uptime || 0,
              memory: parsed.memory || null,
              cpu: parsed.cpu || null,
              raw: parsed
            });
          } catch {
            resolve({ status: 'healthy', uptime: 0, raw: data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Health poll timeout'));
      });
    });
  }

  /**
   * Poll an internal (in-process) service
   */
  async pollInternalService(record) {
    // For in-process modules, we can use process metrics or
    // call a health method if the module exposes one.
    const mem = process.memoryUsage ? process.memoryUsage() : null;

    return {
      status: record.status === 'failed' ? 'failed' : 'healthy',
      uptime: Date.now() - record.startedAt,
      memory: mem ? Math.round(mem.heapUsed / 1024 / 1024) : null, // MB
      cpu: null
    };
  }

  /**
   * Store a health snapshot
   */
  storeSnapshot(serviceId, healthResult) {
    if (!this.healthSnapshots.has(serviceId)) {
      this.healthSnapshots.set(serviceId, []);
    }

    const snaps = this.healthSnapshots.get(serviceId);
    snaps.push({
      timestamp: Date.now(),
      ...healthResult
    });

    if (snaps.length > this.config.historyRetention) {
      snaps.shift();
    }
  }

  /**
   * Evaluate if a service transitioned between health states
   */
  evaluateStateTransition(serviceId, record, healthResult) {
    const previousStatus = record.status;
    const newStatus = healthResult.status === 'failed' ? 'failed'
      : healthResult.status === 'suspect' ? 'suspect'
      : 'healthy';

    if (previousStatus === newStatus) return;

    const transition = {
      serviceId,
      previousStatus,
      newStatus,
      timestamp: Date.now()
    };

    this.emit('health_transition', transition);

    if (this.eventSystem) {
      this.eventSystem.publishSystemEvent('health_transition', transition, { priority: 'high' });
    }

    if (newStatus === 'failed') {
      this.handleServiceFailed(serviceId, healthResult.error || 'health check failed');
    }

    if (newStatus === 'healthy' && previousStatus === 'failed') {
      this.handleServiceRecovered(serviceId);
    }
  }

  /**
   * Handle a service failure
   */
  handleServiceFailed(serviceId, reason) {
    const attempts = (this.recoveryAttempts.get(serviceId) || 0) + 1;
    this.recoveryAttempts.set(serviceId, attempts);

    this.emit('service_failed', { serviceId, reason, attempt: attempts });

    if (this.eventSystem) {
      this.eventSystem.publishSystemEvent('service_failed', {
        serviceId,
        reason,
        attempt: attempts,
        timestamp: Date.now()
      }, { priority: 'high' });
    }

    if (attempts <= this.config.maxRecoveryAttempts && this.recoveryEngine) {
      console.log(`[HEALTH MANAGER] Triggering recovery for ${serviceId} (attempt ${attempts})`);
      this.recoveryEngine.recover(serviceId, reason);
    } else if (attempts > this.config.maxRecoveryAttempts) {
      console.error(`[HEALTH MANAGER] Max recovery attempts reached for ${serviceId}. Escalating.`);
      this.emit('escalation_required', { serviceId, reason, attempts });

      if (this.eventSystem) {
        this.eventSystem.publishSystemEvent('escalation_required', {
          serviceId,
          reason,
          attempts,
          timestamp: Date.now()
        }, { priority: 'critical' });
      }
    }
  }

  /**
   * Handle a service recovery
   */
  handleServiceRecovered(serviceId) {
    this.recoveryAttempts.set(serviceId, 0);

    this.emit('service_recovered', { serviceId, timestamp: Date.now() });

    if (this.eventSystem) {
      this.eventSystem.publishSystemEvent('service_recovered', {
        serviceId,
        timestamp: Date.now()
      }, { priority: 'medium' });
    }

    console.log(`[HEALTH MANAGER] Service recovered: ${serviceId}`);
  }

  /**
   * Handle a service marked dead by the registry
   */
  handleServiceDead(serviceId) {
    this.stopPolling(serviceId);

    this.emit('service_dead', { serviceId, timestamp: Date.now() });

    if (this.eventSystem) {
      this.eventSystem.publishSystemEvent('service_dead', {
        serviceId,
        timestamp: Date.now()
      }, { priority: 'critical' });
    }

    if (this.recoveryEngine) {
      this.recoveryEngine.recover(serviceId, 'dead');
    }
  }

  /**
   * Global sweep: check for services that haven't been polled recently
   */
  globalHealthSweep() {
    if (!this.registry) return;

    const now = Date.now();

    for (const [id, record] of this.registry.services) {
      const last = this.lastPoll.get(id);
      if (!last) continue;

      const elapsed = now - last;
      if (elapsed > this.config.pollInterval * 3 && record.status !== 'dead') {
        console.warn(`[HEALTH MANAGER] Service ${id} missed ${Math.round(elapsed / 1000)}s of polls`);
        this.registry.markFailed(id, 'missed_polls');
      }
    }
  }

  /**
   * Get health history for a service
   */
  getHealthHistory(serviceId) {
    return this.healthSnapshots.get(serviceId) || [];
  }

  /**
   * Get system-wide health summary
   */
  getSystemHealth() {
    const services = {};
    let healthy = 0, failed = 0, suspect = 0, dead = 0;

    for (const [id, record] of this.registry.services) {
      services[id] = {
        status: record.status,
        health: record.health,
        lastHeartbeat: record.lastHeartbeat,
        recoveryAttempts: this.recoveryAttempts.get(id) || 0
      };

      if (record.status === 'healthy') healthy++;
      else if (record.status === 'failed') failed++;
      else if (record.status === 'suspect') suspect++;
      else if (record.status === 'dead') dead++;
    }

    return {
      overall: failed > 0 || dead > 0 ? 'degraded' : 'healthy',
      total: this.registry.services.size,
      healthy,
      failed,
      suspect,
      dead,
      services,
      timestamp: Date.now()
    };
  }
}

module.exports = HealthManager;
