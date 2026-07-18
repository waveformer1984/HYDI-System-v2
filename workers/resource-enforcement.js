/**
 * Worker Resource Enforcement
 * Enforces actual resource limits on workers
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const { performance } = require('perf_hooks');
const logger = require('../lib/structured-logger').child({ component: 'ResourceEnforcement' });

class ResourceEnforcement {
  constructor(options = {}) {
    this.config = {
      // Resource limits per worker
      limits: {
        maxMemory: options.maxMemory || 512 * 1024 * 1024, // 512MB
        maxCPU: options.maxCPU || 50, // 50% CPU
        maxExecutionTime: options.maxExecutionTime || 30000, // 30 seconds
        maxNetworkRequests: options.maxNetworkRequests || 10,
        maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
        maxOpenFiles: options.maxOpenFiles || 100
      },
      
      // Network restrictions
      network: {
        allowedHosts: options.allowedHosts || ['localhost', '127.0.0.1'],
        blockOutbound: options.blockOutbound !== false,
        requireProxy: options.requireProxy || false
      },
      
      // Filesystem restrictions
      filesystem: {
        allowedPaths: options.allowedPaths || [],
        readOnly: options.readOnly || false,
        sandboxed: options.sandboxed !== false
      },
      
      ...options
    };
    
    this.enforcedWorkers = new Map();
    this.violations = new Map();
  }

  /**
   * Create worker with resource enforcement
   */
  createEnforcedWorker(script, options = {}) {
    const workerId = this.generateWorkerId();
    
    // Create worker with resource limits
    const worker = new Worker(script, {
      resourceLimits: {
        maxOldGenerationSizeMb: Math.floor(this.config.limits.maxMemory / (1024 * 1024)),
        maxYoungGenerationSizeMb: 128,
        codeRangeSizeMb: 16
      },
      env: {
        ...process.env,
        WORKER_ID: workerId,
        WORKER_MAX_MEMORY: this.config.limits.maxMemory.toString(),
        WORKER_MAX_CPU: this.config.limits.maxCPU.toString(),
        WORKER_MAX_EXECUTION_TIME: this.config.limits.maxExecutionTime.toString(),
        WORKER_ENFORCED: 'true'
      },
      ...options
    });
    
    // Wrap worker with enforcement
    const enforcedWorker = new EnforcedWorker(worker, workerId, this.config);
    
    this.enforcedWorkers.set(workerId, enforcedWorker);
    
    return enforcedWorker;
  }

  /**
   * Generate unique worker ID
   */
  generateWorkerId() {
    return 'worker_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get enforcement statistics
   */
  getStats() {
    const stats = {
      totalWorkers: this.enforcedWorkers.size,
      activeWorkers: 0,
      terminatedWorkers: 0,
      totalViolations: 0,
      violationsByType: new Map()
    };
    
    for (const [id, worker] of this.enforcedWorkers) {
      if (worker.isActive()) {
        stats.activeWorkers++;
      } else {
        stats.terminatedWorkers++;
      }
      
      const workerViolations = worker.getViolations();
      stats.totalViolations += workerViolations.length;
      
      for (const violation of workerViolations) {
        const type = violation.type;
        stats.violationsByType.set(type, (stats.violationsByType.get(type) || 0) + 1);
      }
    }
    
    return stats;
  }
}

/**
 * Enforced Worker wrapper
 */
class EnforcedWorker {
  constructor(worker, workerId, config) {
    this.worker = worker;
    this.workerId = workerId;
    this.config = config;
    this.violations = [];
    this.startTime = Date.now();
    this.active = true;
    this.monitoring = null;
    
    this.setupMonitoring();
    this.setupEventHandlers();
  }

  /**
   * Setup resource monitoring
   */
  setupMonitoring() {
    if (isMainThread) {
      this.monitoring = setInterval(() => {
        this.checkResources();
      }, 1000); // Check every second
    }
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    this.worker.on('message', (message) => {
      if (message.type === 'resource_update') {
        this.handleResourceUpdate(message.resources);
      } else if (message.type === 'violation') {
        this.handleViolation(message.violation);
      }
    });
    
    this.worker.on('error', (error) => {
      this.handleViolation({
        type: 'worker_error',
        message: error.message,
        timestamp: Date.now()
      });
    });
    
    this.worker.on('exit', (code) => {
      this.active = false;
      if (this.monitoring) {
        clearInterval(this.monitoring);
      }
    });
  }

  /**
   * Check worker resources
   */
  checkResources() {
    // Request resource update from worker
    this.worker.postMessage({
      type: 'check_resources',
      timestamp: Date.now()
    });
  }

