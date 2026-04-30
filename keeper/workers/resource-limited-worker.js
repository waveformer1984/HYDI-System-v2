/**
 * Resource-Limited Worker
 * Because compromised workers shouldn't become crypto miners
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const { performance } = require('perf_hooks');

class ResourceLimitedWorker {
  constructor(options = {}) {
    this.options = {
      // Resource limits
      maxCPU: options.maxCPU || 50, // Percentage
      maxMemory: options.maxMemory || 512 * 1024 * 1024, // 512MB
      maxExecutionTime: options.maxExecutionTime || 30000, // 30 seconds
      maxNetworkRequests: options.maxNetworkRequests || 10,
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
      
      // Sandbox settings
      allowFileSystem: options.allowFileSystem || false,
      allowNetwork: options.allowNetwork !== false,
      allowedDomains: options.allowedDomains || [],
      
      // Monitoring
      monitorInterval: options.monitorInterval || 1000, // 1 second
      
      ...options
    };
    
    this.resources = {
      startTime: performance.now(),
      cpuUsage: 0,
      memoryUsage: 0,
      networkRequests: 0,
      executionTime: 0
    };
    
    this.monitoring = null;
    this.killed = false;
    
    // Start monitoring if in worker thread
    if (!isMainThread) {
      this.startMonitoring();
      this.setupSandbox();
    }
  }

  /**
   * Create worker with resource limits
   */
  static createLimited(workerScript, options = {}) {
    // Set resource limits at OS level if available
    const workerOptions = {
      resourceLimits: {
        maxOldGenerationSizeMb: options.maxMemoryMB || 512,
        maxYoungGenerationSizeMb: 128,
        codeRangeSizeMb: 16
      },
      env: {
        ...process.env,
        WORKER_SANDBOX: 'true',
        WORKER_MAX_MEMORY: (options.maxMemory || 512 * 1024 * 1024).toString()
      }
    };

    const worker = new Worker(workerScript, {
      ...workerOptions,
      workerData: {
        ...options.workerData,
        resourceLimits: options
      }
    });

    // Wrap worker with resource monitoring
    return new ResourceLimitedWorkerProxy(worker, options);
  }

  /**
   * Setup worker sandbox
   */
  setupSandbox() {
    // Override global functions to add limits
    if (!this.options.allowFileSystem) {
      this.sandboxFileSystem();
    }
    
    if (!this.options.allowNetwork) {
      this.sandboxNetwork();
    }
    
    // Add execution timeout
    this.setupExecutionTimeout();
  }

  /**
   * Sandbox file system access
   */
  sandboxFileSystem() {
    const fs = require('fs');
    const path = require('path');
    
    // Allowed paths (if any)
    const allowedPaths = this.options.allowedPaths || [];
    
    // Wrap fs functions
    const originalReadFile = fs.readFile;
    fs.readFile = (path, ...args) => {
      if (!this.isPathAllowed(path)) {
        throw new Error('File access denied');
      }
      
      // Check file size
      try {
        const stats = fs.statSync(path);
        if (stats.size > this.options.maxFileSize) {
          throw new Error('File too large');
        }
      } catch (e) {
        // File doesn't exist or can't check, let original handle it
      }
      
      return originalReadFile.call(fs, path, ...args);
    };
    
    // Similar wrappers for other fs functions...
  }

  /**
   * Sandbox network access
   */
  sandboxNetwork() {
    const http = require('http');
    const https = require('https');
    
    // Track network requests
    const originalRequest = https.request;
    const originalGet = https.get;
    
    const checkNetworkLimit = () => {
      if (this.resources.networkRequests >= this.options.maxNetworkRequests) {
        throw new Error('Network request limit exceeded');
      }
      this.resources.networkRequests++;
    };
    
    https.request = (...args) => {
      checkNetworkLimit();
      return originalRequest.apply(https, args);
    };
    
    https.get = (...args) => {
      checkNetworkLimit();
      return originalGet.apply(https, args);
    };
    
    // Similar for http module
  }

  /**
   * Setup execution timeout
   */
  setupExecutionTimeout() {
    setTimeout(() => {
      if (!this.killed) {
        console.error('[WORKER] Execution timeout exceeded');
        this.kill('timeout');
      }
    }, this.options.maxExecutionTime);
  }

  /**
   * Start resource monitoring
   */
  startMonitoring() {
    this.monitoring = setInterval(() => {
      this.checkResources();
    }, this.options.monitorInterval);
  }

  /**
   * Check resource usage
   */
  checkResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.resources.memoryUsage = memUsage.heapUsed;
    this.resources.executionTime = performance.now() - this.resources.startTime;
    
    // Check memory limit
    if (memUsage.heapUsed > this.options.maxMemory) {
      console.error(`[WORKER] Memory limit exceeded: ${memUsage.heapUsed} > ${this.options.maxMemory}`);
      this.kill('memory');
      return;
    }
    
    // Check CPU (simplified)
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / this.resources.executionTime * 100;
    if (cpuPercent > this.options.maxCPU) {
      console.warn(`[WORKER] High CPU usage: ${cpuPercent.toFixed(2)}%`);
    }
    
    // Report to parent
    if (parentPort) {
      parentPort.postMessage({
        type: 'resource_update',
        resources: this.resources
      });
    }
  }

  /**
   * Kill worker
   */
  kill(reason) {
    this.killed = true;
    
    if (this.monitoring) {
      clearInterval(this.monitoring);
    }
    
    // Report to parent
    if (parentPort) {
      parentPort.postMessage({
        type: 'worker_killed',
        reason,
        resources: this.resources
      });
    }
    
    // Give a moment for cleanup
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }

  /**
   * Check if path is allowed
   */
  isPathAllowed(requestedPath) {
    if (!this.options.allowFileSystem) {
      return false;
    }
    
    const allowedPaths = this.options.allowedPaths || [];
    const resolved = path.resolve(requestedPath);
    
    return allowedPaths.some(allowed => {
      const allowedResolved = path.resolve(allowed);
      return resolved.startsWith(allowedResolved);
    });
  }
}

