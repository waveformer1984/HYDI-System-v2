require('dotenv').config();

// REAL Chaos Test: Block network to Supabase
async function realChaosTest() {
  console.log('=== REAL CHAOS TEST - NETWORK DISCONNECT ===\n');
  
  try {
    // Step 1: Baseline - verify normal operation
    console.log('1. Establishing baseline...');
    const baseline = await sendEvent('baseline', 'Real chaos test baseline');
    console.log(`Baseline: ${baseline.success ? 'SUCCESS' : 'FAILED'}`);
    
    // Step 2: Block network to Supabase
    console.log('\n2. Blocking network to Supabase...');
    console.log('INSTRUCTIONS: Block network to wufhlhrbskacneneylqa.supabase.co');
    console.log('PowerShell: New-NetFirewallRule -DisplayName "Block Supabase" -Direction Outbound -RemoteAddress "wufhlhrbskacneneylqa.supabase.co" -Action Block');
    console.log('Press ENTER when network is blocked...');
    
    // Wait for user to block network
    await waitForEnter();
    
    // Step 3: Send events during network block
    console.log('\n3. Sending events during network block...');
    const blockedEvents = [];
    
    for (let i = 0; i < 10; i++) {
      const result = await sendEvent(`blocked-${i}`, `Network block event ${i}`);
      blockedEvents.push(result);
      console.log(`Blocked event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      
      await sleep(500);
    }
    
    // Step 4: Wait for retry attempts
    console.log('\n4. Waiting for retry attempts (10 seconds)...');
    await sleep(10000);
    
    // Step 5: Check dashboard during outage
    console.log('5. Check dashboard at http://localhost:3002');
    console.log('You should see pending/failed events');
    console.log('Press ENTER when ready to restore network...');
    
    await waitForEnter();
    
    // Step 6: Restore network
    console.log('\n6. Restoring network...');
    console.log('INSTRUCTIONS: Unblock network to Supabase');
    console.log('PowerShell: Remove-NetFirewallRule -DisplayName "Block Supabase"');
    console.log('Press ENTER when network is restored...');
    
    await waitForEnter();
    
    // Step 7: Send recovery events
    console.log('\n7. Sending recovery events...');
    const recoveryEvents = [];
    
    for (let i = 0; i < 5; i++) {
      const result = await sendEvent(`recovery-${i}`, `Recovery event ${i}`);
      recoveryEvents.push(result);
      console.log(`Recovery event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      await sleep(500);
    }
    
    // Step 8: Wait for backlog processing
    console.log('\n8. Waiting for backlog processing (30 seconds)...');
    await sleep(30000);
    
    // Step 9: Verify results
    console.log('\n9. Verifying chaos test results...');
    await verifyChaosResults();
    
  } catch (error) {
    console.error('Real chaos test failed:', error.message);
  }
}

async function sendEvent(message, payload) {
  try {
    const response = await fetch('http://localhost:3001/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, payload })
    });
    
    const result = await response.json();
    return { success: result.success, eventId: result.event_id };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyChaosResults() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  try {
    // Get events from last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.log('Query failed:', error.message);
      return;
    }
    
    // Analyze results
    const phases = {
      baseline: data.filter(e => e.payload.message === 'baseline'),
      blocked: data.filter(e => e.payload.message && e.payload.message.includes('blocked-')),
      recovery: data.filter(e => e.payload.message && e.payload.message.includes('recovery-'))
    };
    
    console.log('\nCHAOS TEST RESULTS:');
    console.log(`Baseline events: ${phases.baseline.length}`);
    console.log(`Blocked phase events: ${phases.blocked.length}`);
    console.log(`Recovery events: ${phases.recovery.length}`);
    
    // Check statuses
    const statuses = data.reduce((acc, event) => {
      acc[event.status] = (acc[event.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\nStatus breakdown:');
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`- ${status}: ${count}`);
    });
    
    // Check for retries and failures
    const withRetries = data.filter(e => e.retries > 0);
    const failures = data.filter(e => e.status === 'failed' || e.status === 'permanently_failed');
    
    console.log(`\nEvents with retries: ${withRetries.length}`);
    console.log(`Failed events: ${failures.length}`);
    
    if (withRetries.length > 0) {
      console.log('\nRetry details:');
      withRetries.forEach(event => {
        console.log(`- ${event.event_id}: ${event.retries} retries, status: ${event.status}`);
      });
    }
    
    if (failures.length > 0) {
      console.log('\nFailure details:');
      failures.forEach(event => {
        console.log(`- ${event.event_id}: ${event.status}, reason: ${event.failure_reason}`);
      });
    }
    
    // Verdict
    const hasRealChaos = failures.length > 0 || withRetries.length > 0;
    
    console.log(`\nCHAOS TEST VERDICT:`);
    if (hasRealChaos) {
      console.log('SUCCESS: Real chaos experienced and handled');
    } else {
      console.log('INCONCLUSIVE: System may not have experienced real failure');
    }
    
  } catch (err) {
    console.log('Verification failed:', err.message);
  }
}

function waitForEnter() {
  return new Promise(resolve => {
    process.stdin.once('data', data => {
      if (data.toString().trim() === '') {
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

realChaosTest();
