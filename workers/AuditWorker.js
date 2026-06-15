/**
 * Audit Worker
 * Records and retrieves audit trails for user actions, system changes, and security events.
 *
 * Queue-driven
 * Immutable audit log
 * Configurable retention
 */

'use strict';

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');

class AuditWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `audit-worker-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 5000; // 5 seconds
        this.pollTimer = null;
    }

    async initialize() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
        this.supabase = createClient(supabaseUrl, supabaseKey);
        await this.queue.registerWorker('audit', this.workerId);
        await this.queue.updateHeartbeat('idle');
        console.log(`[📋 Audit Worker] Initialized: ${this.workerId}`);
    }

    async start() {
        if (this.running) {
            console.log('[📋 Audit Worker] Already running');
            return;
        }
        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();
        console.log('[📋 Audit Worker] Starting audit processing...');
        this.poll();
    }

    async stop() {
        this.running = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        await this.queue.shutdown();
        console.log('[📋 Audit Worker] Stopped');
    }

    poll() {
        if (!this.running) return;
        this.processNextTask()
            .catch(err => {
                console.error('[📋 Audit Worker] Error in poll:', err);
            })
            .finally(() => {
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('audit');
        if (!taskId) return;
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                console.error(`[📋 Audit Worker] Task not found: ${taskId}`);
                return;
            }
            console.log(`[📋 Audit Worker] Processing task: ${task.payload.event_type}`);
            // Log audit event to database
            await this.supabase
                .from('audit_log')
                .insert({
                    event_type: task.payload.event_type,
                    data: task.payload.data,
                    recorded_at: new Date(),
                    worker_id: this.workerId
                });
            await this.queue.completeTask(taskId, true);
        } catch (err) {
            console.error(`[📋 Audit Worker] Task failed: ${taskId}`, err);
            await this.queue.completeTask(taskId, false, err.message);
        }
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new AuditWorker();

    process.on('SIGINT', async () => {
        console.log('\n[📋 Audit Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n[📋 Audit Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    worker.start().catch(err => {
        console.error('[📋 Audit Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = AuditWorker;
