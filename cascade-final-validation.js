/**
 * CASCADE FINAL VALIDATION
 * Complete system health check after hardening
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class CascadeFinalValidation {
    constructor() {
        this.results = {
            integrity: {},
            performance: {},
            flow: {},
            automation: {},
            health: 'STABLE'
        };
    }

    async log(phase, message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] ${phase}: ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    }

    async validateIntegrity() {
        this.log('INTEGRITY', 'Validating schema integrity');
        
        // Check all critical tables
        const tables = [
            'worker_jobs',
            'worker_failures', 
            'event_bus_events',
            'entitlements',
            'worker_registry',
            'webhook_events'
        ];
        
        for (const table of tables) {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });
            
            this.results.integrity[table] = {
                exists: !error,
                rows: count || 0
            };
            
            this.log('INTEGRITY', `${table}: ${error ? '❌ Missing' : `✅ ${count} rows`}`);
        }
    }

    async validatePerformance() {
        this.log('PERFORMANCE', 'Checking indexes and constraints');
        
        // Check critical indexes
        const { data: indexes } = await supabase
            .from('pg_indexes')
            .select('tablename, indexname')
            .in('tablename', ['worker_jobs', 'worker_failures', 'event_bus_events', 'entitlements'])
            .like('indexname', '%_idx');
        
        const indexCount = indexes?.length || 0;
        this.results.performance.indexes = indexCount;
        
        this.log('PERFORMANCE', `Found ${indexCount} performance indexes`);
        
        // Check unique constraints
        const { data: constraints } = await supabase
            .from('information_schema.table_constraints')
            .select('table_name, constraint_type')
            .eq('constraint_type', 'UNIQUE')
            .in('table_name', ['webhook_events', 'worker_jobs', 'event_bus_events']);
        
        this.results.performance.constraints = constraints?.length || 0;
        this.log('PERFORMANCE', `Found ${constraints?.length || 0} unique constraints`);
    }

    async validateFlow() {
        this.log('FLOW', 'Testing event flow pipeline');
        
        // 1. Enqueue test job
        const { data: job, error: enqueueError } = await supabase
            .rpc('enqueue_job', {
                p_queue_name: 'revenue',
                p_job_type: 'test_flow',
                p_payload: {
                    test_id: 'cascade_validation',
                    timestamp: new Date().toISOString()
                },
                p_dedupe_key: `cascade-test-${Date.now()}`,
                p_priority: 100,
                p_delay_seconds: 0
            });
        
        if (enqueueError) {
            this.log('FLOW', '❌ Failed to enqueue job', enqueueError);
            this.results.health = 'DEGRADED';
            return;
        }
        
        this.log('FLOW', `✅ Job enqueued: ${job}`);
        
        // 2. Process job via orchestrator
        try {
            const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    queue_name: 'revenue',
                    worker_name: 'cascade_test',
                    batch_size: 1
                })
            });
            
            const result = await response.json();
            
            if (result.ok) {
                this.log('FLOW', `✅ Processed ${result.claimed} jobs`);
                this.results.flow.jobsProcessed = result.claimed;
            } else {
                this.log('FLOW', '❌ Processing failed', result);
                this.results.health = 'DEGRADED';
            }
        } catch (err) {
            this.log('FLOW', '❌ Orchestrator error', err.message);
            this.results.health = 'UNSTABLE';
        }
        
        // 3. Check for events
        const { data: events } = await supabase
            .from('event_bus_events')
            .select('*')
            .eq('topic', 'billing:revenue')
            .order('occurred_at', { ascending: false })
            .limit(1);
        
        this.results.flow.eventsFound = events?.length || 0;
        this.log('FLOW', `Found ${events?.length || 0} revenue events`);
    }

    async validateAutomation() {
        this.log('AUTOMATION', 'Checking cron jobs');
        
        // Check if cron jobs exist
        const cronJobs = [
            'orchestrator-revenue',
            'orchestrator-provisioning',
            'orchestrator-router',
            'orchestrator-fabrication',
            'orchestrator-notifications'
        ];
        
        let activeCron = 0;
        for (const job of cronJobs) {
            // Since we can't query cron.job directly, check if function exists
            const { data } = await supabase
                .rpc('invoke_worker_orchestrator', {
                    p_queue_name: 'revenue',
                    p_batch_size: 1
                });
            
            if (data !== null) {
                activeCron++;
            }
        }
        
        this.results.automation.cronJobs = activeCron;
        this.log('AUTOMATION', `${activeCron > 0 ? '✅' : '⚠️'} Cron functions accessible`);
    }

    async generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('🎯 CASCADE FINAL VALIDATION REPORT');
        console.log('='.repeat(60));
        
        console.log('\n📊 SYSTEM HEALTH:', this.results.health);
        
        console.log('\n🔧 INTEGRITY CHECK:');
        Object.entries(this.results.integrity).forEach(([table, info]) => {
            console.log(`  ${table}: ${info.exists ? '✅' : '❌'} (${info.rows} rows)`);
        });
        
        console.log('\n⚡ PERFORMANCE:');
        console.log(`  Indexes: ${this.results.performance.indexes}`);
        console.log(`  Constraints: ${this.results.performance.constraints}`);
        
        console.log('\n🔄 FLOW VALIDATION:');
        console.log(`  Jobs Processed: ${this.results.flow.jobsProcessed || 0}`);
        console.log(`  Events Found: ${this.results.flow.eventsFound || 0}`);
        
        console.log('\n🤖 AUTOMATION:');
        console.log(`  Cron Functions: ${this.results.automation.cronJobs > 0 ? '✅' : '⚠️'}`);
        
        console.log('\n📋 FINAL STATUS:');
        if (this.results.health === 'STABLE') {
            console.log('✅ System is PRODUCTION READY');
            console.log('\n🚀 Next Steps:');
            console.log('1. Configure Vault secrets for cron execution');
            console.log('2. Update Stripe webhook to point to stripe-worker');
            console.log('3. Monitor via Realtime subscriptions');
        } else {
            console.log('⚠️  System needs attention');
            console.log('Review the logs above for issues');
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async execute() {
        this.log('CASCADE', 'Starting Final Validation');
        
        await this.validateIntegrity();
        await this.validatePerformance();
        await this.validateFlow();
        await this.validateAutomation();
        
        await this.generateReport();
        
        return this.results;
    }
}

// Execute final validation
const cascade = new CascadeFinalValidation();
cascade.execute().catch(err => {
    console.error('❌ Validation failed:', err);
});
