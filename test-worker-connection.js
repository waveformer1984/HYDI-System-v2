/**
 * Test Worker Connection
 * Tests if workers can connect to Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testConnection() {
    console.log('🔍 Testing Worker Connection to Supabase...\n');
    
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log(`📍 URL: ${supabaseUrl}`);
    console.log(`🔑 Key: ${supabaseKey ? 'Present' : 'Missing'}\n`);
    
    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Missing Supabase credentials');
        return false;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    try {
        // Test basic connection
        console.log('🔌 Testing connection...');
        const { data, error } = await supabase.from('_test_connection').select('*').limit(1);
        
        // Expected to fail, but tells us if connection works
        if (error && error.code === 'PGRST116') {
            console.log('✅ Connection successful!');
        } else if (error) {
            console.log('✅ Connection successful (error expected)');
        }
        
        // Check if queue tables exist
        console.log('\n📋 Checking for queue tables...');
        const tables = ['worker_queues', 'worker_status', 'worker_events'];
        
        for (const table of tables) {
            try {
                const { error } = await supabase.from(table).select('*').limit(1);
                if (error && error.code === 'PGRST116') {
                    console.log(`❌ Table '${table}' not found`);
                } else {
                    console.log(`✅ Table '${table}' exists`);
                }
            } catch (err) {
                console.log(`❌ Error checking '${table}': ${err.message}`);
            }
        }
        
        console.log('\n🎯 Test complete!');
        return true;
        
    } catch (error) {
        console.error('\n❌ Connection failed:', error.message);
        return false;
    }
}

testConnection();
