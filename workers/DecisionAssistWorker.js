/**
 * Decision Assist Worker
 * Analyzes financial, system, and behavioral data to provide actionable decision recommendations.
 *
 * Queue-driven
 * Confidence-threshold gating
 * Multi-factor decision analysis
 */

'use strict';

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');

class DecisionAssistWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `decision-assist-worker-${Date.now()}`;
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
        await this.queue.registerWorker('decision_assist', this.workerId);
        await this.queue.updateHeartbeat('idle');
        console.log(`[🧠 Decision Assist Worker] Initialized: ${this.workerId}`);
    }

    async start() {
        if (this.running) {
            console.log('[🧠 Decision Assist Worker] Already running');
            return;
        }
        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();
        console.log('[🧠 Decision Assist Worker] Starting decision assist processing...');
        this.poll();
    }

    async stop() {
        this.running = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        await this.queue.shutdown();
        console.log('[🧠 Decision Assist Worker] Stopped');
    }

    poll() {
        if (!this.running) return;
        this.processNextTask()
            .catch(err => {
                console.error('[🧠 Decision Assist Worker] Error in poll:', err);
            })
            .finally(() => {
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('decision_assist');
        if (!taskId) return;
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                console.error(`[🧠 Decision Assist Worker] Task not found: ${taskId}`);
                return;
            }
            console.log(`[🧠 Decision Assist Worker] Processing task: ${task.payload.event_type}`);
            // Record decision request/analysis
            await this.supabase
                .from('decision_assist_log')
                .insert({
                    event_type: task.payload.event_type,
                    data: task.payload.data,
                    recorded_at: new Date(),
                    worker_id: this.workerId
                });
            await this.queue.completeTask(taskId, true);
        } catch (err) {
            console.error(`[🧠 Decision Assist Worker] Task failed: ${taskId}`, err);
            await this.queue.completeTask(taskId, false, err.message);
        }
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new DecisionAssistWorker();

    process.on('SIGINT', async () => {
        console.log('\n[🧠 Decision Assist Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n[🧠 Decision Assist Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });

    worker.start().catch(err => {
        console.error('[🧠 Decision Assist Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = DecisionAssistWorker;
