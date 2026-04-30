/**
 * PHASE 4 — SYSTEM VALIDATION
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validatePipeline() {
    console.log('🔄 PHASE 4 — SYSTEM VALIDATION\n');
    
    // 1. Create test webhook event
    const { data: webhook, error: webhookError } = await supabase
        .from('webhook_events')
        .insert({
            event_id: 'evt_test_' + Date.now(),
            event_type: 'checkout.session.completed',
            payload: {
                id: 'cs_test_' + Date.now(),
                customer: 'cus_test',
                amount_total: 2000,
                currency: 'usd'
            },
            processed: false,
            created_at: new Date().toISOString()
        })
        .select()
        .single();
    
    if (webhookError) {
        console.log('❌ Failed to create webhook event:', webhookError.message);
        return false;
    }
    
    console.log('✅ Webhook event created:', webhook.event_id);
    
    // 2. Enqueue job
    const { data: job, error: jobError } = await supabase
        .rpc('enqueue_job', {
            p_queue_name: 'revenue',
            p_job_type: 'stripe_event_ingest',
            p_payload: webhook.payload,
            p_dedupe_key: webhook.event_id,
            p_priority: 100,
            p_delay_seconds: 0
        });
    
    if (jobError) {
        console.log('❌ Failed to enqueue job:', jobError.message);
        return false;
    }
    
    console.log('✅ Job enqueued:', job);
    
    // 3. Process job
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
            queue_name: 'revenue',
            batch_size: 1
        })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
        console.log('❌ Worker processing failed:', result);
        return false;
    }
    
    console.log('✅ Job processed successfully');
    
    // 4. Verify results
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const { data: finalJob } = await supabase
        .from('worker_jobs')
        .select('status, completed_at')
        .eq('id', job)
        .single();
    
    if (finalJob?.status !== 'done') {
        console.log('❌ Job not completed:', finalJob);
        return false;
    }
    
    console.log('✅ Job completed at:', finalJob.completed_at);
    
    // 5. Check events
    const { data: events } = await supabase
        .from('event_bus_events')
        .select('topic, event_name')
        .eq('source_worker', 'worker-orchestrator')
        .order('occurred_at', { ascending: false })
        .limit(1);
    
    if (!events || events.length === 0) {
        console.log('⚠️  No events published');
    } else {
        console.log('✅ Event published:', events[0].topic, events[0].event_name);
    }
    
    return true;
}

validatePipeline();
