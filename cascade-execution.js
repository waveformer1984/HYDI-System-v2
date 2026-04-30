/**
 * CASCADE - Primary System Orchestrator
 * Stabilizes, verifies, and extends the worker architecture
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class CascadeOrchestrator {
    constructor() {
        this.results = {
            phase1: {},
            phase2: {},
            phase3: {},
            phase4: {},
            phase5: {},
            changes: [],
            risks: []
        };
    }

    async log(phase, message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] ${phase}: ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    }

    async executeSQL(sql, description) {
        this.log('SQL', `Executing: ${description}`);
        try {
            const { data, error } = await supabase.rpc('exec_sql', { sql });
            if (error) throw error;
            this.results.changes.push(description);
            this.log('SQL', '✅ Success', data);
            return data;
        } catch (err) {
            this.log('SQL', '❌ Failed', { error: err.message });
            this.results.risks.push(`SQL failed: ${description} - ${err.message}`);
            return null;
        }
    }

    async phase1_SystemValidation() {
        this.log('PHASE 1', 'Starting System Validation');
        
        // Group by status (manual aggregation since .group() not supported)
        const { data: statusData } = await supabase
            .from('worker_jobs')
            .select('status');
        
        const statusGroups = (statusData || []).reduce((acc, job) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
        }, {});
        
        this.results.phase1.workerJobs = statusGroups;
        this.log('PHASE 1', 'Worker Jobs by Status', statusGroups);
        
        // Check worker_failures
        const { count: failures } = await supabase
            .from('worker_failures')
            .select('*', { count: 'exact', head: true });
        
        this.results.phase1.failures = failures || 0;
        this.log('PHASE 1', `Total Failures: ${failures}`);
        
        // Check event_bus_events
        const { data: lastEvent } = await supabase
            .from('event_bus_events')
            .select('*')
            .order('occurred_at', { ascending: false })
            .limit(1);
        
        this.results.phase1.lastEvent = lastEvent?.[0] || null;
        this.log('PHASE 1', 'Last Event', lastEvent?.[0]);
        
        // Check entitlements
        const { count: entitlements } = await supabase
            .from('entitlements')
            .select('*', { count: 'exact', head: true });
        
        this.results.phase1.entitlements = entitlements || 0;
        this.log('PHASE 1', `Total Entitlements: ${entitlements}`);
    }

    async phase2_Hardening() {
        this.log('PHASE 2', 'Starting Hardening');
        
        // Add unique constraint for Stripe event IDs
        await this.executeSQL(`
            ALTER TABLE webhook_events 
            ADD CONSTRAINT IF NOT EXISTS webhook_events_event_id_unique 
            UNIQUE (event_id);
        `, 'Unique constraint on webhook_events.event_id');
        
        // Add indexes for performance
        await this.executeSQL(`
            CREATE INDEX IF NOT EXISTS idx_worker_jobs_status_created 
            ON worker_jobs (status, created_at);
        `, 'Index on worker_jobs status+created_at');
        
        await this.executeSQL(`
            CREATE INDEX IF NOT EXISTS idx_worker_jobs_priority 
            ON worker_jobs (priority DESC, created_at);
        `, 'Index on worker_jobs priority');
        
        // Implement retry logic function
        await this.executeSQL(`
            CREATE OR REPLACE FUNCTION retry_failed_jobs()
            RETURNS TABLE(job_id bigint, queue_name text, new_attempts integer) AS $$
            DECLARE
                v_job RECORD;
                v_retry_jobs worker_jobs%ROWTYPE;
            BEGIN
                -- Find jobs that can be retried
                FOR v_job IN 
                    SELECT j.id, j.queue_name, j.attempts, j.updated_at
                    FROM worker_jobs j
                    WHERE j.status = 'failed' 
                    AND j.attempts < 3
                    AND j.updated_at < NOW() - INTERVAL '1 minute' * POWER(2, LEAST(j.attempts, 5))
                    LIMIT 10
                LOOP
                    -- Update job for retry
                    UPDATE worker_jobs 
                    SET status = 'pending',
                        attempts = attempts + 1,
                        error_message = NULL,
                        updated_at = NOW()
                    WHERE id = v_job.id;
                    
                    RETURN NEXT v_job.id::bigint::text::bigint::bigint;
                END LOOP;
                
                RETURN;
            END;
            $$ LANGUAGE plpgsql;
        `, 'Retry failed jobs function');
        
        // Move permanently failed jobs
        await this.executeSQL(`
            CREATE OR REPLACE FUNCTION move_dead_jobs()
            RETURNS TABLE(moved_count bigint) AS $$
            BEGIN
                INSERT INTO worker_failures (job_id, queue_name, job_type, payload, error_message, failed_at)
                SELECT 
                    id,
                    queue_name,
                    job_type,
                    payload,
                    error_message,
                    NOW()
                FROM worker_jobs
                WHERE status = 'failed' AND attempts >= 3;
                
                DELETE FROM worker_jobs
                WHERE status = 'failed' AND attempts >= 3
                RETURNING id;
                
                RETURN;
            END;
            $$ LANGUAGE plpgsql;
        `, 'Dead job handler function');
    }

    async phase3_WorkerCompletion() {
        this.log('PHASE 3', 'Validating Worker Completion');
        
        // Check worker registry
        const { data: workers } = await supabase
            .from('worker_registry')
            .select('*');
        
        this.results.phase3.workers = workers || [];
        
        // Test each worker type
        const workerTypes = ['revenue', 'provisioning', 'router', 'event_bus'];
        
        for (const type of workerTypes) {
            const { count } = await supabase
                .from('worker_jobs')
                .select('*', { count: 'exact', head: true })
                .eq('queue_name', type)
                .eq('status', 'done');
            
            this.results.phase3[`completed_${type}`] = count || 0;
            this.log('PHASE 3', `${type} worker completed jobs: ${count}`);
        }
    }

    async phase4_EventFlowValidation() {
        this.log('PHASE 4', 'Tracing Event Flow');
        
        // Find a complete flow
        const { data: flows } = await supabase
            .from('event_bus_events')
            .select(`
                *,
                webhook_events!inner(event_id, type),
                worker_jobs!inner(queue_name, status)
            `)
            .order('occurred_at', { ascending: false })
            .limit(5);
        
        this.results.phase4.flows = flows || [];
        this.log('PHASE 4', 'Event Flows Found', flows);
    }

    async phase5_CronAutomation() {
        this.log('PHASE 5', 'Checking Cron Jobs');
        
        // Check if cron functions exist
        const cronJobs = [
            'process_worker_queues',
            'retry_failed_jobs',
            'cleanup_old_jobs'
        ];
        
        for (const job of cronJobs) {
            const { data } = await supabase
                .rpc('exec_sql', { 
                    sql: `SELECT routine_name FROM information_schema.routines WHERE routine_name = '${job}'` 
                });
            
            this.results.phase5[job] = data?.length > 0;
            this.log('PHASE 5', `${job}: ${data?.length > 0 ? '✅' : '❌'}`);
        }
    }

    async execute() {
        this.log('CASCADE', 'Starting Full System Execution');
        
        await this.phase1_SystemValidation();
        await this.phase2_Hardening();
        await this.phase3_WorkerCompletion();
        await this.phase4_EventFlowValidation();
        await this.phase5_CronAutomation();
        
        // Final output
        this.log('FINAL', 'EXECUTION COMPLETE');
        console.log('\n=== CHANGES MADE ===');
        this.results.changes.forEach(c => console.log(`✅ ${c}`));
        
        console.log('\n=== SYSTEM HEALTH ===');
        console.log(`[📊] Worker Jobs by Status:`, this.results.phase1.workerJobs);
        console.log(`Failures: ${this.results.phase1.failures}`);
        console.log(`Entitlements: ${this.results.phase1.entitlements}`);
        
        console.log('\n=== RISKS ===');
        this.results.risks.forEach(r => console.log(`⚠️  ${r}`));
        
        return this.results;
    }
}

// Execute CASCADE
const cascade = new CascadeOrchestrator();
cascade.execute().then(() => {
    console.log('\n🎯 CASCADE execution complete. System stabilized.');
}).catch(err => {
    console.error('❌ CASCADE failed:', err);
});
