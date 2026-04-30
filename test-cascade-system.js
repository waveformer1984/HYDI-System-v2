// Test CASCADE System - Demonstrates strict event processing
// Shows how CASCADE: Detects -> Classifies -> Emits structured events

const cascade = require('./modules/cascade-complete');

async function runCascadeTests() {
  console.log('\n=== CASCADE SYSTEM TEST ===\n');
  
  // Start CASCADE
  console.log('1. Starting CASCADE system...');
  const startResult = cascade.start();
  console.log('   Status:', startResult.status);
  console.log('   Start time:', startResult.start_time);
  
  // Setup listeners to see CASCADE in action
  cascade.on('heartbeat', (heartbeat) => {
    console.log('\n[HEARTBEAT] CASCADE is alive');
    console.log('   Status:', heartbeat.status);
    console.log('   Active modules:', heartbeat.active_modules.length);
    console.log('   Events processed:', heartbeat.stats.events_processed);
  });
  
  cascade.on('emission_success', (emission) => {
    console.log('\n[EMISSION] Event delivered successfully');
    console.log('   Event ID:', emission.event_id);
    console.log('   Delivered to:', emission.delivered_to);
  });
  
  cascade.on('quarantine_resolved', (record) => {
    console.log('\n[QUARANTINE] Event resolved and released');
    console.log('   Event ID:', record.event_id);
    console.log('   Released by:', record.released_by);
  });
  
  // Wait a moment for startup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 1: INFRA_FAILURE detection
  console.log('\n2. Testing INFRA_FAILURE detection...');
  const infraFailure = await cascade.processEvent({
    id: 'test-1',
    type: 'error',
    module: 'database',
    error_code: 'MODULE_NOT_FOUND',
    error: 'Cannot find module "pg"'
  }, 'local');
  
  console.log('   Result:', infraFailure.status);
  console.log('   Classification:', infraFailure.classification?.classification);
  console.log('   Confidence:', infraFailure.classification?.confidence);
  if (infraFailure.decision) {
    console.log('   Decision:', infraFailure.decision.event);
    console.log('   Issue:', infraFailure.decision.issue);
    console.log('   Steps:', infraFailure.decision.steps.join(' -> '));
  }
  
  // Test 2: STREAM_BREAK detection
  console.log('\n3. Testing STREAM_BREAK detection...');
  const streamBreak = await cascade.processEvent({
    id: 'test-2',
    type: 'error',
    stream_id: 'user-stream-123',
    websocket_error: true,
    connection_lost: true
  }, 'system');
  
  console.log('   Result:', streamBreak.status);
  console.log('   Classification:', streamBreak.classification?.classification);
  if (streamBreak.decision) {
    console.log('   Action:', streamBreak.decision.payload.action);
    console.log('   Target:', streamBreak.decision.payload.target);
  }
  
  // Test 3: DEPLOYMENT_MISMATCH detection
  console.log('\n4. Testing DEPLOYMENT_MISMATCH detection...');
  const deployMismatch = await cascade.processEvent({
    id: 'test-3',
    type: 'warning',
    env_var_missing: 'DATABASE_URL',
    version_mismatch: 'v2.1.0 != v2.0.0',
    config_diff: true
  }, 'vercel');
  
  console.log('   Result:', deployMismatch.status);
  console.log('   Classification:', deployMismatch.classification?.classification);
  if (deployMismatch.decision) {
    console.log('   Action:', deployMismatch.decision.payload.action);
    console.log('   Target system:', deployMismatch.decision.target_system);
  }
  
  // Test 4: Unknown anomaly (should be quarantined)
  console.log('\n5. Testing UNKNOWN_ANOMALY (quarantine)...');
  const unknown = await cascade.processEvent({
    id: 'test-4',
    type: 'info',
    weird_signal: true,
    anomaly_type: 'cosmic_ray_detection',
    quantum_flux: 'high'
  }, 'user');
  
  console.log('   Result:', unknown.status);
  console.log('   Classification:', unknown.classification?.classification);
  if (unknown.event === 'quarantined_signal') {
    console.log('   QUARANTINED - Reason:', unknown.reason);
    console.log('   Retry policy:', unknown.retry_policy);
  }
  
  // Test 5: Duplicate event detection
  console.log('\n6. Testing duplicate event detection...');
  const duplicate1 = await cascade.processEvent({
    id: 'test-5',
    type: 'info',
    message: 'System startup complete'
  }, 'system');
  
  const duplicate2 = await cascade.processEvent({
    id: 'test-5',
    type: 'info',
    message: 'System startup complete'
  }, 'system');
  
  console.log('   First event:', duplicate1.status);
  console.log('   Duplicate event:', duplicate2.event);
  console.log('   Reason:', duplicate2.reason);
  
  // Wait for heartbeats
  console.log('\n7. Waiting for heartbeats...');
  await new Promise(resolve => setTimeout(resolve, 25000));
  
  // Check quarantine status
  console.log('\n8. Checking quarantine status...');
  const quarantineReport = cascade.getQuarantineReport(10);
  console.log('   Total quarantined:', quarantineReport.summary.total_quarantined);
  console.log('   By status:', quarantineReport.summary.by_status);
  console.log('   By reason:', quarantineReport.summary.by_reason);
  
  // Manual release from quarantine
  if (quarantineReport.summary.total_quarantined > 0) {
    console.log('\n9. Manually releasing from quarantine...');
    const firstQuarantined = quarantineReport.events[0];
    if (firstQuarantined) {
      const releaseResult = cascade.manualReleaseFromQuarantine(
        firstQuarantined.event_id,
        'test_operator'
      );
      console.log('   Released:', releaseResult.event_id);
      console.log('   Status:', releaseResult.status);
    }
  }
  
  // Final status
  console.log('\n10. Final CASCADE status...');
  const finalStatus = cascade.getStatus();
  console.log('    Is running:', finalStatus.is_running);
  console.log('    System health:', finalStatus.system_health);
  console.log('    Events processed:', finalStatus.stats.events_processed);
  console.log('    Events rejected:', finalStatus.stats.events_rejected);
  console.log('    Events quarantined:', finalStatus.stats.events_quarantined);
  console.log('    Repair manifests:', finalStatus.stats.repair_manifests_generated);
  console.log('    Uptime:', finalStatus.stats.uptime, 'seconds');
  
  // Stop CASCADE
  console.log('\n11. Stopping CASCADE system...');
  const stopResult = cascade.stop();
  console.log('   Status:', stopResult.status);
  console.log('   Stop time:', stopResult.stop_time);
  
  console.log('\n=== CASCADE TEST COMPLETE ===\n');
}

// Run the tests
runCascadeTests().catch(console.error);
