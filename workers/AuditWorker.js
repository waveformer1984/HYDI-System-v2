const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();

class AuditWorker {
    constructor(workerId) {
        this.workerId = workerId || `audit-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.auditConfig = {
            auditEvents: [
                'user.action', 'system.change', 'data.modification', 'security.event',
                'financial.transaction', 'job.execution', 'service.activation', 'configuration.change'
            ],
            retentionDays: 90,
            samplingRate: 1.0
        };

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('audit', this.workerId);
            this.queue.updateHeartbeat('idle');
            console.log(`[📋 Audit Worker] Initialized: ${this.workerId}`);
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            console.log('[📋 Audit Worker] Starting audit monitoring...');
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
            console.log('[📋 Audit Worker] Stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => console.error('[📋 Audit Worker] Poll error:', err))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('audit');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                if (this.auditConfig.auditEvents.includes(task.payload.event_type)) {
                    await this.recordAuditEvent(task.payload);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.recordAuditEvent = async function(payload) {
            const event = {
                event_type: payload.event_type,
                actor: payload.actor || 'system',
                resource: payload.resource || 'unknown',
                action: payload.action || payload.event_type,
                details: payload.data || {},
                recorded_by: this.workerId,
                recorded_at: new Date().toISOString()
            };
            await this.supabase.from('audit_log').insert(event);
            console.log(`[📋 Audit] Recorded: ${event.event_type}`);
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new AuditWorker();
    process.on('SIGINT', async () => { await worker.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await worker.stop(); process.exit(0); });
    worker.start().catch(err => { console.error('[📋 Audit Worker] Failed to start:', err); process.exit(1); });
}

module.exports = AuditWorker;
