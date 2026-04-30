/**
 * Test Worker Orchestrator Edge Function
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testWorkerOrchestrator() {
    console.log('🧪 Testing Worker Orchestrator...\n');
    
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // First, enqueue a test job
    console.log('📤 Enqueuing test revenue job...');
    const { data: job, error: enqueueError } = await supabase
        .rpc('enqueue_job', {
            p_queue_name: 'revenue',
            p_job_type: 'stripe_event_ingest',
            p_payload: {
                event_id: 'evt_test_' + Math.random().toString(36).substr(2, 9),
                customer_id: 'test_customer_123',
                plan: 'starter',
                amount: 2000,
                source: 'test_script'
            },
            p_dedupe_key: null,
            p_priority: 50,
            p_delay_seconds: 0
        });
    
    if (enqueueError) {
        console.log('❌ Failed to enqueue job:', enqueueError.message);
        return;
    }
    
    console.log(`✅ Job enqueued: ${job}`);
    
    // Now call the worker orchestrator
    console.log('\n🔄 Calling worker orchestrator...');
    
    const orchestratorUrl = `${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`;
    
    try {
        const response = await fetch(orchestratorUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({
                queue_name: 'revenue',
                worker_name: 'test_worker',
                batch_size: 5
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log('✅ Orchestrator response:', result);
        } else {
            console.log('❌ Orchestrator error:', result);
        }
    } catch (error) {
        console.log('❌ Failed to call orchestrator:', error.message);
    }
    
    // Check job status
    console.log('\n📊 Checking job status...');
    const { data: jobs } = await supabase
        .from('worker_jobs')
        .select('*')
        .order('id', { ascending: false })
        .limit(3);
    
    jobs.forEach(j => {
        console.log(`   Job ${j.id}: ${j.status} (${j.queue_name})`);
    });
}

testWorkerOrchestrator();
