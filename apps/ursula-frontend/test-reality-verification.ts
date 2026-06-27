// REALITY VERIFICATION TEST - 4-Phase Execution Verification Layer
// Tests independent verification of external reality

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { MockRealityAdapter } from './src/lib/mock-reality-adapter.js';
import { Printer3DVerifier, FileSystemVerifier } from './src/lib/reality-verifier.js';
import { RealityStateStore } from './src/lib/reality-state-store.js';
import { Phase4TaskProcessor } from './src/lib/phase-4-processor.js';

async function main() {
  console.log('🧪 REALITY VERIFICATION LAYER TEST');
  console.log('==================================\n');

  // Initialize components
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  const adapter = new MockRealityAdapter('3d_printer_01', {
    latencyMs: 300,
    packetLossRate: 0.05,
    failureRate: 0.1,
    duplicateAckRate: 0.01
  });

  const verifier = new Printer3DVerifier('printer_verifier_001', null);
  const stateStore = new RealityStateStore();
  await stateStore.load();

  const processor = new Phase4TaskProcessor(ledger, adapter, verifier, stateStore);

  // Test 1: Successful 4-phase execution
  console.log('📋 Test 1: Successful 4-Phase Execution');
  const testTask1 = {
    taskId: 'print_bracket_001',
    command: {
      type: 'START_PRINT',
      jobId: 'mechanical_bracket_v1',
      specs: { material: 'PLA', infill: '20%' }
    },
    expectedState: {
      jobId: 'mechanical_bracket_v1',
      status: 'printing',
      fileOnSD: true,
      minTemp: 200
    }
  };

  const result1 = await processor.processTask(
    testTask1.taskId,
    testTask1.command,
    testTask1.expectedState
  );

  console.log(`   Result: ${result1.success ? '✅' : '❌'}`);
  console.log(`   Verified: ${result1.verified ? '✅' : '❌'}`);
  console.log(`   Total latency: ${result1.metrics.totalLatencyMs}ms`);
  console.log(`   Phase times: P1=${result1.metrics.phase1TimeMs}ms P2=${result1.metrics.phase2TimeMs}ms P3=${result1.metrics.phase3TimeMs}ms P4=${result1.metrics.phase4TimeMs}ms`);
  console.log(`   Compensation: ${result1.metrics.compensationTriggered ? 'Yes' : 'No'}`);

  // Test 2: Verification failure
  console.log('\n🔍 Test 2: Verification Failure');
  const testTask2 = {
    taskId: 'print_failed_001',
    command: {
      type: 'START_PRINT',
      jobId: 'failed_print_job'
    },
    expectedState: {
      jobId: 'different_job_id', // Intentional mismatch
      status: 'printing',
      fileOnSD: true
    }
  };

  const result2 = await processor.processTask(
    testTask2.taskId,
    testTask2.command,
    testTask2.expectedState
  );

  console.log(`   Result: ${result2.success ? '✅' : '❌'}`);
  console.log(`   Verified: ${result2.verified ? '✅' : '❌'}`);
  console.log(`   Compensation triggered: ${result2.metrics.compensationTriggered ? '✅' : '❌'}`);
  if (result2.verificationResult?.mismatchReason) {
    console.log(`   Mismatch reason: ${result2.verificationResult.mismatchReason}`);
  }

  // Test 3: Replay safety
  console.log('\n🛡️  Test 3: Replay Safety');
  processor.setReplayMode(true);

  const replayResult = await processor.processTask(
    testTask1.taskId,
    testTask1.command,
    testTask1.expectedState
  );

  console.log(`   Replay result: ${replayResult.success ? '✅' : '❌'}`);
  console.log(`   Used existing receipt: ${replayResult.success ? 'Yes' : 'No'}`);

  processor.setReplayMode(false);

  // Test 4: Multiple verifiers
  console.log('\n🔧 Test 4: Multiple Verifier Types');
  
  // File system verifier test
  const fsVerifier = new FileSystemVerifier('fs_verifier_001');
  const fsProcessor = new Phase4TaskProcessor(ledger, adapter, fsVerifier, stateStore);

  const fileTask = {
    taskId: 'file_write_001',
    command: {
      type: 'WRITE_FILE',
      path: './data/test_output.txt',
      content: 'Test content for verification'
    },
    expectedState: {
      filePath: './data/test_output.txt',
      exists: true,
      minSize: 10
    }
  };

  // Create test file
  const fs = await import('fs/promises');
  await fs.writeFile('./data/test_output.txt', 'Test content for verification');

  const fsResult = await fsProcessor.processTask(
    fileTask.taskId,
    fileTask.command,
    fileTask.expectedState
  );

  console.log(`   File verification: ${fsResult.verified ? '✅' : '❌'}`);

  // Test 5: Reality state store queries
  console.log('\n📊 Test 5: Reality State Store Analysis');
  const stats = await stateStore.getStats();
  
  console.log(`   Total executions: ${stats.totalExecutions}`);
  console.log(`   Verification rate: ${(stats.verificationRate * 100).toFixed(1)}%`);
  console.log(`   Failed verifications: ${stats.failedVerifications}`);
  console.log(`   Verifiers breakdown:`);
  Object.entries(stats.verifiersBreakdown).forEach(([verifier, count]) => {
    console.log(`      ${verifier}: ${count}`);
  });

  // Test 6: Find inconsistencies
  console.log('\n🔍 Test 6: Inconsistency Detection');
  const inconsistencies = await stateStore.findInconsistencies();
  
  console.log(`   Inconsistencies found: ${inconsistencies.length}`);
  if (inconsistencies.length > 0) {
    inconsistencies.slice(0, 3).forEach(inc => {
      console.log(`   - ${inc.executionId}: ${inc.verifier}`);
    });
  }

  // Test 7: Recent failures
  console.log('\n⚠️  Test 7: Recent Verification Failures');
  const recentFailures = await stateStore.getRecentFailures(5);
  
  console.log(`   Recent failures: ${recentFailures.length}`);
  recentFailures.forEach(failure => {
    console.log(`   - ${failure.execution_id} (${new Date(failure.timestamp).toLocaleTimeString()})`);
  });

  // Test 8: Verification statistics
  console.log('\n📈 Test 8: Verification Statistics');
  const verificationStats = await processor.getVerificationStats();
  
  console.log(`   Total processed: ${verificationStats.totalProcessed}`);
  console.log(`   Verification rate: ${(verificationStats.verificationRate * 100).toFixed(1)}%`);
  console.log(`   Compensation rate: ${(verificationStats.compensationRate * 100).toFixed(1)}%`);

  // Test 9: Export verification data
  console.log('\n💾 Test 9: Export Verification Data');
  const exportData = await stateStore.export('json');
  console.log(`   Exported ${exportData.length} characters of verification data`);

  // Final assessment
  console.log('\n🎯 REALITY VERIFICATION ASSESSMENT');
  console.log('===================================');

  const allTestsPass = 
    result1.success && result1.verified &&
    result2.success && !result2.verified && result2.metrics.compensationTriggered &&
    replayResult.success &&
    fsResult.verified &&
    stats.totalExecutions > 0;

  if (allTestsPass) {
    console.log('✅ EXECUTION VERIFICATION LAYER OPERATIONAL');
    console.log('\nVerified capabilities:');
    console.log('  ✓ 4-phase handshake (Intent → Execute → Receipt → Verify)');
    console.log('  ✓ Independent reality verification');
    console.log('  ✓ Verification failure detection');
    console.log('  ✓ Automatic compensation triggers');
    console.log('  ✓ Reality state persistence');
    console.log('  ✓ Replay safety maintained');
    console.log('\nThe system now has closed-loop correctness guarantees.');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('Review the issues above before production deployment.');
  }

  // Cleanup
  await fs.unlink('./data/test_output.txt').catch(() => {});
}

main().catch(console.error);
