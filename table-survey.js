// Check available tables for delivery verification
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const supabase = createClient('https://akbnfovjdcobifeupvbn.supabase.co', serviceKey);

async function surveyTables() {
  console.log('🔍 TABLE SURVEY FOR DELIVERY');
  console.log('===========================');
  
  try {
    // Check information schema
    const { data: tables, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['clients', 'subscriptions', 'ledger', 'payouts', 'invoices', 'keymaker_system_state', 'keeper_audit_anchors']);
    
    if (error) {
      console.log('❌ Table survey error:', error.message);
      return;
    }
    
    console.log('✅ Available tables:');
    tables?.forEach(table => {
      console.log(`   - ${table.table_name}`);
    });
    
    // Check what we actually have
    console.log('\n🎯 DELIVERY READINESS CHECK:');
    
    const criticalTables = ['clients', 'ledger', 'payouts'];
    let readyCount = 0;
    
    for (const tableName of criticalTables) {
      const { data, error } = await supabase
        .from(tableName)
        .select('count')
        .limit(1);
      
      if (!error) {
        console.log(`✅ ${tableName}: Available`);
        readyCount++;
      } else {
        console.log(`❌ ${tableName}: ${error.message}`);
      }
    }
    
    console.log(`\n📊 Readiness: ${readyCount}/${criticalTables.length} critical tables available`);
    
  } catch (error) {
    console.log('❌ Survey failed:', error.message);
  }
}

surveyTables();
