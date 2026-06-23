/**
 * Protohub Client Library
 * Used by workers and chat server to interact with Protohub task coordinator
 *
 * Usage:
 *   const client = new ProtohubClient('http://localhost:4000');
 *   await client.registerWorker('anomaly-detection-1', ['analyze', 'predict']);
 *   const taskId = await client.submitTask('anomaly_detection', 'analyze', { data: [...] });
 *   const result = await client.getTaskResult(taskId);
 */

class ProtohubClient {
    constructor(baseUrl = 'http://localhost:4000') {
        this.baseUrl = baseUrl;
        this.timeout = 10000;
    }

    /**
     * Submit a task for distributed execution
     */
    async submitTask(workerType, operation, payload, priority = 'normal') {
        try {
            const response = await fetch(`${this.baseUrl}/api/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    worker_type: workerType,
                    operation,
                    payload,
                    priority
                }),
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.task_id;
        } catch (e) {
            console.error('Failed to submit task:', e.message);
            throw e;
        }
    }

    /**
     * Get task status and results
     */
    async getTaskResult(taskId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            console.error(`Failed to get task ${taskId}:`, e.message);
            throw e;
        }
    }

    /**
     * Register a worker with Protohub
     */
    async registerWorker(workerId, operations, capabilities = {}) {
        try {
            const response = await fetch(`${this.baseUrl}/api/workers/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    worker_id: workerId,
                    operations,
                    capabilities
                }),
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log(`✅ Registered with Protohub: ${workerId}`);
            return data.success;
        } catch (e) {
            console.warn(`⚠️  Failed to register with Protohub:`, e.message);
            return false;
        }
    }

    /**
     * Report task completion
     */
    async reportTaskResult(taskId, result, status = 'success', error = null) {
        try {
            const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    result,
                    status,
                    error
                }),
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            console.error(`Failed to report result for task ${taskId}:`, e.message);
            throw e;
        }
    }

    /**
     * Get Protohub health status
     */
    async getHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/api/health`, {
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            console.error('Failed to get Protohub health:', e.message);
            return null;
        }
    }

    /**
     * Get list of registered workers
     */
    async getRegistry() {
        try {
            const response = await fetch(`${this.baseUrl}/api/registry`, {
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            console.error('Failed to get worker registry:', e.message);
            return { workers: [] };
        }
    }

    /**
     * Wait for task completion (polling)
     */
    async waitForTask(taskId, maxWaitMs = 30000, pollIntervalMs = 500) {
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const task = await this.getTaskResult(taskId);

                if (['completed', 'failed', 'cancelled'].includes(task.status)) {
                    return task;
                }
            } catch (e) {
                // Task not ready yet, continue polling
            }

            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`Task ${taskId} did not complete within ${maxWaitMs}ms`);
    }
}

module.exports = ProtohubClient;
