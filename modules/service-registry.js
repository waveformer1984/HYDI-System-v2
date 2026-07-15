/**
 * HYDI Unified Service Registry
 *
 * Every component registers itself here. The registry becomes the single
 * source of truth for:
 *   - dependency graphs
 *   - startup sequencing
 *   - health awareness
 *   - failover logic
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class ServiceRegistry extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      heartbeatTimeout: 30000,     // 30s without heartbeat = suspect
      heartbeatDead: 60000,          // 60s without heartbeat = dead
      startupTimeout: 120000,        // 2m max startup time
      dependencyRetryInterval: 5000, // 5s between dependency checks
      ...config
    };

    this.services = new Map();      // serviceId -> serviceRecord
    this.dependencies = new Map();  // serviceId -> Set<dependencyIds>
    this.dependents = new Map();    // serviceId -> Set<dependentIds>
    this.startupOrder = [];         // topologically sorted startup sequence
    this.healthHistory = new Map(); // serviceId -> Array<healthSnapshots>

    console.log('[SERVICE REGISTRY] Initialized');
  }

  /**
   * Register a service in the unified registry
   */
  register(serviceId, descriptor = {}) {
    if (this.services.has(serviceId)) {
      console.warn(`[SERVICE REGISTRY] Service ${serviceId} already registered; updating descriptor.`);
      return this.update(serviceId, descriptor);
    }

    const record = {
      id: serviceId,
      name: descriptor.name || serviceId,
      type: descriptor.type || 'unknown', // e.g. 'agent', 'module', 'external'
      status: descriptor.status || 'initializing',
      port: descriptor.port || null,
      url: descriptor.url || null,
      pid: descriptor.pid || null,
      version: descriptor.version || '0.0.0',
      lastHeartbeat: Date.now(),
      startedAt: Date.now(),
      dependencies: new Set(descriptor.dependencies || []),
      capabilities: descriptor.capabilities || [],
      metadata: descriptor.metadata || {},
      health: {
        overall: 'initializing',
        uptime: 0,
        memory: null,
        cpu: null
      }
    };

    this.services.set(serviceId, record);
    this.dependencies.set(serviceId, new Set(record.dependencies));
    this.healthHistory.set(serviceId, []);

    // Build reverse dependency map
    for (const dep of record.dependencies) {
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set());
      }
      this.dependents.get(dep).add(serviceId);
    }

    this.recomputeStartupOrder();

    this.emit('service_registered', { serviceId, record });
    console.log(`[SERVICE REGISTRY] Registered: ${record.name} (${serviceId})`);

    return record;
  }

  /**
   * Update an existing service record (non-destructive merge)
   */
  update(serviceId, patch) {
    const record = this.services.get(serviceId);
    if (!record) {
      throw new Error(`Service ${serviceId} not found in registry`);
    }

    if (patch.status !== undefined) record.status = patch.status;
    if (patch.port !== undefined) record.port = patch.port;
    if (patch.url !== undefined) record.url = patch.url;
    if (patch.pid !== undefined) record.pid = patch.pid;
    if (patch.version !== undefined) record.version = patch.version;
    if (patch.metadata !== undefined) Object.assign(record.metadata, patch.metadata);
    if (patch.health !== undefined) Object.assign(record.health, patch.health);

    record.lastHeartbeat = Date.now();

    this.emit('service_updated', { serviceId, record });
    return record;
  }

  /**
   * Record a heartbeat from a service
   */
  heartbeat(serviceId, healthPayload = {}) {
    const record = this.services.get(serviceId);
    if (!record) {
      console.warn(`[SERVICE REGISTRY] Heartbeat from unknown service: ${serviceId}`);
      return null;
    }

    record.lastHeartbeat = Date.now();
    record.health.overall = healthPayload.status || record.health.overall;
    record.health.uptime = healthPayload.uptime || (Date.now() - record.startedAt);
    record.health.memory = healthPayload.memory !== undefined ? healthPayload.memory : record.health.memory;
    record.health.cpu = healthPayload.cpu !== undefined ? healthPayload.cpu : record.health.cpu;

    if (record.status === 'initializing' || record.status === 'suspect') {
      record.status = 'healthy';
    }

    // Push to history (keep last 100)
    const history = this.healthHistory.get(serviceId);
    history.push({ ...record.health, timestamp: Date.now() });
    if (history.length > 100) history.shift();

    this.emit('service_heartbeat', { serviceId, health: record.health });
    return record;
  }

  /**
   * Mark a service as failed or dead
   */
  markFailed(serviceId, reason = 'unknown') {
    const record = this.services.get(serviceId);
    if (!record) return;

    const previousStatus = record.status;
    record.status = 'failed';
    record.health.overall = 'failed';

    this.emit('service_failed', { serviceId, reason, previousStatus, record });
    console.error(`[SERVICE REGISTRY] Service FAILED: ${serviceId} (${reason})`);

    // Notify dependents
    const deps = this.dependents.get(serviceId);
    if (deps) {
      for (const dependent of deps) {
        this.emit('dependency_failed', { serviceId, dependent, reason });
      }
    }
  }

  /**
   * Unregister a service (clean shutdown)
   */
  unregister(serviceId) {
    const record = this.services.get(serviceId);
    if (!record) return false;

    this.services.delete(serviceId);
    this.dependencies.delete(serviceId);
    this.healthHistory.delete(serviceId);

    // Remove from dependents map
    for (const [depId, dependents] of this.dependents) {
      dependents.delete(serviceId);
      if (dependents.size === 0) {
        this.dependents.delete(depId);
      }
    }
    this.dependents.delete(serviceId);

    this.recomputeStartupOrder();

    this.emit('service_unregistered', { serviceId });
    console.log(`[SERVICE REGISTRY] Unregistered: ${serviceId}`);
    return true;
  }

  /**
   * Compute topological startup order based on dependencies
   */
  recomputeStartupOrder() {
    const visited = new Set();
    const tempMark = new Set();
    const order = [];

    const visit = (id) => {
      if (tempMark.has(id)) {
        console.error(`[SERVICE REGISTRY] Circular dependency detected involving ${id}`);
        return;
      }
      if (visited.has(id)) return;

      tempMark.add(id);
      const deps = this.dependencies.get(id) || new Set();
      for (const dep of deps) {
        if (this.services.has(dep)) {
          visit(dep);
        } else {
          console.warn(`[SERVICE REGISTRY] Missing dependency: ${dep} required by ${id}`);
        }
      }
      tempMark.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.services.keys()) {
      visit(id);
    }

    this.startupOrder = order;
  }

  /**
   * Get the recommended startup sequence
   */
  getStartupSequence() {
    return this.startupOrder.map(id => {
      const svc = this.services.get(id);
      return svc ? { id: svc.id, name: svc.name, status: svc.status } : null;
    }).filter(Boolean);
  }

  /**
   * Check if all dependencies for a service are healthy
   */
  dependenciesHealthy(serviceId) {
    const deps = this.dependencies.get(serviceId);
    if (!deps || deps.size === 0) return true;

    for (const dep of deps) {
      const depRecord = this.services.get(dep);
      if (!depRecord || depRecord.status !== 'healthy') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get all dependents of a service
   */
  getDependents(serviceId) {
    return Array.from(this.dependents.get(serviceId) || []);
  }

  /**
   * Get full dependency graph as JSON
   */
  getDependencyGraph() {
    const nodes = [];
    const edges = [];

    for (const [id, record] of this.services) {
      nodes.push({
        id,
        name: record.name,
        status: record.status,
        type: record.type
      });

      const deps = this.dependencies.get(id) || new Set();
      for (const dep of deps) {
        edges.push({ from: dep, to: id });
      }
    }

    return { nodes, edges };
  }

  /**
   * Run a periodic sweep to detect stale heartbeats
   */
  startHeartbeatMonitor() {
    setInterval(() => {
      const now = Date.now();

      for (const [id, record] of this.services) {
        if (record.status === 'failed') continue;

        const elapsed = now - record.lastHeartbeat;

        if (elapsed > this.config.heartbeatDead && record.status !== 'dead') {
          record.status = 'dead';
          this.emit('service_dead', { serviceId: id, elapsed });
          console.error(`[SERVICE REGISTRY] Service DEAD: ${id} (${elapsed}ms since heartbeat)`);
        } else if (elapsed > this.config.heartbeatTimeout && record.status !== 'suspect') {
          record.status = 'suspect';
          record.health.overall = 'suspect';
          this.emit('service_suspect', { serviceId: id, elapsed });
          console.warn(`[SERVICE REGISTRY] Service SUSPECT: ${id} (${elapsed}ms since heartbeat)`);
        }
      }
    }, 10000); // Every 10 seconds

    console.log('[SERVICE REGISTRY] Heartbeat monitor started');
  }

  /**
   * Get registry status summary
   */
  getStatus() {
    const statuses = {};
    let healthy = 0, suspect = 0, failed = 0, dead = 0, initializing = 0;

    for (const [id, record] of this.services) {
      statuses[id] = {
        name: record.name,
        status: record.status,
        lastHeartbeat: record.lastHeartbeat,
        port: record.port,
        health: record.health
      };

      if (record.status === 'healthy') healthy++;
      else if (record.status === 'suspect') suspect++;
      else if (record.status === 'failed') failed++;
      else if (record.status === 'dead') dead++;
      else if (record.status === 'initializing') initializing++;
    }

    return {
      total: this.services.size,
      healthy,
      suspect,
      failed,
      dead,
      initializing,
      services: statuses,
      startupSequence: this.getStartupSequence(),
      dependencyGraph: this.getDependencyGraph()
    };
  }

  /**
   * Export full registry state for snapshots / backups
   */
  exportSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      services: {},
      dependencies: {},
      startupOrder: this.startupOrder
    };

    for (const [id, record] of this.services) {
      snapshot.services[id] = {
        ...record,
        dependencies: Array.from(record.dependencies)
      };
    }

    for (const [id, deps] of this.dependencies) {
      snapshot.dependencies[id] = Array.from(deps);
    }

    return snapshot;
  }
}

module.exports = ServiceRegistry;
