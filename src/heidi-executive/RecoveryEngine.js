/**
 * HEIDI Operational Control Plane — Recovery Engine
 */

class RecoveryEngine {
  constructor(executor, registry) {
    this.executor = executor;
    this.registry = registry;
    this.history = [];
  }

  async attempt(task) {
    const cap = this.registry.get(task.capabilityId);
    const max = (cap && cap.retryPolicy.maxRetries) || 0;
    const backoff = (cap && cap.retryPolicy.backoffMs) || 0;

    let lastError = null;
    for (let i = 0; i <= max; i++) {
      if (i > 0) await this.delay(backoff * i);
      const res = await this.executor.execute({ ...task, parameters: { ...task.parameters, attempt: i } });
      this.history.push({ taskId: task.id, attempt: i, success: res.success, error: res.error });
      if (res.success) return res;
      lastError = res.error;
    }

    throw new Error(`Recovery exhausted for ${task.id}: ${lastError}`);
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = { RecoveryEngine };
