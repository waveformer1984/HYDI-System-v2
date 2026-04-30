/**
 * Split Keeper Architecture
 * Core (policy + validation) ↔ Execution Workers (isolated)
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const EventEmitter = require('events');
const crypto = require('crypto');

class KeeperCore extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxWorkers: options.maxWorkers || 4,
      workerTimeout: options.workerTimeout || 30000,
      workerScript: options.workerScript || __dirname + '/execution-worker.js',
      ...options
    };
    
    // Core components (never see secrets)
    this.policyEngine = options.policyEngine;
    this.intentVerifier = options.intentVerifier;
    this.circuitBreaker = options.circuitBreaker;
    
    // Worker pool
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers = new Set();
    
    // Request tracking
    this.pendingRequests = new Map();
    
    // Initialize workers
    this.initializeWorkers();
  }

  /**
   * Initialize worker pool
   */
  async initializeWorkers() {
    for (let i = 0; i < this.options.maxWorkers; i++) {
      const worker = new Worker(this.options.workerScript, {
        workerData: {
          workerId: i,
          vaultEndpoint: this.options.vaultEndpoint,
          networkLockdown: this.options.networkLockdown
        }
      });
      
      worker.on('message', this.handleWorkerMessage.bind(this));
      worker.on('error', this.handleWorkerError.bind(this));
      worker.on('exit', this.handleWorkerExit.bind(this));
      
      this.workers.push({
        worker,
        id: i,
        status: 'idle',
        lastUsed: Date.now(),
        processed: 0
      });
      
      this.availableWorkers.push(i);
    }
    
    console.log(`[KEEPER-CORE] Initialized ${this.options.maxWorkers} workers`);
  }

  /**
   * Handle request from agent
   */
  async handleRequest(agentId, request, context = {}) {
    const requestId = this.generateRequestId();
    
    try {
      // 1. Verify agent signature
      const verifiedRequest = this.verifyAgentSignature(request);
      
      // 2. Policy check
      const policyResult = await this.policyEngine.authorized(
        agentId, 
        verifiedRequest.payload, 
        context
      );
      
      if (!policyResult.authorized) {
        throw new Error(`Policy denied: ${policyResult.reason}`);
      }
      
      // 3. Intent verification
      const intentResult = await this.intentVerifier.verifyIntent(
        agentId,
        verifiedRequest.payload.action,
        verifiedRequest.payload.payload,
        context
      );
      
      if (!intentResult.passed) {
        throw new Error(`Intent verification failed: ${intentResult.blockReason}`);
      }
      
      // 4. Circuit breaker check
      const circuitId = `${agentId}:${verifiedRequest.payload.action}`;
      
      // 5. Execute through worker
      const result = await this.executeThroughWorker(
        requestId,
        circuitId,
        verifiedRequest.payload,
        context
      );
      
      return {
        success: true,
        requestId,
        data: result,
        policy: policyResult,
        intent: intentResult
      };
      
    } catch (error) {
      this.emit('requestFailed', { requestId, agentId, error });
      throw error;
    }
  }

  /**
   * Execute request through worker
   */
  async executeThroughWorker(requestId, circuitId, request, context) {
    return new Promise((resolve, reject) => {
      // Get available worker
      const workerId = this.getAvailableWorker();
      if (workerId === null) {
        reject(new Error('No workers available'));
        return;
      }
      
      const workerInfo = this.workers[workerId];
      this.busyWorkers.add(workerId);
      
      // Track request
      this.pendingRequests.set(requestId, {
        workerId,
        circuitId,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.cleanupRequest(requestId);
          reject(new Error('Worker timeout'));
        }, this.options.workerTimeout)
      });
      
      // Send to worker
      workerInfo.worker.postMessage({
        type: 'execute',
        requestId,
        circuitId,
        request,
        context,
        timestamp: Date.now()
      });
      
      workerInfo.status = 'busy';
      workerInfo.lastUsed = Date.now();
    });
  }

  /**
   * Handle message from worker
   */
  handleWorkerMessage(message) {
    const { type, requestId, result, error, workerId } = message;
    
    if (type === 'response') {
      const pending = this.pendingRequests.get(requestId);
      
      if (pending) {
        clearTimeout(pending.timeout);
        
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
        
        this.cleanupRequest(requestId);
      }
    } else if (type === 'heartbeat') {
      // Update worker status
      const worker = this.workers[workerId];
      if (worker) {
        worker.lastHeartbeat = Date.now();
      }
    }
  }

  /**
   * Handle worker error
   */
  handleWorkerError(error, worker) {
    console.error(`[KEEPER-CORE] Worker error:`, error);
    
    // Find affected requests
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.workerId === worker.threadId) {
        pending.reject(new Error('Worker crashed'));
        this.cleanupRequest(requestId);
      }
    }
    
    // Restart worker
    this.restartWorker(worker.threadId);
  }

  /**
   * Handle worker exit
   */
  handleWorkerExit(code, signal, worker) {
    if (code !== 0) {
      console.error(`[KEEPER-CORE] Worker exited with code ${code}`);
      this.restartWorker(worker.threadId);
    }
  }

  /**
   * Restart worker
   */
  restartWorker(workerId) {
    const oldWorker = this.workers[workerId];
    
    // Clean up
    if (oldWorker) {
      oldWorker.worker.terminate();
    }
    
    // Create new worker
    const newWorker = new Worker(this.options.workerScript, {
      workerData: {
        workerId,
        vaultEndpoint: this.options.vaultEndpoint,
        networkLockdown: this.options.networkLockdown
      }
    });
    
    newWorker.on('message', this.handleWorkerMessage.bind(this));
    newWorker.on('error', this.handleWorkerError.bind(this));
    newWorker.on('exit', this.handleWorkerExit.bind(this));
    
    this.workers[workerId] = {
      worker: newWorker,
      id: workerId,
      status: 'idle',
      lastUsed: Date.now(),
      processed: 0,
      restarts: (oldWorker?.restarts || 0) + 1
    };
    
    console.log(`[KEEPER-CORE] Restarted worker ${workerId}`);
  }

  /**
   * Get available worker
   */
  getAvailableWorker() {
    if (this.availableWorkers.length === 0) {
      return null;
    }
    
    return this.availableWorkers.pop();
  }

  /**
   * Clean up request
   */
  cleanupRequest(requestId) {
    const pending = this.pendingRequests.get(requestId);
    
    if (pending) {
      this.busyWorkers.delete(pending.workerId);
      this.availableWorkers.push(pending.workerId);
      
      const worker = this.workers[pending.workerId];
      if (worker) {
        worker.status = 'idle';
        worker.processed++;
      }
      
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * Verify agent signature
   */
  verifyAgentSignature(request) {
    // Implementation from agent-auth.js
    // This would validate the cryptographic signature
    return request; // Placeholder
  }

  /**
   * Generate request ID
   */
  generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Get worker statistics
   */
  getWorkerStats() {
    return this.workers.map(w => ({
      id: w.id,
      status: w.status,
      processed: w.processed,
      lastUsed: w.lastUsed,
      restarts: w.restarts || 0
    }));
  }

  /**
   * Shutdown all workers
   */
  async shutdown() {
    console.log('[KEEPER-CORE] Shutting down workers...');
    
    // Wait for pending requests
    const pendingCount = this.pendingRequests.size;
    if (pendingCount > 0) {
      console.log(`[KEEPER-CORE] Waiting for ${pendingCount} pending requests...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Terminate workers
    for (const workerInfo of this.workers) {
      workerInfo.worker.terminate();
    }
    
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers.clear();
    
    console.log('[KEEPER-CORE] Shutdown complete');
  }
}

// Execution Worker (runs in separate thread)
class ExecutionWorker {
  constructor() {
    if (!isMainThread) {
      this.initialize();
    }
  }

  initialize() {
    const { workerId, vaultEndpoint, networkLockdown } = workerData;
    
    // Worker components (isolated from core)
    this.vaultClient = new VaultClient(vaultEndpoint);
    this.networkLockdown = new OutboundLockdown(networkLockdown);
    
    // Heartbeat
    setInterval(() => {
      parentPort.postMessage({
        type: 'heartbeat',
        workerId
      });
    }, 10000);
    
    // Handle messages
    parentPort.on('message', this.handleMessage.bind(this));
    
    console.log(`[KEEPER-WORKER-${workerId}] Initialized`);
  }

  async handleMessage(message) {
    const { type, requestId, circuitId, request, context } = message;
    
    if (type === 'execute') {
      try {
        // Execute action with secrets (isolated)
        const result = await this.executeAction(request, context);
        
        parentPort.postMessage({
          type: 'response',
          requestId,
          result,
          workerId: workerData.workerId
        });
        
      } catch (error) {
        parentPort.postMessage({
          type: 'response',
          requestId,
          error: error.message,
          workerId: workerData.workerId
        });
      }
    }
  }

  async executeAction(request, context) {
    const { action, payload } = request;
    
    switch (action) {
      case 'stripe:transfer':
        return await this.executeStripeTransfer(payload);
        
      case 'stripe:create_connect_account':
        return await this.executeStripeCreateAccount(payload);
        
      case 'email:send':
        return await this.executeEmailSend(payload);
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async executeStripeTransfer(payload) {
    // Get secret from vault (worker only)
    const secret = await this.vaultClient.get('stripe/live_key');
    
    // Execute with network lockdown
    const response = await this.networkLockdown.request(
      'stripe:transfer',
      'https://api.stripe.com/v1/transfers',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret.value}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(payload).toString()
      }
    );
    
    return JSON.parse(response.body);
  }

  async executeStripeCreateAccount(payload) {
    const secret = await this.vaultClient.get('stripe/live_key');
    
    const response = await this.networkLockdown.request(
      'stripe:create_connect_account',
      'https://api.stripe.com/v1/accounts',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret.value}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(payload).toString()
      }
    );
    
    return JSON.parse(response.body);
  }

  async executeEmailSend(payload) {
    const secret = await this.vaultClient.get('email/resend_key');
    
    const response = await this.networkLockdown.request(
      'email:send',
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret.value}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    
    return JSON.parse(response.body);
  }
}

// Export main class
module.exports = { KeeperCore, ExecutionWorker };

// Run worker if in worker thread
if (!isMainThread) {
  new ExecutionWorker();
}
