/**
 * Workload Driver
 * Drives representative workloads against the HYDI stack
 */

const fetch = require('node-fetch');

class WorkloadDriver {
  constructor(config) {
    this.config = config;
    this.workloads = new Map();
    this.metrics = [];
  }

  /**
   * Register a workload
   */
  registerWorkload(name, workload) {
    this.workloads.set(name, workload);
  }

  /**
   * Execute all registered workloads
   */
  async executeAll(duration) {
    console.log('[WorkloadDriver] Executing all workloads...');
    const startTime = Date.now();
    const endTime = startTime + duration;

    while (Date.now() < endTime) {
      for (const [name, workload] of this.workloads) {
        try {
          const result = await this.executeWorkload(name, workload);
          this.metrics.push({
            workload: name,
            timestamp: Date.now(),
            success: true,
            duration: result.duration,
            result: result.data
          });
        } catch (error) {
          this.metrics.push({
            workload: name,
            timestamp: Date.now(),
            success: false,
            error: error.message
          });
        }
      }

      // Wait before next iteration
      await this.sleep(this.config.interval || 5000);
    }

    console.log('[WorkloadDriver] Workload execution completed');
    return this.metrics;
  }

  /**
   * Execute a single workload
   */
  async executeWorkload(name, workload) {
    const startTime = Date.now();
    console.log(`[WorkloadDriver] Executing workload: ${name}`);

    const result = await workload.execute();
    const duration = Date.now() - startTime;

    console.log(`[WorkloadDriver] Workload completed: ${name} (${duration}ms)`);

    return { duration, data: result };
  }

  /**
   * Get workload metrics
   */
  getMetrics() {
    return this.metrics;
  }

  /**
   * Get workload statistics
   */
  getStatistics() {
    const stats = {};

    for (const [name, workload] of this.workloads) {
      const workloadMetrics = this.metrics.filter(m => m.workload === name);
      const successful = workloadMetrics.filter(m => m.success);
      const failed = workloadMetrics.filter(m => !m.success);

      stats[name] = {
        total: workloadMetrics.length,
        successful: successful.length,
        failed: failed.length,
        successRate: workloadMetrics.length > 0 ? successful.length / workloadMetrics.length : 0,
        avgDuration: successful.length > 0 
          ? successful.reduce((sum, m) => sum + m.duration, 0) / successful.length 
          : 0
      };
    }

    return stats;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Representative workloads
 */

class ConversationWorkload {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }

  async execute() {
    const response = await fetch(`${this.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test conversation message',
        system: 'heidi'
      })
    });

    if (!response.ok) {
      throw new Error(`Conversation request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class MemoryStorageWorkload {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }

  async execute() {
    const response = await fetch(`${this.apiUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Test memory content',
        metadata: { source: 'qualification-harness' }
      })
    });

    if (!response.ok) {
      throw new Error(`Memory storage request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class MemoryRetrievalWorkload {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }

  async execute() {
    const response = await fetch(`${this.apiUrl}/api/memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        limit: 10
      })
    });

    if (!response.ok) {
      throw new Error(`Memory retrieval request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class SupervisorStatusWorkload {
  constructor(supervisorUrl) {
    this.supervisorUrl = supervisorUrl;
  }

  async execute() {
    const response = await fetch(`${this.supervisorUrl}/status`);

    if (!response.ok) {
      throw new Error(`Supervisor status request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class BridgeRequestWorkload {
  constructor(bridgeUrl) {
    this.bridgeUrl = bridgeUrl;
  }

  async execute() {
    const response = await fetch(`${this.bridgeUrl}/health`);

    if (!response.ok) {
      throw new Error(`Bridge request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class DatabaseOperationWorkload {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }

  async execute() {
    const response = await fetch(`${this.apiUrl}/api/health`);

    if (!response.ok) {
      throw new Error(`Database operation request failed: ${response.status}`);
    }

    return await response.json();
  }
}

module.exports = {
  WorkloadDriver,
  ConversationWorkload,
  MemoryStorageWorkload,
  MemoryRetrievalWorkload,
  SupervisorStatusWorkload,
  BridgeRequestWorkload,
  DatabaseOperationWorkload
};
