/**
 * Find records by UUID
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const targetUuid = '2d68242d-2875-4840-8670-09320010e6c1';

async function findUuid() {
    console.log(`🔍 Searching for UUID: ${targetUuid}\n`);
    
    const tables = [
        'worker_jobs',
        'worker_failures',
        'event_bus_events',
        'webhook_events',
        'entitlements',
        'customers'
    ];
    
    for (const table of tables) {
        try {
            // Try common ID columns
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .or(`id.eq.${targetUuid},event_id.eq.${targetUuid},customer_id.eq.${targetUuid},job_id.eq.${targetUuid}`)
                .limit(5);
            
            if (data && data.length > 0) {
                console.log(`✅ Found in ${table}:`);
                data.forEach(record => {
                    console.log(`  ID: ${record.id}`);
                    console.log(`  Status: ${record.status || 'N/A'}`);
                    console.log(`  Created: ${record.created_at || record.occurred_at || 'N/A'}`);
                    console.log('---');
                });
            }
        } catch (err) {
            // Table might not exist or no access
        }
    }
    
    // Also check in JSON columns
    console.log('\n🔍 Checking JSON columns...');
    
    try {
        const { data: jobData } = await supabase
            .from('worker_jobs')
            .select('id, queue_name, payload')
            .like('payload', `%${targetUuid}%`);
        
        if (jobData && jobData.length > 0) {
            console.log('✅ Found in worker_jobs payload:');
            jobData.forEach(job => {
                console.log(`  Job ID: ${job.id}`);
                console.log(`  Queue: ${job.queue_name}`);
                console.log(`  Payload contains UUID`);
            });
        }
    } catch (err) {
        console.log('Could not check payload');
    }
}

findUuid();
