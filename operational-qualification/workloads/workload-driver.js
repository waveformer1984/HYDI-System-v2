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

    for (const name of this.workloads.keys()) {
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

/**
 * Each workload receives the FULL endpoint URL from qualification-config.json
 * and uses it verbatim. Earlier revisions appended their own path on top of the
 * configured endpoint, producing URLs such as
 * "http://localhost:3000/api/chat/api/chat", so every workload 404'd.
 */

class ConversationWorkload {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint, {
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
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint, {
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
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint, {
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
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint);

    if (!response.ok) {
      throw new Error(`Supervisor status request failed: ${response.status}`);
    }

    return await response.json();
  }
}

class BridgeRequestWorkload {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint);

    if (!response.ok) {
      throw new Error(`Bridge request failed: ${response.status}`);
    }

    return await response.json();
  }
}

/**
 * NOTE ON SCOPE: this workload polls an HTTP health endpoint that happens to
 * touch the database. It does not execute a database operation directly, so it
 * is evidence of endpoint availability, not of query correctness or write
 * durability. Reports must not classify it as database validation.
 */
class DatabaseOperationWorkload {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint);

    if (!response.ok) {
      throw new Error(`Database health endpoint request failed: ${response.status}`);
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
