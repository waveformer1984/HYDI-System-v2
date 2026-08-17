const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'BehaviorPatternWorker' });

class BehaviorPatternWorker {
    constructor(workerId) {
        this.workerId = workerId || `behavior-pattern-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('behavior_pattern', this.workerId);
            this.queue.updateHeartbeat('idle');
            logger.info('Initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => logger.error('Poll error', { error: err }))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('behavior_pattern');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'behavior.analyze': await this.analyzeJobPerformance(task.payload); break;
                    case 'usage.analyze': await this.analyzeServiceUsagePatterns(task.payload); break;
                    default: logger.info('Unhandled event type', { eventType: task.payload.event_type });
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.analyzeJobPerformance = async function(payload) {
            const { job_type, time_period } = payload.data || {};
            logger.info('Analyzing job performance', { jobType: job_type });
            const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
            const { data: jobs } = await this.supabase.from('job_performance').select('*').gte('recorded_at', since);
            const performanceByType = {};
            for (const job of (jobs || [])) {
                if (!performanceByType[job.job_type]) performanceByType[job.job_type] = { total: 0, success: 0, successRate: 0 };
                performanceByType[job.job_type].total++;
                if (job.success) performanceByType[job.job_type].success++;
            }
            for (const type in performanceByType) {
                const d = performanceByType[type];
                d.successRate = d.total > 0 ? d.success / d.total : 0;
            }
            const insights = [];
            // Find best and worst performing job types
            let bestType = null;
            let worstType = null;
            let bestRate = 0;
            let worstRate = 1;
            
            for (const type in performanceByType) {
                const rate = performanceByType[type].successRate;
                if (rate > bestRate) {
                    bestRate = rate;
                    bestType = type;
                }
                if (rate < worstRate) {
                    worstRate = rate;
                    worstType = type;
                }
            }
            
            if (bestType && worstType && bestType !== worstType) {
                insights.push(`Best performing job type: ${bestType} (${(bestRate*100).toFixed(1)}% success rate)`);
                insights.push(`Worst performing job type: ${worstType} (${(worstRate*100).toFixed(1)}% success rate)`);
            }
            
            return insights;
        };

        this.analyzeServiceUsagePatterns = async function(time_period, filters) {
            // Analyze service usage patterns
            let startDate;
            if (time_period === 'today') {
                startDate = new Date();
                startDate.setHours(0, 0, 0, 0);
            } else if (time_period === 'week') {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
            } else if (time_period === 'month') {
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
            } else {
                // Default to last 30 days
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
            }
            
            const { data: serviceUsage } = await this.supabase
                .from('service_usage_logs')
                .select('*')
                .gte('timestamp', startDate.toISOString());
            
            if (filters && filters.service_name) {
                // Filter by service name if specified
                serviceUsage.filter = su => su.service_name === filters.service_name;
            }
            
            // analyze-service-usage-statistics
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new BehaviorPatternWorker();
    process.on('SIGINT', async () => { await worker.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await worker.stop(); process.exit(0); });
    worker.start().catch(err => { logger.error('Failed to start', { error: err }); process.exit(1); });
}

module.exports = BehaviorPatternWorker;