  /**
   * Handle resource update from worker
   */
  handleResourceUpdate(resources) {
    const now = Date.now();
    
    // Check memory usage
    if (resources.memoryUsage > this.config.limits.maxMemory) {
      this.handleViolation({
        type: 'memory_limit',
        current: resources.memoryUsage,
        limit: this.config.limits.maxMemory,
        timestamp: now
      });
    }
    
    // Check execution time
    const executionTime = now - this.startTime;
    if (executionTime > this.config.limits.maxExecutionTime) {
      this.handleViolation({
        type: 'execution_time',
        current: executionTime,
        limit: this.config.limits.maxExecutionTime,
        timestamp: now
      });
    }
    
    // Check network requests
    if (resources.networkRequests > this.config.limits.maxNetworkRequests) {
      this.handleViolation({
        type: 'network_limit',
        current: resources.networkRequests,
        limit: this.config.limits.maxNetworkRequests,
        timestamp: now
      });
    }
  }

  /**
   * Handle violation
   */
  handleViolation(violation) {
    violation.workerId = this.workerId;
    this.violations.push(violation);
    
    logger.warn('Violation detected', { workerId: this.workerId, violation });
    
    // Take action based on violation type
    switch (violation.type) {
      case 'memory_limit':
      case 'execution_time':
        this.terminateWorker('Resource limit exceeded');
        break;
        
      case 'network_limit':
        this.warnWorker('Network limit exceeded');
        break;
        
      case 'worker_error':
        this.terminateWorker('Worker error');
        break;
    }
  }

  /**
   * Terminate worker
   */
  terminateWorker(reason) {
    logger.warn('Terminating worker', { workerId: this.workerId, reason });
    
    if (this.monitoring) {
      clearInterval(this.monitoring);
    }
    
    this.worker.terminate();
    this.active = false;
  }

  /**
   * Warn worker
   */
  warnWorker(reason) {
    this.worker.postMessage({
      type: 'warning',
      reason,
      timestamp: Date.now()
    });
  }

  /**
   * Check if worker is active
   */
  isActive() {
    return this.active;
  }

  /**
   * Get violations
   */
  getViolations() {
    return this.violations;
  }

  /**
   * Post message to worker
   */
  postMessage(message) {
    return this.worker.postMessage(message);
  }

  /**
   * Terminate worker
   */
  terminate() {
    return this.terminateWorker('Manual termination');
  }
}

/**
 * Worker-side resource monitoring
 */
class WorkerResourceMonitor {
  constructor() {
    this.resources = {
      memoryUsage: 0,
      networkRequests: 0,
      startTime: Date.now(),
      openFiles: 0
    };
    
    this.setupMonitoring();
  }

  /**
   * Setup monitoring in worker
   */
  setupMonitoring() {
    if (!isMainThread && parentPort) {
      // Update resources periodically
      setInterval(() => {
        this.updateResources();
        this.sendResourceUpdate();
      }, 1000);
      
      // Handle messages from main thread
      parentPort.on('message', (message) => {
        if (message.type === 'check_resources') {
          this.sendResourceUpdate();
        } else if (message.type === 'warning') {
          logger.warn('Warning received', { reason: message.reason });
        }
      });
    }
  }

  /**
   * Update resource metrics
   */
  updateResources() {
    this.resources.memoryUsage = process.memoryUsage().heapUsed;
    this.resources.executionTime = Date.now() - this.resources.startTime;
  }

  /**
   * Send resource update to main thread
   */
  sendResourceUpdate() {
    if (parentPort) {
      parentPort.postMessage({
        type: 'resource_update',
        resources: this.resources,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Track network request
   */
  trackNetworkRequest() {
    this.resources.networkRequests++;
    
    // Check limit
    const maxRequests = parseInt(process.env.WORKER_MAX_NETWORK_REQUESTS || '10');
    if (this.resources.networkRequests > maxRequests) {
      this.reportViolation('network_limit', {
        current: this.resources.networkRequests,
        limit: maxRequests
      });
    }
  }

  /**
   * Report violation
   */
  reportViolation(type, details) {
    if (parentPort) {
      parentPort.postMessage({
        type: 'violation',
        violation: {
          type,
          ...details,
          timestamp: Date.now()
        }
      });
    }
  }
}

// Initialize monitor if in worker thread
if (!isMainThread && process.env.WORKER_ENFORCED === 'true') {
  const monitor = new WorkerResourceMonitor();
  
  // Override global fetch to track requests
  const originalFetch = global.fetch;
  global.fetch = function(...args) {
    monitor.trackNetworkRequest();
    return originalFetch.apply(this, args);
  };
}

module.exports = {
  ResourceEnforcement,
  EnforcedWorker,
  WorkerResourceMonitor
};
