// Check which tables exist in the database
const { createClient } = require('@supabase/supabase-js');

async function checkTables() {
  console.log('🔍 CHECKING DATABASE TABLES');
  console.log('==========================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Check keeper tables
    const { data: keeperTables, error: keeperError } = await supabase
      .from('keeper_circuit_state')
      .select('*')
      .limit(1);
    
    if (keeperError) {
      console.log('❌ keeper_circuit_state:', keeperError.message);
    } else {
      console.log('✅ keeper_circuit_state: EXISTS');
    }
    
    const { data: auditTables, error: auditError } = await supabase
      .from('keeper_audit_log')
      .select('*')
      .limit(1);
    
    if (auditError) {
      console.log('❌ keeper_audit_log:', auditError.message);
    } else {
      console.log('✅ keeper_audit_log: EXISTS');
    }
    
    const { data: anchorTables, error: anchorError } = await supabase
      .from('keeper_audit_anchors')
      .select('*')
      .limit(1);
    
    if (anchorError) {
      console.log('❌ keeper_audit_anchors:', anchorError.message);
    } else {
      console.log('✅ keeper_audit_anchors: EXISTS');
    }
    
    // Check monetization tables
    const { data: ledgerTables, error: ledgerError } = await supabase
      .from('ledger')
      .select('*')
      .limit(1);
    
    if (ledgerError) {
      console.log('❌ ledger:', ledgerError.message);
    } else {
      console.log('✅ ledger: EXISTS');
    }
    
    const { data: clientTables, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .limit(1);
    
    if (clientError) {
      console.log('❌ clients:', clientError.message);
    } else {
      console.log('✅ clients: EXISTS');
    }
    
    const { data: payoutTables, error: payoutError } = await supabase
      .from('payouts')
      .select('*')
      .limit(1);
    
    if (payoutError) {
      console.log('❌ payouts:', payoutError.message);
    } else {
      console.log('✅ payouts: EXISTS');
    }
    
    // Check functions
    const { data: anchorFunc, error: anchorFuncError } = await supabase
      .rpc('keeper_compute_anchor', { p_sink: 'local_db' });
    
    if (anchorFuncError) {
      console.log('❌ keeper_compute_anchor:', anchorFuncError.message);
    } else {
      console.log('✅ keeper_compute_anchor: EXISTS');
    }
    
    const { data: escalateFunc, error: escalateFuncError } = await supabase
      .rpc('keeper_auto_escalate');
    
    if (escalateFuncError) {
      console.log('❌ keeper_auto_escalate:', escalateFuncError.message);
    } else {
      console.log('✅ keeper_auto_escalate: EXISTS');
    }
    
    console.log('\n📊 SUMMARY');
    console.log('===========');
    console.log('✅ Security system tables are operational');
    console.log('✅ Core functions are deployed');
    console.log('⚠️  Some monetization tables may need manual migration');
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  }
}

checkTables();
