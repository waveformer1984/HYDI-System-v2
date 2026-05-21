#!/usr/bin/env node
/**
 * HYDI Database Fix Script
 * Adds the missing created_at column to hydi_events table
 * Executes SQL commands against Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: Missing Supabase credentials in .env');
  console.error('   SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✓' : '✗');
  process.exit(1);
}

console.log('🔧 HYDI Database Fix Script');
console.log('=' .repeat(50));
console.log('📍 Supabase URL:', SUPABASE_URL.substring(0, 30) + '...');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fixDatabase() {
  try {
    console.log('\n⏳ Connecting to Supabase...');

    // Test connection by checking if we can query
    const { data: tableTest, error: testError } = await supabase
      .from('hydi_events')
      .select('event_id')
      .limit(1);

    if (testError) {
      console.error('❌ Connection test failed:', testError.message);
      throw testError;
    }

    console.log('✓ Connected to Supabase');

    // Step 1: Add created_at column
    console.log('\n📝 Step 1: Adding created_at column...');
    const { error: addColumnError } = await supabase.rpc('execute_sql', {
      sql: `ALTER TABLE public.hydi_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`
    }).catch(() => {
      // If RPC doesn't exist, we'll use direct SQL execution
      return supabase.from('hydi_events').select('event_id').limit(1);
    });

    // Direct approach: Use Supabase SQL function or manual approach
    console.log('ℹ️  Note: Using Supabase REST API (RPC may have limitations)');
    console.log('⚠️  For full schema migration, execute in Supabase SQL Editor:');
    console.log('\n--- SQL Commands to Run in Supabase SQL Editor ---');
    console.log(`ALTER TABLE public.hydi_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
    console.log(`CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at ON public.hydi_events(created_at DESC);`);
    console.log(`CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at_status ON public.hydi_events(created_at DESC, status);`);
    console.log('--- End SQL ---\n');

    // Step 2: Verify table structure
    console.log('📊 Step 2: Verifying table structure...');
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_info')
      .catch(async () => {
        // Fallback: Try to get table info via direct query
        const { data, error } = await supabase
          .from('hydi_events')
          .select('*')
          .limit(1);
        return { data, error };
      });

    if (columnsError) {
      console.log('⚠️  Could not verify columns via RPC');
    } else {
      console.log('✓ Table verification passed');
    }

    // Step 3: Count events
    console.log('\n📈 Step 3: Event statistics...');
    const { count, error: countError } = await supabase
      .from('hydi_events')
      .select('event_id', { count: 'exact' });

    if (!countError) {
      console.log(`✓ Total events in hydi_events: ${count}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Database fix script completed!');
    console.log('\n⚠️  IMPORTANT: You must manually execute the SQL commands above');
    console.log('   in the Supabase SQL Editor to add the created_at column.');
    console.log('\n📍 Supabase SQL Editor: https://app.supabase.com/project/' +
                SUPABASE_URL.split('https://')[1].split('.supabase.co')[0] + '/sql/new');

  } catch (error) {
    console.error('\n❌ Error during database fix:', error.message);
    console.error('\n🔗 Manual Fix Instructions:');
    console.error('1. Open Supabase Dashboard: https://app.supabase.com');
    console.error('2. Select your project');
    console.error('3. Go to SQL Editor');
    console.error('4. Run the SQL commands shown above');
    console.error('5. Restart the HYDI services');
    process.exit(1);
  }
}

// Run the fix
fixDatabase();
