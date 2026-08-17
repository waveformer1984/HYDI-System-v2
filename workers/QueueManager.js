/**
 * Queue Manager for HYDI Worker System
 * Supports both Supabase (when configured) and a local JSON store.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const logger = require('../lib/structured-logger').child({ component: 'QueueManager' });
const LocalJobStore = require('./lib/local-job-store');
const LocalWorkerStatus = require('./lib/local-worker-status');

function hasSupabaseCredentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return url && key;
}

class QueueManager {
  constructor() {
    this.supabase = null;
    this.localJobStore = new LocalJobStore();
    this.localWorkerStatus = new LocalWorkerStatus();
    this.workerId = null;
    this.initialized = false;
    this.useSupabase = false;
  }

  async initialize() {
    if (this.initialized) return;

    this.useSupabase = hasSupabaseCredentials() && process.env.HYDI_QUEUE_SOURCE !== 'local';

    if (this.useSupabase) {
      this.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    } else {
      await this.localJobStore.initialize();
      await this.localWorkerStatus.initialize();
      this.useSupabase = false;
    }

    this.initialized = true;
  }

  async registerWorker(workerType, workerId) {
    if (!this.initialized) await this.initialize();
    this.workerId = workerId;

    if (this.useSupabase) {
      const { error } = await this.supabase
        .from('worker_status')
        .upsert({
          worker_id: workerId,
          worker_type: workerType,
          status: 'idle',
          last_heartbeat: new Date().toISOString(),
        });
      if (error) throw error;
    } else {
      await this.localWorkerStatus.registerWorker(workerType, workerId);
    }

    logger.info('Worker registered', { workerId, workerType, source: this.useSupabase ? 'supabase' : 'local' });
  }

  async enqueue(queueName, payload, priority = 0, maxAttempts = 3) {
    if (!this.initialized) await this.initialize();

    if (this.useSupabase) {
      const { data, error } = await this.supabase.rpc('enqueue_task', {
        p_queue_name: queueName,
        p_payload: payload,
        p_priority: priority,
        p_max_attempts: maxAttempts,
      });
      if (error) throw error;
      logger.info('Task enqueued', { queueName, taskId: data });
      return data;
    }

    const id = await this.localJobStore.enqueue(queueName, payload, priority, maxAttempts);
    logger.info('Task enqueued', { queueName, taskId: id, source: 'local' });
    return id;
  }

  async dequeue(queueName) {
    if (!this.initialized) await this.initialize();

    if (this.useSupabase) {
      const { data, error } = await this.supabase.rpc('dequeue_task', {
        p_queue_name: queueName,
        p_worker_id: this.workerId,
      });
      if (error) throw error;
      if (data) logger.info('Task dequeued', { queueName, taskId: data });
      return data;
    }

    const data = await this.localJobStore.dequeue(queueName, this.workerId);
    if (data) {
      await this.localWorkerStatus.updateHeartbeat(this.workerId, 'busy');
      logger.info('Task dequeued', { queueName, taskId: data.id, source: 'local' });
    }
    return data;
  }

  async completeTask(taskId, success = true, errorMessage = null) {
    if (!this.initialized) await this.initialize();

    if (this.useSupabase) {
      const { error } = await this.supabase.rpc('complete_task', {
        p_task_id: taskId,
        p_worker_id: this.workerId,
        p_success: success,
        p_error_message: errorMessage,
      });
      if (error) throw error;
      logger.info('Task finished', { taskId, success });
      return;
    }

    await this.localJobStore.completeTask(taskId, this.workerId, success, errorMessage);
    if (success) {
      await this.localWorkerStatus.markProcessed(this.workerId);
    } else {
      await this.localWorkerStatus.markError(this.workerId);
    }
    await this.localWorkerStatus.updateHeartbeat(this.workerId, 'idle');
    logger.info('Task finished', { taskId, success, source: 'local' });
  }

  async getTask(taskId) {
    if (!this.initialized) await this.initialize();

    if (this.useSupabase) {
      const { data, error } = await this.supabase
        .from('worker_queues')
        .select('*')
        .eq('id', taskId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }

    return this.localJobStore.getTask(taskId);
  }

  async updateHeartbeat(status = null) {
    if (!this.initialized || !this.workerId) return;

    if (this.useSupabase) {
      const update = { last_heartbeat: new Date().toISOString() };
      if (status) update.status = status;
      await this.supabase.from('worker_status').update(update).eq('worker_id', this.workerId);
      return;
    }

    await this.localWorkerStatus.updateHeartbeat(this.workerId, status);
  }

  async getQueueStats(queueName = null) {
    if (!this.initialized) await this.initialize();

    if (this.useSupabase) {
      let query = this.supabase.from('worker_queues').select('status, queue_name');
      if (queueName) query = query.eq('queue_name', queueName);
      const { data, error } = await query;
      if (error) throw error;

      const stats = {};
      for (const row of (data || [])) {
        stats[row.status] = (stats[row.status] || 0) + 1;
      }
      return stats;
    }

    return this.localJobStore.getQueueStats(queueName);
  }

  startHeartbeat(intervalMs = 30000) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.updateHeartbeat();
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async shutdown() {
    this.stopHeartbeat();

    if (this.workerId) {
      await this.updateHeartbeat('stopped');
    }
  }
}

module.exports = QueueManager;
