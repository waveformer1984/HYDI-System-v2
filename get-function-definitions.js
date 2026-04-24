/**
 * Get exact function definitions for precise patching
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getFunctionDefinitions() {
    console.log('🔍 Getting function definitions...\n');
    
    // Get the exact definitions
    const { data, error } = await supabase
        .from('pg_proc')
        .select(`
            proname,
            pg_get_function_identity_arguments(oid) as args,
            pg_get_functiondef(oid) as definition
        `)
        .eq('proname', 'publish_event')
        .single();
    
    if (error) {
        console.log('Using direct SQL approach...');
        
        // Use raw SQL since the view approach might not work
        const sql = `
            SELECT 
                n.nspname as schema_name,
                p.proname as function_name,
                pg_get_function_identity_arguments(p.oid) as args,
                pg_get_functiondef(p.oid) as definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('provision_customer_services','publish_event','invoke_worker_orchestrator')
            ORDER BY p.proname;
        `;
        
        console.log('Run this SQL in Supabase Editor:');
        console.log('=' .repeat(60));
        console.log(sql);
        console.log('=' .repeat(60));
        
    } else {
        console.log('Function:', data.proname);
        console.log('Args:', data.args);
        console.log('Definition:', data.definition);
    }
    
    // Also check which functions use gen_random_bytes
    console.log('\n🔍 Checking for gen_random_bytes usage...\n');
    
    const checkSql = `
        SELECT 
            n.nspname as schema_name,
            p.proname as function_name,
            CASE 
                WHEN pg_get_functiondef(p.oid) LIKE '%gen_random_bytes%' THEN 'USES gen_random_bytes'
                ELSE 'Clean'
            END as status
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND pg_get_functiondef(p.oid) LIKE '%gen_random_bytes%'
        ORDER BY p.proname;
    `;
    
    console.log('Run this to find all functions using gen_random_bytes:');
    console.log('=' .repeat(60));
    console.log(checkSql);
    console.log('=' .repeat(60));
}

getFunctionDefinitions();
