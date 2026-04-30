// Quick table availability check
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const supabase = createClient('https://akbnfovjdcobifeupvbn.supabase.co', serviceKey);

async function quickCheck() {
  const tables = ['clients', 'ledger', 'payouts', 'keymaker_system_state', 'keeper_audit_anchors'];
  
  console.log('🎯 DELIVERY TABLE CHECK');
  console.log('======================');
  
  for (const tableName of tables) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('count')
        .limit(1);
      
      if (!error) {
        console.log(`✅ ${tableName}: Available`);
      } else {
        console.log(`❌ ${tableName}: ${error.message.includes('does not exist') ? 'Missing' : error.message}`);
      }
    } catch (err) {
      console.log(`❌ ${tableName}: Error - ${err.message}`);
    }
  }
}

quickCheck();
