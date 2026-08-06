/**
 * Workload Driver
 * Drives representative workloads against the HYDI stack
 */

const fetch = require('node-fetch');
const { createHmac, randomBytes } = require('crypto');

function makeServiceToken() {
  const secret = process.env.HYDI_SERVICE_SECRET;
  if (!secret) return undefined;
  const requestId = randomBytes(8).toString('hex');
  const service = 'qualification';
  const ts = String(Date.now());
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

function withToken(headers) {
  const token = makeServiceToken();
  if (token) headers['x-hydi-service-token'] = token;
  return headers;
}

/**
 * Build a workload failure Error that includes the response body (truncated).
 * Without this, a 401 from /api/chat/route is indistinguishable between
 * "driver did not sign the request" and "server could not verify the token"
 * (e.g. secret not configured / secret mismatch with a stale server instance)
 * — which is exactly the ambiguity that stalled the 2026-08-06 qualification
 * triage. The body's `reason` field disambiguates in one run.
 */
async function workloadError(label, response) {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 300);
  } catch (_) { /* body unavailable */ }
  return new Error(`${label} failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
}

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
            duration: result.duration
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
 *
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
      headers: withToken({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message: 'Test conversation message',
        system: 'heidi'
      })
    });

    if (!response.ok) {
      throw await workloadError('Conversation request', response);
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
        id: require('crypto').randomUUID(),
        name: 'qualification-workflow',
        description: 'Synthetic workflow created by the operational qualification harness',
        task_type: 'qualification',
        inputs: [],
        outputs: [],
        success_count: 1,
        failure_count: 0,
        avg_duration_ms: 0,
        confidence: 0.5,
        last_success: new Date().toISOString(),
        optimizations: [],
        dependencies: [],
        source_agent: 'qualification'
      })
    });

    if (!response.ok) {
      throw await workloadError('Memory storage request', response);
    }

    return await response.json();
  }
}

class MemoryRetrievalWorkload {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async execute() {
    const response = await fetch(this.endpoint);

    if (!response.ok) {
      throw await workloadError('Memory retrieval request', response);
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
      throw await workloadError('Supervisor status request', response);
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
      throw await workloadError('Bridge request', response);
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
      throw await workloadError('Database health endpoint request', response);
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
