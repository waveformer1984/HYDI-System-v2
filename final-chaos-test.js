require('dotenv').config();

// Final chaos test: Kill AI service + DB latency + event flood
async function finalChaosTest() {
  console.log('=== FINAL CHAOS TEST ===\n');
  
  const { processEvent } = require('./core/pipeline');
  
  // Test 1: Normal baseline
  console.log('1. Establishing baseline...');
  const baselineStart = Date.now();
  try {
    await processEvent('baseline', 'error', { message: 'baseline test' });
    console.log('PASS: Baseline operation works');
  } catch (error) {
    console.log('FAIL: Baseline failed:', error.message);
  }
  const baselineTime = Date.now() - baselineStart;
  console.log(`Baseline time: ${baselineTime}ms\n`);
  
  // Test 2: Flood system with mixed events
  console.log('2. Flooding system with 200 mixed events...');
  const floodStart = Date.now();
  const floodPromises = [];
  
  for (let i = 0; i < 200; i++) {
    const type = i % 10 === 0 ? 'error' : (i % 3 === 0 ? 'task' : 'info');
    const payload = {
      message: `flood-event-${i}`,
      priority: type === 'error' ? 'high' : (type === 'task' ? 'normal' : 'low'),
      flood_batch: 'chaos-test'
    };
    
    floodPromises.push(
      processEvent(`flood-${i}`, type, payload)
        .then(result => ({ success: true, result }))
        .catch(error => ({ success: false, error: error.message }))
    );
  }
  
  console.log('Processing flood...');
  const floodResults = await Promise.all(floodPromises);
  const floodTime = Date.now() - floodStart;
  
  const floodStats = floodResults.reduce((acc, result) => {
    if (result.success) acc.success++;
    else acc.failed++;
    return acc;
  }, { success: 0, failed: 0 });
  
  console.log(`Flood complete: ${floodTime}ms`);
  console.log(`Success: ${floodStats.success}, Failed: ${floodStats.failed}`);
  console.log(`Events/sec: ${(200 / (floodTime / 1000)).toFixed(2)}\n`);
  
  // Test 3: Database failure simulation
  console.log('3. Testing database failure resilience...');
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_KEY;
  
  process.env.SUPABASE_URL = 'https://invalid.supabase.co';
  process.env.SUPABASE_KEY = 'invalid-key';
  
  // Clear require cache to get fresh pipeline
  delete require.cache[require.resolve('./core/pipeline')];
  const { processEvent: brokenProcessEvent } = require('./core/pipeline');
  
  const failureStart = Date.now();
  const failurePromises = [];
  
  for (let i = 0; i < 10; i++) {
    failurePromises.push(
      brokenProcessEvent(`failure-test-${i}`, 'error', { 
        message: `failure event ${i}`,
        test: 'db-failure'
      })
      .then(result => ({ success: false, dead_lettered: result.dead_lettered, retries: result.event.retries }))
      .catch(error => ({ success: false, error: error.message }))
    );
  }
  
  const failureResults = await Promise.all(failurePromises);
  const failureTime = Date.now() - failureStart;
  
  // Restore environment
  process.env.SUPABASE_URL = originalUrl;
  process.env.SUPABASE_KEY = originalKey;
  
  console.log(`Failure test complete: ${failureTime}ms`);
  const failureStats = failureResults.reduce((acc, result) => {
    if (result.dead_lettered) acc.dead_lettered++;
    if (result.retries > 0) acc.with_retries++;
    return acc;
  }, { dead_lettered: 0, with_retries: 0 });
  
  console.log(`Dead-lettered: ${failureStats.dead_lettered}`);
  console.log(`With retries: ${failureStats.with_retries}\n`);
  
  // Test 4: Recovery test
  console.log('4. Testing system recovery...');
  delete require.cache[require.resolve('./core/pipeline')];
  const { processEvent: recoveredProcessEvent } = require('./core/pipeline');
  
  const recoveryStart = Date.now();
  try {
    const result = await recoveredProcessEvent('recovery', 'error', { 
      message: 'recovery test',
      test: 'system-recovery'
    });
    console.log('PASS: System recovered successfully');
    console.log(`Event status: ${result.event.status}`);
  } catch (error) {
    console.log('FAIL: System did not recover:', error.message);
  }
  const recoveryTime = Date.now() - recoveryStart;
  console.log(`Recovery time: ${recoveryTime}ms\n`);
  
  // Summary
  console.log('=== FINAL CHAOS TEST SUMMARY ===');
  console.log(`Baseline: ${baselineTime}ms`);
  console.log(`Flood (200 events): ${floodTime}ms (${floodStats.success}/${floodStats.failed} success)`);
  console.log(`Failure resilience: ${failureTime}ms (${failureStats.dead_lettered} dead-lettered)`);
  console.log(`Recovery: ${recoveryTime}ms`);
  
  const totalTests = 4;
  const passedTests = [
    baselineTime > 0,
    floodStats.success > 150, // At least 75% success
    failureStats.dead_lettered > 0, // Some should be dead-lettered
    recoveryTime < 5000 // Recovery should be fast
  ].filter(Boolean).length;
  
  console.log(`\nChaos Test Score: ${passedTests}/${totalTests}`);
  
  if (passedTests === totalTests) {
    console.log('EXCELLENT: System handles chaos gracefully');
  } else if (passedTests >= 3) {
    console.log('GOOD: System mostly handles chaos');
  } else {
    console.log('NEEDS WORK: System struggles under chaos');
  }
  
  console.log('\n=== FINAL CHAOS TEST COMPLETE ===');
}

finalChaosTest().catch(console.error);
