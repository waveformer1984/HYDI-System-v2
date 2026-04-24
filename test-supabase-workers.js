/**
 * Test Supabase Worker System
 * Tests the worker architecture you implemented in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testSupabaseWorkers() {
    console.log('🧪 Testing Supabase Worker System...\n');
    
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    try {
        // Test 1: Check if worker_jobs table exists
        console.log('📋 Checking worker_jobs table...');
        const { data: jobs, error: jobsError } = await supabase
            .from('worker_jobs')
            .select('id, queue_name, status')
            .limit(1);
        
        if (jobsError) {
            console.log('❌ worker_jobs table not found');
        } else {
            console.log('✅ worker_jobs table exists');
        }
        
        // Test 2: Check worker registry
        console.log('\n👥 Checking worker registry...');
        const { data: workers, error: workersError } = await supabase
            .from('worker_registry')
            .select('worker_name, ecosystem, worker_type')
            .limit(5);
        
        if (workersError) {
            console.log('❌ worker_registry not found');
        } else {
            console.log(`✅ Found ${workers.length} registered workers`);
            workers.forEach(w => {
                console.log(`   - ${w.worker_name} (${w.ecosystem}: ${w.worker_type})`);
            });
        }
        
        // Test 3: Test enqueue function
        console.log('\n📤 Testing enqueue_job function...');
        const { data: enqueueResult, error: enqueueError } = await supabase
            .rpc('enqueue_job', {
                p_queue_name: 'test',
                p_job_type: 'test_job',
                p_payload: { test: true, timestamp: new Date().toISOString() },
                p_dedupe_key: `test-${Date.now()}`,
                p_priority: 50,
                p_delay_seconds: 0
            });
        
        if (enqueueError) {
            console.log('❌ enqueue_job failed:', enqueueError.message);
        } else {
            console.log('✅ Job enqueued successfully:', enqueueResult);
        }
        
        // Test 4: Check event bus
        console.log('\n📡 Checking event bus...');
        const { data: events, error: eventsError } = await supabase
            .from('event_bus_events')
            .select('topic, event_name')
            .limit(3);
        
        if (eventsError) {
            console.log('❌ event_bus_events not found');
        } else {
            console.log(`✅ Found ${events.length} events`);
            events.forEach(e => {
                console.log(`   - ${e.topic}: ${e.event_name}`);
            });
        }
        
        // Test 5: Check cron jobs
        console.log('\n⏰ Checking cron jobs...');
        const { data: cron, error: cronError } = await supabase
            .from('cron_job')
            .select('jobname, schedule, active')
            .like('jobname', 'orchestrator-%');
        
        if (cronError) {
            console.log('ℹ️  Cannot access cron jobs (might need admin rights)');
        } else {
            console.log(`✅ Found ${cron.length} cron jobs`);
            cron.forEach(c => {
                console.log(`   - ${c.jobname}: ${c.schedule} (${c.active ? 'active' : 'inactive'})`);
            });
        }
        
        console.log('\n✅ Supabase Worker System test complete!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
    }
}

testSupabaseWorkers();
