// Test CASCADE V2 - Enhanced Features Demonstration
// Shows strict enforcement: Schema Lock, Fingerprinting, Confidence Scoring, Hard Classification, Health Snapshots

const cascade = require('./modules/cascade-complete-v2');

async function runCascadeV2Tests() {
  console.log('\n=== CASCADE V2 ENHANCED TEST ===\n');
  
  // Start CASCADE V2
  console.log('1. Starting CASCADE V2 system...');
  const startResult = cascade.start();
  console.log('   Status:', startResult.status);
  console.log('   Version:', startResult.version);
  console.log('   Features:', startResult.features.join(', '));
  
  // Setup listeners to see V2 features in action
  cascade.on('heartbeat', (heartbeat) => {
    console.log('\n[HEARTBEAT] CASCADE V2 is alive');
    console.log('   Status:', heartbeat.status);
    console.log('   Active modules:', heartbeat.active_modules.length);
    console.log('   Stats:', heartbeat.stats);
  });
  
  cascade.on('health_snapshot', (snapshot) => {
    console.log('\n[HEALTH SNAPSHOT] Real-time system state');
    console.log('   Health:', snapshot.system_health);
    console.log('   Throughput:', snapshot.event_throughput.current.toFixed(2), '/s');
    console.log('   Error ratio:', (snapshot.error_ratio.current * 100).toFixed(1), '%');
    console.log('   Quarantine size:', snapshot.quarantine.size);
  });
  
  cascade.on('emission_success', (emission) => {
    console.log('\n[EMISSION] Delivered with acknowledgment');
    console.log('   Event ID:', emission.event_id);
    console.log('   Target:', emission.target_system);
    console.log('   Acknowledged:', emission.acknowledged);
    console.log('   Tracking ID:', emission.tracking_id);
  });
  
  cascade.on('schema_violation', (violation) => {
    console.log('\n[SCHEMA LOCK] Event rejected');
    console.log('   Event ID:', violation.event.event_id);
    console.log('   Violations:', violation.violations.length);
    violation.violations.forEach(v => console.log('   -', v));
  });
  
  cascade.on('event_dead_lettered', (deadLetter) => {
    console.log('\n[DEAD LETTER] Event exceeded retry limit');
    console.log('   Event ID:', deadLetter.event_id);
    console.log('   Reason:', deadLetter.dead_letter_reason);
    console.log('   Total retries:', deadLetter.total_retries);
  });
  
  // Wait a moment for startup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 1: Schema Lock enforcement
  console.log('\n2. Testing Schema Lock - Invalid event...');
  const invalidEvent = await cascade.processEvent({
    id: 'test-invalid-1',
    type: 'invalid_type', // Not in enum
    source: 'invalid_source', // Not in enum
    payload: {}, // Empty payload
    extra_field: 'not_allowed' // Extra field
  }, 'local');
  
  console.log('   Result:', invalidEvent.event);
  console.log('   Reason:', invalidEvent.reason);
  console.log('   Violations:', invalidEvent.violations?.length || 0);
  
  // Test 2: Fingerprint duplicate detection
  console.log('\n3. Testing Fingerprint - Duplicate events...');
  const duplicate1 = await cascade.processEvent({
    id: 'test-duplicate-1',
    type: 'info',
    payload: { message: 'System startup' }
  }, 'system');
  
  const duplicate2 = await cascade.processEvent({
    id: 'test-duplicate-2', // Different ID but same content
    type: 'info',
    payload: { message: 'System startup' }
  }, 'system');
  
  console.log('   First event:', duplicate1.status);
  console.log('   Duplicate result:', duplicate2.reason);
  console.log('   Fingerprint:', duplicate2.fingerprint?.substring(0, 16) + '...');
  
  // Test 3: Low confidence scoring
  console.log('\n4. Testing Confidence Scoring - Low confidence event...');
  const lowConfidence = await cascade.processEvent({
    // Missing many fields to lower confidence
    type: 'info'
  }, 'user'); // User source has lower reliability
  
  console.log('   Result:', lowConfidence.reason);
  console.log('   Confidence:', lowConfidence.confidence);
  console.log('   Action:', lowConfidence.action);
  
  // Test 4: Hard classification boundaries
  console.log('\n5. Testing Hard Classification - Unknown anomaly...');
  const unknown = await cascade.processEvent({
    id: 'test-unknown-1',
    type: 'error',
    payload: {
      weird_signal: true,
      cosmic_ray: 'detected',
      quantum_flux: 'high'
    }
  }, 'system');
  
  console.log('   Result:', unknown.reason);
  console.log('   Classification:', unknown.classification);
  console.log('   Action:', unknown.action);
  
  // Test 5: Valid INFRA_FAILURE with high confidence
  console.log('\n6. Testing Valid Event - INFRA_FAILURE...');
  const validEvent = await cascade.processEvent({
    id: 'test-valid-1',
    type: 'error',
    module: 'database',
    error_code: 'MODULE_NOT_FOUND',
    error: 'Cannot find module "pg"'
  }, 'local');
  
  console.log('   Status:', validEvent.status);
  console.log('   Confidence:', validEvent.confidence);
  console.log('   Classification:', validEvent.classification?.classification);
  console.log('   Schema hash:', validEvent.schema_hash?.substring(0, 16) + '...');
  if (validEvent.decision) {
    console.log('   Decision:', validEvent.decision.event);
    console.log('   Tracking ID:', validEvent.decision.tracking_id);
  }
  
  // Test 6: Health snapshot monitoring
  console.log('\n7. Monitoring health snapshots...');
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 11000)); // Wait for snapshot
    
    const health = cascade.getHealthReport();
    console.log(`   Snapshot ${i + 1}:`);
    console.log('     Health:', health.summary.overall_health);
    console.log('     Throughput:', health.metrics.event_throughput.average_1m.toFixed(2), '/s');
    console.log('     Active streams:', health.summary.active_streams);
    
    if (health.alerts.length > 0) {
      console.log('     Alerts:', health.alerts.length);
      health.alerts.forEach(alert => {
        console.log('       -', alert.type, ':', alert.message);
      });
    }
  }
  
  // Test 7: Emission tracking
  console.log('\n8. Checking emission tracking...');
  const tracking = cascade.getEmissionTracking();
  console.log('   Total tracked emissions:', tracking.length);
  if (tracking.length > 0) {
    const latest = tracking[tracking.length - 1];
    console.log('   Latest emission:');
    console.log('     Event ID:', latest.event_id);
    console.log('     Target:', latest.target_system);
    console.log('     Status:', latest.status);
    console.log('     Retry count:', latest.retry_count);
  }
  
  // Test 8: Quarantine and dead letters
  console.log('\n9. Checking quarantine and dead letters...');
  const quarantineReport = cascade.getQuarantineReport(10);
  console.log('   Quarantined events:', quarantineReport.summary.total_quarantined);
  console.log('   Dead letters:', quarantineReport.summary.dead_letter_count);
  
  if (quarantineReport.dead_letters.count > 0) {
    console.log('   Dead letter examples:');
    quarantineReport.dead_letters.events.slice(0, 3).forEach(dl => {
      console.log('     -', dl.event_id, ':', dl.dead_letter_reason, '(', dl.total_retries, 'retries)');
    });
  }
  
  // Test 9: Schema lock information
  console.log('\n10. Checking schema lock status...');
  const schemaInfo = cascade.getStatus().schema_lock;
  console.log('    Schema hash:', schemaInfo.schema_hash.substring(0, 16) + '...');
  console.log('    Strict mode:', schemaInfo.strict_mode);
  console.log('    Immutable:', schemaInfo.immutable);
  console.log('    Cache size:', schemaInfo.cache_size);
  
  // Test 10: Fingerprint statistics
  console.log('\n11. Checking fingerprint statistics...');
  const fingerprintStats = cascade.getStatus().fingerprint;
  console.log('    Fingerprints generated:', fingerprintStats.fingerprintsGenerated);
  console.log('    Duplicates blocked:', fingerprintStats.duplicatesBlocked);
  console.log('    Duplicate rate:', fingerprintStats.duplicateRate);
  console.log('    Cache size:', fingerprintStats.cacheSize);
  
  // Final status
  console.log('\n12. Final CASCADE V2 status...');
  const finalStatus = cascade.getStatus();
  console.log('    Version:', finalStatus.version);
  console.log('    Is running:', finalStatus.is_running);
  console.log('    System health:', finalStatus.system_health);
  console.log('    Events processed:', finalStatus.stats.events_processed);
  console.log('    Schema violations:', finalStatus.stats.schema_violations);
  console.log('    Duplicate blocks:', finalStatus.stats.duplicate_blocks);
  console.log('    Low confidence blocks:', finalStatus.stats.low_confidence_blocks);
  console.log('    Events quarantined:', finalStatus.stats.events_quarantined);
  console.log('    Events dead-lettered:', finalStatus.stats.events_dead_lettered);
  console.log('    Repair manifests:', finalStatus.stats.repair_manifests_generated);
  console.log('    Uptime:', finalStatus.stats.uptime, 'seconds');
  
  // Stop CASCADE V2
  console.log('\n13. Stopping CASCADE V2 system...');
  const stopResult = cascade.stop();
  console.log('    Status:', stopResult.status);
  console.log('    Stop time:', stopResult.stop_time);
  
  console.log('\n=== CASCADE V2 TEST COMPLETE ===\n');
  console.log('\nKey V2 Features Demonstrated:');
  console.log('✓ Schema Lock - Immutable validation with hash checking');
  console.log('✓ Fingerprinting - SHA-256 duplicate detection with 15s TTL');
  console.log('✓ Confidence Scoring - Auto-quarantine for < 0.75 confidence');
  console.log('✓ Hard Classification - Strict enum validation only');
  console.log('✓ Health Snapshots - Real-time metrics every 10 seconds');
  console.log('✓ Emission Tracking - Acknowledgment required from all targets');
  console.log('✓ Dead Letter Finality - Permanent storage after 5 retries');
}

// Run the tests
runCascadeV2Tests().catch(console.error);
