/**
 * HYDI Adversarial Test Suite
 * Tests: illegal transitions, cross-role writes, idempotency, replay fidelity
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Test configuration
const TEST_CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  testRunCount: 10,
  maxEventsPerRun: 100
};

const supabase = createClient(TEST_CONFIG.supabaseUrl, TEST_CONFIG.supabaseKey);

// Helper: Generate state hash for fidelity comparison
function hashState(state) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(state, Object.keys(state).sort()))
    .digest('hex');
}

// Test 1: Illegal Transition Attempts
async function testIllegalTransitions() {
  console.log('\n🧪 TEST 1: Illegal Transitions');
  const failures = [];
  
  const illegalAttempts = [
    { from: 'initialized', to: 'verify', actor: 'auditor', desc: 'initialized → verify (skip phases)' },
    { from: 'audit', to: 'completed', actor: 'auditor', desc: 'audit → completed (skip execute)' },
    { from: 'execute', to: 'audit', actor: 'executor', desc: 'execute → audit (backwards)' },
    { from: 'verify', to: 'execute', actor: 'verifier', desc: 'verify → execute (backwards)' },
    { from: 'completed', to: 'audit', actor: 'auditor', desc: 'completed → audit (after terminal)' }
  ];
  
  for (const attempt of illegalAttempts) {
    try {
      // Create fresh run for each test
      const { data: run } = await supabase.rpc('create_test_run', {
        p_scope: ['test'],
        p_actor: 'ursula'
      });
      
      // Seed to starting phase
      if (attempt.from !== 'initialized') {
        await supabase.rpc('seed_run_phase', {
          p_run_id: run.run_id,
          p_phase: attempt.from
        });
      }
      
      // Attempt illegal transition
      const { error } = await supabase.rpc('hydi_transition', {

          p_run_id: run.run_id,
          p_from: attempt.from,
          p_to: attempt.to,
          p_payload: {},
          p_actor: attempt.actor,
          p_idempotency_key: `test-${Date.now()}`
        
      });
      
      if (!error) {
        failures.push(`❌ ${attempt.desc}: Should have been rejected but succeeded`);
      } else if (!error.message.includes('not allowed')) {
        failures.push(`⚠️  ${attempt.desc}: Wrong error: ${error.message}`);
      } else {
        console.log(`✅ ${attempt.desc}: Correctly rejected`);
      }
      
      // Cleanup
      await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
      
    } catch (e) {
      failures.push(`💥 ${attempt.desc}: Exception: ${e.message}`);
    }
  }
  
  return { passed: illegalAttempts.length - failures.length, total: illegalAttempts.length, failures };
}

// Test 2: Cross-Role Write Attempts
async function testCrossRoleWrites() {
  console.log('\n🧪 TEST 2: Cross-Role Write Boundaries');
  const failures = [];
  
  const crossRoleTests = [
    { actor: 'executor', table: 'hydi_findings', data: { component: 'test', severity: 'CRITICAL' }, desc: 'EXECUTOR writing findings (HEIDI only)' },
    { actor: 'verifier', table: 'hydi_findings', data: { component: 'test', severity: 'WARNING' }, desc: 'VERIFIER writing findings (HEIDI only)' },
    { actor: 'auditor', table: 'hydi_tasks', data: { task_name: 'test', status: 'pending' }, desc: 'AUDITOR writing tasks (EXECUTOR only)' },
    { actor: 'verifier', table: 'hydi_tasks', data: { task_name: 'test', status: 'completed' }, desc: 'VERIFIER writing tasks (EXECUTOR only)' },
    { actor: 'auditor', table: 'hydi_verifications', data: { component: 'test', status: 'pass' }, desc: 'AUDITOR writing verifications (KILO only)' },
    { actor: 'executor', table: 'hydi_verifications', data: { component: 'test', status: 'fail' }, desc: 'EXECUTOR writing verifications (KILO only)' },
    { actor: 'auditor', table: 'hydi_certifications', data: { certificate_status: 'CLEAN' }, desc: 'AUDITOR writing certification (KILO only)' },
    { actor: 'executor', table: 'hydi_certifications', data: { certificate_status: 'CONDITIONAL' }, desc: 'EXECUTOR writing certification (KILO only)' }
  ];
  
  for (const test of crossRoleTests) {
    try {
      // Create run
      const { data: run } = await supabase.rpc('create_test_run', {
        p_scope: ['test'],
        p_actor: 'ursula'
      });
      
      // Attempt write with wrong role JWT
      const { error } = await supabase
        .from(test.table)
        .insert({ ...test.data, run_id: run.run_id })
        .setHeader('X-Client-Info', JSON.stringify({ agent_role: test.actor }));
      
      if (!error) {
        failures.push(`❌ ${test.desc}: Write succeeded but should have been rejected`);
      } else if (error.code !== '42501') { // RLS policy violation
        failures.push(`⚠️  ${test.desc}: Wrong error code: ${error.code}`);
      } else {
        console.log(`✅ ${test.desc}: Correctly rejected (RLS)`);
      }
      
      await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
      
    } catch (e) {
      failures.push(`💥 ${test.desc}: Exception: ${e.message}`);
    }
  }
  
  return { passed: crossRoleTests.length - failures.length, total: crossRoleTests.length, failures };
}

// Test 3: Idempotency / Duplicate Event Handling
async function testIdempotency() {
  console.log('\n🧪 TEST 3: Idempotency');
  const failures = [];
  
  try {
    // Create run
    const { data: run } = await supabase.rpc('create_test_run', {
      p_scope: ['test'],
      p_actor: 'ursula'
    });
    
    const idempotencyKey = `test-${Date.now()}`;
    
    // First transition
    const { data: result1, error: error1 } = await supabase.rpc('hydi_transition', {

        p_run_id: run.run_id,
        p_from: 'initialized',
        p_to: 'audit',
        p_payload: { test: 1 },
        p_actor: 'auditor',
        p_idempotency_key: idempotencyKey
      
      });
    
    if (error1) {
      failures.push(`❌ First transition failed: ${error1.message}`);
      return { passed: 0, total: 3, failures };
    }
    
    console.log('✅ First transition succeeded');
    
    // Duplicate with same key (should be idempotent)
    const { data: result2, error: error2 } = await supabase.rpc('hydi_transition', {

        p_run_id: run.run_id,
        p_from: 'initialized',
        p_to: 'audit',
        p_payload: { test: 2 }, // Different payload
        p_actor: 'auditor',
        p_idempotency_key: idempotencyKey
      
      });
    
    if (error2) {
      // Check if it's a duplicate key error (expected)
      if (error2.message.includes('duplicate') || error2.message.includes('conflict')) {
        console.log('✅ Duplicate correctly rejected');
      } else {
        failures.push(`⚠️  Duplicate gave unexpected error: ${error2.message}`);
      }
    } else if (result2.event_id !== result1.event_id) {
      failures.push(`❌ Duplicate created new event: ${result2.event_id} vs ${result1.event_id}`);
    } else {
      console.log('✅ Duplicate correctly idempotent');
    }
    
    // Different key should succeed
    const { data: result3, error: error3 } = await supabase.rpc('hydi_transition', {

        p_run_id: run.run_id,
        p_from: 'audit',
        p_to: 'execute',
        p_payload: { test: 3 },
        p_actor: 'auditor',
        p_idempotency_key: `${idempotencyKey}-2`
      
      });
    
    if (error3) {
      failures.push(`❌ Different key transition failed: ${error3.message}`);
    } else {
      console.log('✅ Different key transition succeeded');
    }
    
    await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
    
  } catch (e) {
    failures.push(`💥 Idempotency test exception: ${e.message}`);
  }
  
  return { passed: 3 - failures.length, total: 3, failures };
}

// Test 4: Replay Fidelity
async function testReplayFidelity() {
  console.log('\n🧪 TEST 4: Replay Fidelity');
  const failures = [];
  
  try {
    // Create full lifecycle run
    const { data: run } = await supabase.rpc('create_test_run', {
      p_scope: ['test'],
      p_actor: 'ursula'
    });
    
    // Execute full lifecycle with known state
    const lifecycle = [
      { from: 'initialized', to: 'audit', actor: 'auditor', payload: { findings: 5 } },
      { from: 'audit', to: 'execute', actor: 'auditor', payload: { critical: 2 } },
      { from: 'execute', to: 'verify', actor: 'executor', payload: { tasks_done: 3 } },
      { from: 'verify', to: 'completed', actor: 'verifier', payload: { passed: 10, failed: 0 } }
    ];
    
    // Store terminal state hash after each transition
    const stateHashes = [];
    
    for (let i = 0; i < lifecycle.length; i++) {
      const step = lifecycle[i];
      
      const { error } = await supabase.rpc('hydi_transition', {

          p_run_id: run.run_id,
          p_from: step.from,
          p_to: step.to,
          p_payload: step.payload,
          p_actor: step.actor,
          p_idempotency_key: `fidelity-${run.run_id}-${i}`
        
      });
      
      if (error) {
        failures.push(`❌ Lifecycle step ${i} failed: ${error.message}`);
        break;
      }
      
      // Get current state and hash
      const { data: state } = await supabase.rpc('hydi_reconstruct_run', {
        p_run_id: run.run_id
      });
      
      stateHashes.push({
        step: i,
        phase: step.to,
        hash: hashState(state.current_state)
      });
    }
    
    // Now reconstruct from events and compare
    const { data: reconstructed } = await supabase.rpc('hydi_reconstruct_run', {
      p_run_id: run.run_id
    });
    
    const finalHash = hashState(reconstructed.current_state);
    const expectedHash = stateHashes[stateHashes.length - 1]?.hash;
    
    if (finalHash !== expectedHash) {
      failures.push(`❌ Replay fidelity mismatch: ${finalHash} vs ${expectedHash}`);
    } else {
      console.log('✅ Replay fidelity verified');
    }
    
    // Verify event sequence integrity
    const { data: events } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('run_id', run.run_id)
      .order('seq');
    
    const seqGaps = events.filter((e, i) => e.seq !== i + 1);
    if (seqGaps.length > 0) {
      failures.push(`❌ Event sequence gaps detected: ${seqGaps.length} issues`);
    } else {
      console.log('✅ Event sequence integrity verified');
    }
    
    await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
    
  } catch (e) {
    failures.push(`💥 Replay fidelity test exception: ${e.message}`);
  }
  
  return { passed: 2 - failures.length, total: 2, failures };
}

// Test 5: Performance SLOs
async function testPerformanceSLOs() {
  console.log('\n🧪 TEST 5: Performance SLOs');
  const results = {
    transitionLatencies: [],
    replayDurations: [],
    failureRates: { total: 0, failed: 0 }
  };
  
  // Measure transition latency
  for (let i = 0; i < 20; i++) {
    const { data: run } = await supabase.rpc('create_test_run', {
      p_scope: ['perf-test'],
      p_actor: 'ursula'
    });
    
    const start = Date.now();
    
    const { error } = await supabase.rpc('hydi_transition', {

        p_run_id: run.run_id,
        p_from: 'initialized',
        p_to: 'audit',
        p_payload: {},
        p_actor: 'auditor',
        p_idempotency_key: `perf-${i}`
      
      });
    
    const latency = Date.now() - start;
    results.transitionLatencies.push(latency);
    
    if (error) results.failureRates.failed++;
    results.failureRates.total++;
    
    await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
  }
  
  // Calculate percentiles
  const sorted = results.transitionLatencies.sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  
  console.log(`📊 Transition Latency: p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`);
  console.log(`📊 Failure Rate: ${(results.failureRates.failed / results.failureRates.total * 100).toFixed(2)}%`);
  
  // Test replay with 1k events
  const { data: run } = await supabase.rpc('create_test_run', {
    p_scope: ['replay-test'],
    p_actor: 'ursula'
  });
  
  // Generate 1000 events (simulated batch)
  await supabase.rpc('seed_many_events', {
    p_run_id: run.run_id,
    p_count: 1000
  });
  
  const replayStart = Date.now();
  await supabase.rpc('hydi_reconstruct_run', { p_run_id: run.run_id });
  const replayDuration = Date.now() - replayStart;
  
  console.log(`📊 Replay Duration (1k events): ${replayDuration}ms`);
  
  await supabase.rpc('delete_test_run', { p_run_id: run.run_id });
  
  // SLO Targets
  const sloTargets = {
    transitionP95: 500, // ms
    transitionP99: 1000, // ms
    replay1k: 5000, // ms
    failureRate: 0.01 // 1%
  };
  
  const failures = [];
  if (p95 > sloTargets.transitionP95) failures.push(`❌ p95 latency ${p95}ms exceeds SLO ${sloTargets.transitionP95}ms`);
  if (p99 > sloTargets.transitionP99) failures.push(`❌ p99 latency ${p99}ms exceeds SLO ${sloTargets.transitionP99}ms`);
  if (replayDuration > sloTargets.replay1k) failures.push(`❌ Replay duration ${replayDuration}ms exceeds SLO ${sloTargets.replay1k}ms`);
  if (results.failureRates.failed / results.failureRates.total > sloTargets.failureRate) {
    failures.push(`❌ Failure rate exceeds SLO ${sloTargets.failureRate * 100}%`);
  }
  
  return { passed: failures.length === 0 ? 1 : 0, total: 1, failures, metrics: { p95, p99, replayDuration, failureRate: results.failureRates.failed / results.failureRates.total } };
}

// Main test runner
async function runAllTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   HYDI Adversarial Test Suite v2.0.0');
  console.log('═══════════════════════════════════════════════════');
  
  const results = {
    illegalTransitions: await testIllegalTransitions(),
    crossRoleWrites: await testCrossRoleWrites(),
    idempotency: await testIdempotency(),
    replayFidelity: await testReplayFidelity(),
    performanceSLOs: await testPerformanceSLOs()
  };
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  
  let totalPassed = 0;
  let totalTests = 0;
  
  for (const [name, result] of Object.entries(results)) {
    console.log(`${name}: ${result.passed}/${result.total} passed`);
    if (result.failures?.length > 0) {
      result.failures.forEach(f => console.log(`  ${f}`));
    }
    totalPassed += result.passed;
    totalTests += result.total;
  }
  
  console.log(`\nOVERALL: ${totalPassed}/${totalTests} tests passed`);
  
  if (totalPassed === totalTests) {
    console.log('\n✅ All governance controls verified');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed - review before production');
    process.exit(1);
  }
}

runAllTests().catch(e => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
