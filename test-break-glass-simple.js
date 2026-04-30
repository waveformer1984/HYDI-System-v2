// Simple Break-Glass Test using Supabase client
const { createClient } = require('@supabase/supabase-js');

async function testBreakGlassOverride() {
  console.log('🧪 BREAK-GLASS SQL VALIDATION');
  console.log('============================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Step 1: Check current circuit state
    console.log('\n📋 Step 1: Current circuit state');
    const { data: currentState, error: stateError } = await supabase
      .from('keeper_circuit_state')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (stateError) throw stateError;
    
    console.log(`   Current level: ${currentState.level}`);
    console.log(`   Expires: ${currentState.expires_at}`);
    console.log(`   Updated: ${currentState.updated_at}`);
    
    // Step 2: Apply break-glass override
    console.log('\n📋 Step 2: Applying break-glass override (Level 2, 5 min TTL)');
    
    const { data: updateResult, error: updateError } = await supabase
      .from('keeper_circuit_state')
      .update({
        level: 2,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        metadata: {
          ...currentState.metadata,
          break_glass: true,
          reason: 'Emergency circuit override during drill',
          requested_by: 'validation_drill',
          ttl_minutes: 5,
          previous_level: currentState.level
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
      .select();
    
    if (updateError) throw updateError;
    
    console.log('✅ Override applied successfully');
    console.log(`   New level: ${updateResult[0].level}`);
    console.log(`   Expires: ${updateResult[0].expires_at}`);
    
    // Step 3: Log the action
    console.log('\n📋 Step 3: Logging override action');
    
    const requestId = 'break_glass_drill_' + new Date().toISOString().replace(/[:.]/g, '');
    
    const { data: auditResult, error: auditError } = await supabase
      .from('keeper_audit_log')
      .insert({
        request_id: requestId,
        agent_id: 'validation_drill',
        agent_role: 'break_glass_operator',
        action: 'circuit:override',
        target: 'keeper_circuit_state',
        status: 'success',
        risk_level: 2,
        details: {
          action: 'break_glass_override',
          new_level: 2,
          ttl_minutes: 5,
          reason: 'Emergency circuit override during drill',
          requested_by: 'validation_drill'
        },
        sensitive: true
      })
      .select();
    
    if (auditError) throw auditError;
    
    console.log('✅ Audit entry created');
    console.log(`   Request ID: ${requestId}`);
    
    // Step 4: Verify override
    console.log('\n📋 Step 4: Verifying override');
    
    const { data: verifyState, error: verifyError } = await supabase
      .from('keeper_circuit_state')
      .select('level, expires_at, metadata->>break_glass, metadata->>reason')
      .eq('id', 1)
      .single();
    
    if (verifyError) throw verifyError;
    
    console.log(`   Level: ${verifyState.level}`);
    console.log(`   Break-glass: ${verifyState['metadata->>break_glass']}`);
    console.log(`   Reason: ${verifyState['metadata->>reason']}`);
    
    // Step 5: Check recent audit entries
    console.log('\n📋 Step 5: Recent audit entries');
    
    const { data: recentAudits, error: auditListError } = await supabase
      .from('keeper_audit_log')
      .select('request_id, action, status, created_at, details')
      .eq('action', 'circuit:override')
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (auditListError) throw auditListError;
    
    console.log(`   Found ${recentAudits.length} recent overrides`);
    recentAudits.forEach(audit => {
      console.log(`   - ${audit.request_id}: ${audit.details?.action} (Level ${audit.details?.new_level})`);
    });
    
    console.log('\n🎯 BREAK-GLASS VALIDATION COMPLETE');
    console.log('==================================');
    console.log('✅ Circuit override: WORKING');
    console.log('✅ TTL expiry: SET (5 minutes)');
    console.log('✅ Audit logging: WORKING');
    console.log('✅ Metadata tracking: WORKING');
    
    // Step 6: Test auto-expiry (wait 2 minutes then check)
    console.log('\n⏰ Testing auto-expiry (waiting 2 minutes...)');
    
    setTimeout(async () => {
      try {
        const { data: expiredState, error: expiredError } = await supabase
          .from('keeper_circuit_state')
          .select('level, expires_at')
          .eq('id', 1)
          .single();
        
        if (expiredError) throw expiredError;
        
        const now = new Date();
        const expires = new Date(expiredState.expires_at);
        const isExpired = now > expires;
        
        console.log('\n📋 Step 6: Auto-expiry check');
        console.log(`   Current time: ${now.toISOString()}`);
        console.log(`   Expires: ${expires.toISOString()}`);
        console.log(`   Expired: ${isExpired}`);
        console.log(`   Current level: ${expiredState.level}`);
        
        if (isExpired && expiredState.level === 0) {
          console.log('✅ AUTO-EXPIRY: WORKING (reset to level 0)');
        } else if (isExpired) {
          console.log('⚠️  AUTO-EXPIRY: EXPIRED but not reset (manual reset needed)');
        } else {
          console.log('⏳ AUTO-EXPIRY: NOT YET EXPIRED');
        }
        
      } catch (error) {
        console.error('❌ Auto-expiry check failed:', error.message);
      }
    }, 120000); // 2 minutes
    
  } catch (error) {
    console.error('❌ Break-glass test failed:', error.message);
    console.error('Details:', error);
  }
}

testBreakGlassOverride();
