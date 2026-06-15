/**
 * Behavior Pattern Worker
 * Analyzes customer and system behavior patterns to surface insights and trends.
 *
 * Queue-driven
 * Pattern recognition
 * Trend analysis
 */

'use strict';

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');

class BehaviorPatternWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `behavior-pattern-worker-${Date.now()}`;
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
        await this.queue.registerWorker('behavior_pattern', this.workerId);
        await this.queue.updateHeartbeat('idle');
        console.log(`[📊 Behavior Pattern Worker] Initialized: ${this.workerId}`);
    }

    async start() {
        if (this.running) {
            console.log('[📊 Behavior Pattern Worker] Already running');
            return;
        }
        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();
        console.log('[📊 Behavior Pattern Worker] Starting behavior pattern analysis...');
        this.poll();
    }

    async stop() {
        this.running = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        await this.queue.shutdown();
        console.log('[📊 Behavior Pattern Worker] Stopped');
    }

    poll() {
        if (!this.running) return;
        this.processNextTask()
            .catch(err => {
                console.error('[📊 Behavior Pattern Worker] Error in poll:', err);
            })
            .finally(() => {
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('behavior_pattern');
        if (!taskId) return;
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                console.error(`[📊 Behavior Pattern Worker] Task not found: ${taskId}`);
                return;
            }
            console.log(`[📊 Behavior Pattern Worker] Processing task: ${task.payload.event_type}`);
            // Store behavior event for pattern analysis
            await this.supabase
                .from('behavior_events')
                .insert({
                    event_type: task.payload.event_type,
                    data: task.payload.data,
                    recorded_at: new Date(),
                    worker_id: this.workerId
                });
            await this.queue.completeTask(taskId, true);
        } catch (err) {
            console.error(`[📊 Behavior Pattern Worker] Task failed: ${taskId}`, err);
            await this.queue.completeTask(taskId, false, err.message);
        }
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new BehaviorPatternWorker();

    process.on('SIGINT', async () => {
        console.log('\n[📊 Behavior Pattern Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n[📊 Behavior Pattern Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    worker.start().catch(err => {
        console.error('[📊 Behavior Pattern Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = BehaviorPatternWorker;
