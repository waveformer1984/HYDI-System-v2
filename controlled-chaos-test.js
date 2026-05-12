require('dotenv').config();

// Controlled Chaos Test - Real Failure Injection
async function runControlledChaosTest() {
  console.log('=== CONTROLLED CHAOS TEST ===\n');
  
  const scenarios = [
    { mode: 'NONE', description: 'Baseline - No chaos' },
    { mode: 'DELAY_DB', description: 'Database latency injection' },
    { mode: 'PARTIAL_FAIL', description: '30% random failure rate' },
    { mode: 'DROP_DB', description: 'Complete database drop' }
  ];
  
  for (const scenario of scenarios) {
    console.log(`\n--- Testing: ${scenario.description} ---`);
    
    // Set chaos mode
    process.env.CHAOS_MODE = scenario.mode;
    
    // Restart services to pick up new chaos mode
    await restartServices();
    
    // Run test burst
    const results = await runBurstTest(5, scenario.mode);
    
    // Analyze results
    await analyzeResults(results, scenario);
    
    // Wait between scenarios
    await sleep(2000);
  }
  
  console.log('\n=== CONTROLLED CHAOS TEST COMPLETE ===');
}

async function restartServices() {
  console.log('Restarting services...');
  
  // Kill existing processes
  const { exec } = require('child_process');
  await new Promise(resolve => {
    exec('taskkill /F /IM node.exe', () => resolve());
  });
  
  await sleep(2000);
  
  // Start protoforge with new chaos mode
  const { spawn } = require('child_process');
  spawn('node', ['protoforge-mock.js'], { 
    stdio: 'pipe',
    detached: true 
  });
  
  await sleep(3000);
  console.log('Services restarted');
}

async function runBurstTest(count, chaosMode) {
  console.log(`Running ${count} events with chaos mode: ${chaosMode}`);
  
  const results = [];
  const startTime = Date.now();
  
  for (let i = 0; i < count; i++) {
    try {
      const payload = {
        message: `chaos-test-${i}`,
        chaosMode,
        index: i,
        timestamp: Date.now()
      };
      
      const requestStart = Date.now();
      const response = await fetch('http://localhost:3001/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const requestTime = Date.now() - requestStart;
      const result = await response.json();
      
      results.push({
        index: i,
        success: result.success,
        eventId: result.event_id,
        requestTime,
        error: result.error || null
      });
      
      console.log(`Event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'} (${requestTime}ms)`);
      
    } catch (error) {
      results.push({
        index: i,
        success: false,
        error: error.message,
        requestTime: null
      });
      console.log(`Event ${i}: FAILED - ${error.message}`);
    }
    
    await sleep(500);
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`Burst completed in ${totalTime}ms\n`);
  
  return { results, totalTime, chaosMode };
}

async function analyzeResults(testResults, scenario) {
  const { results, totalTime, chaosMode } = testResults;
  
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgLatency = results
    .filter(r => r.requestTime !== null)
    .reduce((sum, r) => sum + r.requestTime, 0) / results.length;
  
  console.log(`Results for ${scenario.description}:`);
  console.log(`- Success: ${success}/${results.length}`);
  console.log(`- Failed: ${failed}/${results.length}`);
  console.log(`- Average latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`- Total time: ${totalTime}ms`);
  
  // Check database for actual persistence
  await verifyDatabasePersistence(chaosMode);
}

async function verifyDatabasePersistence(chaosMode) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .gte('created_at', oneMinuteAgo)
      .eq('payload.chaosMode', chaosMode)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.log(`- DB verification failed: ${error.message}`);
      return;
    }
    
    const statuses = data.reduce((acc, event) => {
      acc[event.status] = (acc[event.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`- Database persistence: ${data.length} events`);
    console.log(`- Status breakdown:`, statuses);
    
    // Check for retry evidence
    const withRetries = data.filter(e => e.retries > 0);
    if (withRetries.length > 0) {
      console.log(`- Events with retries: ${withRetries.length}`);
      withRetries.forEach(event => {
        console.log(`  * ${event.event_id}: ${event.retries} retries`);
      });
    }
    
  } catch (err) {
    console.log(`- Database check error: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runControlledChaosTest().catch(console.error);
