/**
 * Migrate Worker Tables for Local Workers
 * Aligns local worker system with Supabase schema
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateTables() {
    console.log('🔄 Migrating Worker Tables\n');
    
    // Check if worker_status exists
    const { data: statusCheck, error: statusError } = await supabase
        .from('worker_status')
        .select('*')
        .limit(1);
    
    if (!statusError) {
        console.log('⚠️  worker_status table exists (old schema)');
        console.log('Creating view for backward compatibility...');
        
        // Create view for backward compatibility
        const { error: viewError } = await supabase
            .rpc('exec_sql', { 
                sql: `
                CREATE OR REPLACE VIEW public.worker_status AS
                SELECT 
                    'worker-' || queue_name || '-' || id::text as worker_id,
                    queue_name as worker_type,
                    CASE 
                        WHEN status = 'processing' THEN 'busy'
                        WHEN status = 'failed' THEN 'error'
                        WHEN status = 'done' THEN 'idle'
                        ELSE 'idle'
                    END as status,
                    updated_at as last_heartbeat,
                    id as current_task_id,
                    CASE WHEN status = 'done' THEN 1 ELSE 0 END as processed_count,
                    CASE WHEN status = 'failed' THEN 1 ELSE 0 END as error_count,
                    payload as metadata
                FROM public.worker_jobs
                WHERE status IN ('processing', 'failed', 'done')
                ORDER BY updated_at DESC;
                `
            });
        
        if (viewError) {
            console.log('❌ Could not create view (need admin rights)');
        } else {
            console.log('✅ Created backward compatibility view');
        }
    }
    
    // Check if worker_queues exists
    const { data: queuesCheck, error: queuesError } = await supabase
        .from('worker_queues')
        .select('*')
        .limit(1);
    
    if (!queuesError) {
        console.log('\n⚠️  worker_queues table exists (old schema)');
        console.log('Creating view for backward compatibility...');
        
        const { error: queueViewError } = await supabase
            .rpc('exec_sql', { 
                sql: `
                CREATE OR REPLACE VIEW public.worker_queues AS
                SELECT 
                    id,
                    queue_name,
                    payload,
                    status,
                    priority,
                    attempts,
                    3 as max_attempts,
                    error_message,
                    created_at,
                    started_at,
                    completed_at
                FROM public.worker_jobs;
                `
            });
        
        if (queueViewError) {
            console.log('❌ Could not create queue view (need admin rights)');
        } else {
            console.log('✅ Created queue compatibility view');
        }
    }
    
    console.log('\n📋 Migration Summary:');
    console.log('1. Local workers expect: worker_status, worker_queues');
    console.log('2. Supabase uses: worker_jobs, worker_failures');
    console.log('3. Created views for compatibility (if permissions allow)');
    
    console.log('\n🚀 Recommended Approach:');
    console.log('Use Supabase Edge Functions (worker-orchestrator) instead of local workers');
    console.log('They are already working and integrated with your system');
}

// Alternative: Update local workers to use correct tables
async function updateLocalWorkers() {
    console.log('\n🔧 Updating Local Worker Files\n');
    
    const fs = require('fs');
    const path = require('path');
    
    const filesToUpdate = [
        'workers/QueueManager.js',
        'workers/WorkerOrchestrator.js'
    ];
    
    filesToUpdate.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            console.log(`✅ Found: ${file}`);
            console.log(`   Replace 'worker_status' with 'worker_jobs'`);
            console.log(`   Replace 'worker_queues' with 'worker_jobs'`);
        }
    });
}

// Run migration
migrateTables()
    .then(() => updateLocalWorkers())
    .catch(err => console.error('❌ Migration failed:', err));
