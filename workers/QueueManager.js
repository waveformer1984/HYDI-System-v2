/**
 * Queue Manager for HYDI Worker System
 * Handles queue operations using Postgres
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

class QueueManager {
    constructor() {
        this.supabase = null;
        this.workerId = null;
        this.initialized = false;
    }

    async initialize() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials');
        }
        
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.initialized = true;
    }

    /**
     * Register a worker
     */
    async registerWorker(workerType, workerId) {
        if (!this.initialized) await this.initialize();
        
        this.workerId = workerId;
        
        const { error } = await this.supabase
            .from('worker_status')
            .upsert({
                worker_id: workerId,
                worker_type: workerType,
                status: 'idle',
                last_heartbeat: new Date().toISOString()
            });
        
        if (error) throw error;
        
        console.log(`[📋 Queue] Worker registered: ${workerId} (${workerType})`);
    }

    /**
     * Enqueue a task
     */
    async enqueue(queueName, payload, priority = 0, maxAttempts = 3) {
        if (!this.initialized) await this.initialize();
        
        const { data, error } = await this.supabase.rpc('enqueue_task', {
            p_queue_name: queueName,
            p_payload: payload,
            p_priority: priority,
            p_max_attempts: maxAttempts
        });
        
        if (error) throw error;
        
        console.log(`[📋 Queue] Task enqueued: ${queueName} (ID: ${data})`);
        return data;
    }

    /**
     * Dequeue next task
     */
    async dequeue(queueName) {
        if (!this.initialized) await this.initialize();
        
        const { data, error } = await this.supabase.rpc('dequeue_task', {
            p_queue_name: queueName,
            p_worker_id: this.workerId
        });
        
        if (error) throw error;
        
        if (data) {
            console.log(`[📋 Queue] Task dequeued: ${queueName} (ID: ${data})`);
        }
        
        return data;
    }

    /**
     * Complete a task
     */
    async completeTask(taskId, success = true, errorMessage = null) {
        if (!this.initialized) await this.initialize();
        
        const { error } = await this.supabase.rpc('complete_task', {
            p_task_id: taskId,
            p_worker_id: this.workerId,
            p_success: success,
            p_error_message: errorMessage
        });
        
        if (error) throw error;
        
        console.log(`[📋 Queue] Task ${success ? 'completed' : 'failed'}: ${taskId}`);
    }

    /**
     * Get task details
     */
    async getTask(taskId) {
        if (!this.initialized) await this.initialize();
        
        const { data, error } = await this.supabase
            .from('worker_queues')
            .select('*')
            .eq('id', taskId)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        return data;
    }

    /**
     * Update worker heartbeat
     */
    async updateHeartbeat(status = null) {
        if (!this.initialized || !this.workerId) return;
        
        const update = { last_heartbeat: new Date().toISOString() };
        if (status) update.status = status;
        
        await this.supabase
            .from('worker_status')
            .update(update)
            .eq('worker_id', this.workerId);
    }

    /**
     * Get queue stats
     */
    async getQueueStats(queueName = null) {
        if (!this.initialized) await this.initialize();
        
        // Get all tasks and count manually since Supabase doesn't support GROUP BY
        let query = this.supabase
            .from('worker_queues')
            .select('status, queue_name');
        
        if (queueName) {
            query = query.eq('queue_name', queueName);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        const stats = {};
        data.forEach(row => {
            stats[row.status] = (stats[row.status] || 0) + 1;
        });
        
        return stats;
    }

    /**
     * Start heartbeat interval
     */
    startHeartbeat(intervalMs = 30000) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
        }, intervalMs);
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Cleanup on shutdown
     */
    async shutdown() {
        this.stopHeartbeat();
        
        if (this.workerId) {
            await this.updateHeartbeat('stopped');
        }
    }
}

module.exports = QueueManager;
