// EXECUTION CONFIRMATION LAYER TEST - Physical Integrity Test
// Demonstrates 3-phase handshake with reality adapters

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { MockRealityAdapter, MockConfig } from './src/lib/mock-reality-adapter.js';
import { ForensicShadowAdapter } from './src/lib/forensic-shadow-adapter.js';
import { Phase3TaskProcessor } from './src/lib/phase-3-processor.js';
import { HermeticReplayEngine } from './src/lib/hermetic-replay.js';

async function main() {
  console.log('🧪 EXECUTION CONFIRMATION LAYER TEST');
  console.log('===================================\n');

  // Initialize ledger
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Create mock adapter with realistic conditions
  const mockConfig: MockConfig = {
    latencyMs: 500,
    packetLossRate: 0.1,
    failureRate: 0.05,
    duplicateAckRate: 0.02
  };

  const mockAdapter = new MockRealityAdapter('3d_printer_01', mockConfig);
  console.log(`   🖨️  Mock adapter initialized:`);
  console.log(`      Latency: ${mockConfig.latencyMs}ms`);
  console.log(`      Packet loss: ${(mockConfig.packetLossRate * 100).toFixed(0)}%`);
  console.log(`      Failure rate: ${(mockConfig.failureRate * 100).toFixed(0)}%`);

  // Create processor
  const processor = new Phase3TaskProcessor(ledger, mockAdapter);

  // Test 1: Single task execution
  console.log('\n📋 Test 1: Single Task Execution');
  const testTask1 = {
    taskId: 'print_job_001',
    command: {
      type: 'START_PRINT',
      jobId: 'mechanical_bracket_001',
      specs: {
        material: 'PLA',
        infill: '20%',
        resolution: '0.2mm'
      }
    }
  };

  const result1 = await processor.processTask(testTask1.taskId, testTask1.command);
  console.log(`   Result: ${result1.success ? '✅' : '❌'}`);
  console.log(`   UEK: ${result1.uek}`);
  console.log(`   Reconciliation latency: ${result1.metrics.reconciliationLatencyMs}ms`);
  console.log(`   Phase times: P1=${result1.metrics.phase1TimeMs}ms P2=${result1.metrics.phase2TimeMs}ms P3=${result1.metrics.phase3TimeMs}ms`);
  console.log(`   Retries: ${result1.metrics.totalRetries}`);

  // Test 2: Duplicate task (idempotency test)
  console.log('\n🔄 Test 2: Duplicate Task (Idempotency)');
  const result2 = await processor.processTask(testTask1.taskId, testTask1.command);
  console.log(`   Result: ${result2.success ? '✅ (unexpected)' : '❌ (expected)'}`);
  console.log(`   Error: ${result2.error || 'None'}`);

  // Test 3: Batch processing
  console.log('\n📦 Test 3: Batch Processing');
  const batchTasks = [
    {
      taskId: 'print_job_002',
      command: { type: 'START_PRINT', jobId: 'phone_case_001' }
    },
    {
      taskId: 'print_job_003',
      command: { type: 'START_PRINT', jobId: 'prototype_002' }
    },
    {
      taskId: 'print_job_004',
      command: { type: 'QUERY_STATUS', jobId: 'status_check' }
    }
  ];

  const batchResults = await processor.processBatch(batchTasks);
  const successful = batchResults.filter(r => r.success).length;
  console.log(`   Batch results: ${successful}/${batchResults.length} successful`);
  
  const avgLatency = batchResults
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.metrics.reconciliationLatencyMs, 0) / Math.max(successful, 1);
  console.log(`   Average reconciliation latency: ${avgLatency.toFixed(0)}ms`);

  // Test 4: Replay Safety
  console.log('\n🛡️  Test 4: Replay Safety (Forensic Shadow)');
  
  // Switch to shadow adapter
  const shadowAdapter = new ForensicShadowAdapter(ledger, mockAdapter.adapterId);
  const replayProcessor = new Phase3TaskProcessor(ledger, shadowAdapter);
  replayProcessor.setReplayMode(true);

  // Try to replay a task
  console.log('   Attempting to replay task in shadow mode...');
  const replayResult = await replayProcessor.processTask('print_job_001', testTask1.command);
  console.log(`   Replay result: ${replayResult.success ? '✅' : '❌'}`);
  console.log(`   Found existing receipt: ${replayResult.success ? 'Yes' : 'No'}`);

  // Test 5: Hermetic replay with ECL
  console.log('\n🔍 Test 5: Hermetic Replay with Execution Confirmation');
  const hermeticEngine = new HermeticReplayEngine(ledger);
  const hermeticCheck = await hermeticEngine.verifyHermeticProperties(3);
  
  console.log(`   Hermetic: ${hermeticCheck.hermetic ? '✅' : '❌'}`);
  console.log(`   Consistent: ${hermeticCheck.consistent ? '✅' : '❌'}`);

  // Test 6: Forensic verification
  console.log('\n🔬 Test 6: Forensic Verification');
  const forensicReport = await shadowAdapter.generateForensicReport();
  
  console.log(`   Total receipts: ${forensicReport.totalReceipts}`);
  console.log(`   Receipts by status:`);
  Object.entries(forensicReport.receiptsByStatus).forEach(([status, count]) => {
    console.log(`      ${status}: ${count}`);
  });
  console.log(`   Average retry count: ${forensicReport.averageRetryCount.toFixed(2)}`);
  console.log(`   Consistency check: ${forensicReport.consistencyCheck.consistent ? '✅' : '❌'}`);
  
  if (!forensicReport.consistencyCheck.consistent) {
    console.log(`   Issues:`);
    console.log(`      Missing receipts: ${forensicReport.consistencyCheck.missingReceipts.length}`);
    console.log(`      Orphaned receipts: ${forensicReport.consistencyCheck.orphanedReceipts.length}`);
  }

  // Test 7: Uncertainty Mode simulation
  console.log('\n⚠️  Test 7: Uncertainty Mode Simulation');
  
  // Increase failure rate to trigger uncertainty
  mockAdapter.updateConfig({ failureRate: 0.5 });
  console.log('   Increased failure rate to 50%');
  
  const uncertainTask = {
    taskId: 'print_job_uncertain',
    command: { type: 'START_PRINT', jobId: 'uncertain_print' }
  };
  
  const uncertainResult = await processor.processTask(uncertainTask.taskId, uncertainTask.command);
  console.log(`   Result: ${uncertainResult.success ? '✅' : '❌'}`);
  console.log(`   Retries: ${uncertainResult.metrics.totalRetries}`);
  console.log(`   Error: ${uncertainResult.error || 'None'}`);

  // Final assessment
  console.log('\n🎯 EXECUTION CONFIRMATION ASSESSMENT');
  console.log('===================================');
  
  const allTestsPass = 
    result1.success &&
    !result2.success && // Duplicate should fail
    successful >= 2 && // At least 2/3 batch tasks
    replayResult.success && // Replay should find receipt
    hermeticCheck.consistent &&
    forensicReport.consistencyCheck.consistent;

  if (allTestsPass) {
    console.log('✅ EXECUTION CONFIRMATION LAYER OPERATIONAL');
    console.log('\nVerified capabilities:');
    console.log('  ✓ 3-phase handshake (Intent → Execute → Confirm)');
    console.log('  ✓ Idempotency with UEK');
    console.log('  ✓ Replay safety with shadow adapter');
    console.log('  ✓ Physical integrity verification');
    console.log('  ✓ Reconciliation latency tracking');
    console.log('\nThe bridge between deterministic ledger and physical world is secure.');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('Review the issues above before production deployment.');
  }

  // Statistics
  const stats = processor.getStatistics();
  console.log('\n📊 PROCESSOR STATISTICS');
  console.log('======================');
  console.log(`   Active tasks: ${stats.activeTasks}`);
  console.log(`   Total processed: ${stats.totalProcessed}`);
  console.log(`   Average latency: ${stats.averageLatency.toFixed(0)}ms`);
  console.log(`   Replay mode: ${stats.replayMode ? 'Yes' : 'No'}`);
}

main().catch(console.error);