/**
 * Proxy for monitoring worker from main thread
 */
class ResourceLimitedWorkerProxy {
  constructor(worker, options) {
    this.worker = worker;
    this.options = options;
    this.resources = {
      startTime: Date.now(),
      peakMemory: 0,
      networkRequests: 0,
      kills: 0
    };
    
    // Set up monitoring
    worker.on('message', this.handleWorkerMessage.bind(this));
    worker.on('error', this.handleWorkerError.bind(this));
    worker.on('exit', this.handleWorkerExit.bind(this));
  }

  /**
   * Handle messages from worker
   */
  handleWorkerMessage(message) {
    switch (message.type) {
      case 'resource_update':
        this.updateResourceMetrics(message.resources);
        break;
        
      case 'worker_killed':
        this.handleWorkerKill(message);
        break;
    }
  }

  /**
   * Update resource metrics
   */
  updateResourceMetrics(resources) {
    this.resources.peakMemory = Math.max(
      this.resources.peakMemory,
      resources.memoryUsage
    );
    this.resources.networkRequests = resources.networkRequests;
  }

  /**
   * Handle worker being killed
   */
  handleWorkerKill(message) {
    this.resources.kills++;
    console.error(`[WORKER-PROXY] Worker killed: ${message.reason}`);
    
    // Emit event for monitoring
    this.emit('workerKilled', {
      worker: this.worker,
      reason: message.reason,
      resources: this.resources
    });
    
    // Restart if not killed intentionally
    if (message.reason !== 'intentional') {
      this.restartWorker();
    }
  }

  /**
   * Restart worker
   */
  restartWorker() {
    console.log('[WORKER-PROXY] Restarting worker...');
    
    // Create new worker
    this.worker = new Worker(this.worker.filename, {
      ...this.worker.options,
      workerData: this.worker.workerData
    });
    
    // Reset monitoring
    this.resources.startTime = Date.now();
    this.worker.on('message', this.handleWorkerMessage.bind(this));
    this.worker.on('error', this.handleWorkerError.bind(this));
    this.worker.on('exit', this.handleWorkerExit.bind(this));
  }

  /**
   * Handle worker error
   */
  handleWorkerError(error) {
    console.error('[WORKER-PROXY] Worker error:', error);
  }

  /**
   * Handle worker exit
   */
  handleWorkerExit(code, signal) {
    if (code !== 0 && code !== null) {
      console.error(`[WORKER-PROXY] Worker exited with code ${code}`);
    }
  }

  /**
   * Get resource statistics
   */
  getResourceStats() {
    return {
      ...this.resources,
      uptime: Date.now() - this.resources.startTime,
      memoryLimit: this.options.maxMemory,
      networkLimit: this.options.maxNetworkRequests
    };
  }

  /**
   * Forward methods to worker
   */
  postMessage(...args) {
    return this.worker.postMessage(...args);
  }

  terminate(...args) {
    return this.worker.terminate(...args);
  }

  on(...args) {
    return this.worker.on(...args);
  }

  once(...args) {
    return this.worker.once(...args);
  }

  emit(...args) {
    return this.worker.emit(...args);
  }
}

/**
 * Docker-style resource limits (if running in container)
 */
function applyContainerLimits() {
  // Read cgroup limits if available
  const fs = require('fs');
  
  try {
    // Memory limit
    const memoryLimit = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8');
    const memoryUsage = process.memoryUsage();
    
    if (parseInt(memoryLimit) > 0) {
      const usagePercent = (memoryUsage.heapUsed / parseInt(memoryLimit)) * 100;
      if (usagePercent > 90) {
        console.warn(`[WORKER] Memory usage high: ${usagePercent.toFixed(2)}%`);
      }
    }
    
    // CPU limit
    const cpuQuota = fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8');
    const cpuPeriod = fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8');
    
    if (parseInt(cpuQuota) > 0) {
      const cpuLimit = parseInt(cpuQuota) / parseInt(cpuPeriod);
      console.log(`[WORKER] CPU limit detected: ${cpuLimit} cores`);
    }
  } catch (e) {
    // Not in container or cgroups not available
  }
}

// Export for use
module.exports = {
  ResourceLimitedWorker,
  ResourceLimitedWorkerProxy,
  applyContainerLimits
};

// If in worker thread, initialize
if (!isMainThread && workerData?.resourceLimits) {
  const limitedWorker = new ResourceLimitedWorker(workerData.resourceLimits);
  
  // Handle parent messages
  parentPort.on('message', (message) => {
    // Process message with resource limits
    // This would be implemented based on specific worker logic
  });
}
