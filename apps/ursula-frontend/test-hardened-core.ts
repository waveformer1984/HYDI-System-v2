// TEST HARDENED EVENT-SOURCED CORE
// Validating all 4 structural fixes

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { HermeticReplayEngine } from './src/lib/hermetic-replay.js';
import { CanonicalSnapshotManager } from './src/lib/canonical-snapshot.js';
import { PureTaskStateReducer, reduceEventStream } from './src/lib/pure-state-reducer.js';
import { ForensicAuditor } from './src/lib/forensic-audit.js';

async function main() {
  console.log('🧪 TESTING HARDENED EVENT-SOURCED CORE');
  console.log('=====================================\n');

  // Initialize ledger
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Create test events
  console.log('📝 Creating test events...');
  await ledger.appendEvent('task_created', 'task-1', {
    title: 'Critical Task',
    system: 'test',
    type: 'test',
    priority: 1,
    execution_mode: 'file'
  });
  
  await ledger.appendEvent('task_created', 'task-2', {
    title: 'Secondary Task',
    system: 'test',
    type: 'test',
    priority: 2,
    execution_mode: 'file'
  });
  
  await ledger.appendEvent('task_updated', 'task-1', {
    status: 'queued',
    state_version: 2
  });
  
  await ledger.appendEvent('task_claimed', 'task-1', {
    worker_id: 'worker-001'
  });
  
  await ledger.appendEvent('task_updated', 'task-2', {
    status: 'queued',
    state_version: 2
  });

  const commit = await ledger.commit();
  console.log(`   Created ${commit.sequence_end} events`);

  // Test 1: Hermetic Replay
  console.log('\n🛡️  Test 1: Hermetic Replay (Zero Memory Contamination)');
  const hermeticEngine = new HermeticReplayEngine(ledger);
  const hermeticCheck = await hermeticEngine.verifyHermeticProperties(10);
  
  console.log(`   Hermetic: ${hermeticCheck.hermetic ? '✅' : '❌'}`);
  console.log(`   Consistent: ${hermeticCheck.consistent ? '✅' : '❌'}`);
  console.log(`   Contamination events: ${hermeticCheck.contaminationEvents.length}`);
  
  if (hermeticCheck.contaminationEvents.length > 0) {
    console.log('   ⚠️  Contamination detected:');
    hermeticCheck.contaminationEvents.forEach(event => console.log(`      - ${event}`));
  }

  // Test 2: Canonical Snapshots
  console.log('\n📸 Test 2: Canonical Snapshot System');
  const snapshotManager = new CanonicalSnapshotManager();
  await snapshotManager.loadMetadata();
  
  // Get current state
  const events = await ledger.replayEvents();
  const stateMap = reduceEventStream(events);
  const tasks = Array.from(stateMap.values());
  
  // Create snapshot at sequence boundary
  const snapshot = await snapshotManager.createSnapshot(tasks, commit.sequence_end, true);
  console.log(`   Created snapshot: ${snapshot.snapshot_id}`);
  console.log(`   Sequence: ${snapshot.sequence_number}`);
  console.log(`   Hash: ${snapshot.state_hash.substring(0, 16)}...`);
  console.log(`   Size: ${snapshot.size_bytes} bytes`);
  
  // Verify snapshot integrity
  const snapshotValid = await snapshotManager.verifySnapshot(snapshot.snapshot_id);
  console.log(`   Integrity verified: ${snapshotValid ? '✅' : '❌'}`);
  
  // Test loading snapshot
  const loaded = await snapshotManager.loadSnapshot(commit.sequence_end);
  console.log(`   Load successful: ${loaded ? '✅' : '❌'}`);
  console.log(`   Loaded tasks: ${loaded?.tasks.length || 0}`);

  // Test 3: Pure State Reducer
  console.log('\n🔬 Test 3: Pure State Reducer (No Side Effects)');
  
  // Test purity
  const purityCheck = PureTaskStateReducer.verifyPurity();
  console.log(`   Is pure: ${purityCheck.isPure ? '✅' : '❌'}`);
  console.log(`   Has side effects: ${purityCheck.hasSideEffects ? '❌' : '✅'}`);
  console.log(`   External dependencies: ${purityCheck.hasExternalDependencies ? '❌' : '✅'}`);
  
  // Test deterministic reduction
  const reduction1 = reduceEventStream(events);
  const reduction2 = reduceEventStream(events);
  const hash1 = JSON.stringify([...reduction1.entries()]);
  const hash2 = JSON.stringify([...reduction2.entries()]);
  console.log(`   Deterministic: ${hash1 === hash2 ? '✅' : '❌'}`);
  
  // Test state consistency
  console.log(`   Tasks reduced: ${reduction1.size}`);
  for (const [taskId, task] of reduction1.entries()) {
    console.log(`      ${taskId}: ${task.title} (${task.status})`);
  }

  // Test 4: Forensic Audit
  console.log('\n🔍 Test 4: Forensic Audit System');
  const auditor = new ForensicAuditor();
  const auditReport = await auditor.performAudit(events, reduction1);
  
  console.log(`   Audit ID: ${auditReport.audit_id}`);
  console.log(`   Overall status: ${auditReport.overall_status.toUpperCase()}`);
  console.log(`   Events audited: ${auditReport.event_count}`);
  console.log(`   Tasks verified: ${auditReport.task_count}`);
  console.log(`   Violations: ${auditReport.integrity_violations.length}`);
  console.log(`   Anomalies: ${auditReport.anomalies.length}`);
  console.log(`   Timeline gaps: ${auditReport.timeline_gaps.length}`);
  console.log(`   State inconsistencies: ${auditReport.state_inconsistencies.length}`);
  
  if (auditReport.integrity_violations.length > 0) {
    console.log('   ⚠️  Violations:');
    auditReport.integrity_violations.forEach(v => {
      console.log(`      - ${v.type} (${v.severity}): ${v.description}`);
    });
  }

  // Test audit chain
  const chainCheck = await auditor.verifyAuditChain();
  console.log(`   Audit chain valid: ${chainCheck.valid ? '✅' : '❌'}`);

  // Final Assessment
  console.log('\n🎯 FINAL ASSESSMENT');
  console.log('===================');
  
  const allTestsPass = 
    hermeticCheck.hermetic && 
    hermeticCheck.consistent &&
    snapshotValid &&
    loaded !== null &&
    purityCheck.isPure &&
    hash1 === hash2 &&
    auditReport.overall_status !== 'fail';
  
  if (allTestsPass) {
    console.log('✅ ALL STRUCTURAL FIXES VALIDATED');
    console.log('\nHardened features working:');
    console.log('  ✓ Hermetic replay (no memory contamination)');
    console.log('  ✓ Canonical snapshots (sequence anchored)');
    console.log('  ✓ Pure state reducer (no side effects)');
    console.log('  ✓ Forensic audit (complete traceability)');
    console.log('\nThe event-sourced core is production-ready.');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('Review the issues above before production deployment.');
  }

  // Performance metrics
  console.log('\n📊 PERFORMANCE METRICS');
  console.log('=====================');
  const avgReplayTime = hermeticCheck.results.reduce((sum, r) => sum + r.executionTimeMs, 0) / hermeticCheck.results.length;
  console.log(`   Average replay time: ${avgReplayTime.toFixed(2)}ms`);
  console.log(`   Snapshot size: ${snapshot.size_bytes} bytes`);
  console.log(`   Events per second: ${(events.length / (avgReplayTime / 1000)).toFixed(0)}`);
}

main().catch(console.error);
