/**
 * Check all worker-related tables in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function checkTables() {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const tables = [
        'worker_jobs',
        'worker_failures',
        'worker_registry',
        'event_bus_events',
        'entitlements',
        'fabrication_jobs',
        'inventory_items',
        'notifications_outbox',
        'webhook_events'
    ];
    
    console.log('📊 Checking Worker Tables:\n');
    
    for (const table of tables) {
        try {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .limit(1);
            
            if (error) {
                console.log(`❌ ${table}: Not found`);
            } else {
                const { count } = await supabase
                    .from(table)
                    .select('*', { count: 'exact', head: true });
                console.log(`✅ ${table}: ${count || 0} rows`);
            }
        } catch (err) {
            console.log(`❌ ${table}: Error - ${err.message}`);
        }
    }
}

checkTables();
