/**
 * MONITORING DASHBOARD - Real-time system health
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class MonitoringDashboard {
    constructor() {
        this.metrics = {};
    }

    async updateMetrics() {
        // Get system health
        const { data: health } = await supabase
            .from('system_health')
            .select('*');
        
        this.metrics.health = health || [];
        
        // Get active alerts
        const { data: alerts } = await supabase
            .rpc('get_active_alerts');
        
        this.metrics.alerts = alerts || [];
        
        // Get queue depths
        const { data: queues } = await supabase
            .from('worker_jobs')
            .select('queue_name, status')
            .order('created_at', { ascending: false });
        
        const queueStats = {};
        queues?.forEach(job => {
            if (!queueStats[job.queue_name]) {
                queueStats[job.queue_name] = { queued: 0, processing: 0, done: 0, failed: 0 };
            }
            queueStats[job.queue_name][job.status]++;
        });
        
        this.metrics.queues = queueStats;
        
        // Get recent failures
        const { data: failures } = await supabase
            .from('worker_failures')
            .select('*')
            .order('failed_at', { ascending: false })
            .limit(5);
        
        this.metrics.recentFailures = failures || [];
        
        // Get webhook health
        const { data: webhooks } = await supabase
            .from('webhook_events')
            .select('event_type, processed, created_at')
            .order('created_at', { ascending: false })
            .limit(10);
        
        this.metrics.webhooks = webhooks || [];
    }

    displayDashboard() {
        console.clear();
        console.log('🔰 HYDI SYSTEM MONITORING DASHBOARD');
        console.log('='.repeat(60));
        console.log(`Last updated: ${new Date().toLocaleString()}\n`);
        
        // System Health
        console.log('📊 SYSTEM HEALTH');
        console.log('-'.repeat(30));
        this.metrics.health.forEach(metric => {
            const icon = metric.status === 'OK' ? '✅' : metric.status === 'WARNING' ? '⚠️' : '🚨';
            console.log(`${icon} ${metric.metric}: ${metric.value} (${metric.status})`);
            console.log(`   ${metric.description}`);
        });
        
        // Active Alerts
        if (this.metrics.alerts.length > 0) {
            console.log('\n🚨 ACTIVE ALERTS');
            console.log('-'.repeat(30));
            this.metrics.alerts.forEach(alert => {
                const icon = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
                console.log(`${icon} ${alert.alert_type}: ${alert.message}`);
                console.log(`   Value: ${alert.metric_value}`);
            });
        }
        
        // Queue Status
        console.log('\n📋 QUEUE STATUS');
        console.log('-'.repeat(30));
        Object.entries(this.metrics.queues).forEach(([queue, stats]) => {
            const total = stats.queued + stats.processing;
            const status = total > 50 ? '🔴' : total > 20 ? '🟡' : '🟢';
            console.log(`${status} ${queue}:`);
            console.log(`   Queued: ${stats.queued} | Processing: ${stats.processing} | Done: ${stats.done} | Failed: ${stats.failed}`);
        });
        
        // Recent Failures
        if (this.metrics.recentFailures.length > 0) {
            console.log('\n❌ RECENT FAILURES');
            console.log('-'.repeat(30));
            this.metrics.recentFailures.forEach(failure => {
                console.log(`${failure.queue_name}: ${failure.error_message}`);
                console.log(`   ${failure.failed_at}`);
            });
        }
        
        // Webhook Status
        console.log('\n🔗 WEBHOOK STATUS (Last 10)');
        console.log('-'.repeat(30));
        const webhookStats = this.metrics.webhooks.reduce((acc, w) => {
            acc[w.event_type] = (acc[w.event_type] || { total: 0, processed: 0 });
            acc[w.event_type].total++;
            if (w.processed) acc[w.event_type].processed++;
            return acc;
        }, {});
        
        Object.entries(webhookStats).forEach(([type, stats]) => {
            const successRate = ((stats.processed / stats.total) * 100).toFixed(1);
            const icon = successRate === '100.0' ? '✅' : successRate >= '90.0' ? '⚠️' : '🚨';
            console.log(`${icon} ${type}: ${stats.processed}/${stats.total} (${successRate}%)`);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('Press Ctrl+C to exit | Updates every 30 seconds');
    }

    async start() {
        console.log('🔰 Starting monitoring dashboard...\n');
        
        // First update
        await this.updateMetrics();
        this.displayDashboard();
        
        // Set up interval
        setInterval(async () => {
            await this.updateMetrics();
            this.displayDashboard();
        }, 30000);
    }
}

// Start monitoring
new MonitoringDashboard().start();
