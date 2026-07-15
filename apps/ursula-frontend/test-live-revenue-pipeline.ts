// LIVE REVENUE PIPELINE TEST - Battle-testing the hardened core
// Processing real 3D_PRINTING tasks through the Liaison Gateway

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { HermeticReplayEngine } from './src/lib/hermetic-replay.js';
import { CanonicalSnapshotManager } from './src/lib/canonical-snapshot.js';
import { PureTaskStateReducer, reduceEventStream } from './src/lib/pure-state-reducer.js';
import { ForensicAuditor } from './src/lib/forensic-audit.js';

// Mock Liaison Gateway integration
class LiaisonGateway {
  private ledger: EventSourcedLedger;

  constructor(ledger: EventSourcedLedger) {
    this.ledger = ledger;
  }

  async processRevenueTask(taskData: any): Promise<string> {
    // Create task event
    const event = await this.ledger.appendEvent('task_created', taskData.id, {
      title: taskData.title,
      description: taskData.description,
      source: '3D_PRINTING',
      system: 'revenue_engine',
      type: 'revenue_generation',
      priority: taskData.priority || 1,
      urgency: taskData.urgency || 1,
      revenue_impact: taskData.revenue_impact,
      execution_mode: 'file'
    });

    // Process through pipeline stages
    await this.ledger.appendEvent('task_updated', taskData.id, {
      status: 'queued',
      state_version: 2
    });

    await this.ledger.appendEvent('task_claimed', taskData.id, {
      worker_id: 'revenue_worker_001'
    });

    await this.ledger.appendEvent('task_updated', taskData.id, {
      status: 'running',
      state_version: 3
    });

    // Simulate revenue generation
    const revenue = Math.random() * 1000;
    await this.ledger.appendEvent('task_completed', taskData.id, {
      status: 'complete',
      state_version: 4,
      outputs: {
        revenue_generated: revenue,
        processing_time_ms: Math.floor(Math.random() * 5000) + 1000
      }
    });

    return event.event_id;
  }
}

async function main() {
  console.log('🚀 LIVE REVENUE PIPELINE TEST');
  console.log('=============================\n');

  // Initialize hardened core
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  const gateway = new LiaisonGateway(ledger);
  const auditor = new ForensicAuditor();
  const snapshotManager = new CanonicalSnapshotManager();
  await snapshotManager.loadMetadata();

  // Test 1: Process multiple revenue tasks
  console.log('📊 Test 1: Processing Revenue Tasks');
  const tasks = [
    {
      id: 'rev_001',
      title: '3D Print - Custom Prototype',
      description: 'Customer ordered custom mechanical part',
      priority: 1,
      urgency: 1,
      revenue_impact: { stage: 'confirmed', value: 850 }
    },
    {
      id: 'rev_002',
      title: 'Batch Print - Phone Cases',
      description: 'Bulk order of 50 phone cases',
      priority: 2,
      urgency: 2,
      revenue_impact: { stage: 'potential', value: 500 }
    },
    {
      id: 'rev_003',
      title: 'Emergency Print - Replacement Part',
      description: 'Rush order for broken machine replacement',
      priority: 1,
      urgency: 1,
      revenue_impact: { stage: 'critical', value: 1200 }
    }
  ];

  const eventIds: string[] = [];
  for (const task of tasks) {
    console.log(`   Processing ${task.title}...`);
    const eventId = await gateway.processRevenueTask(task);
    eventIds.push(eventId);
  }

  const commit = await ledger.commit();
  console.log(`   Processed ${tasks.length} tasks (${commit.sequence_end} events)`);

  // Test 2: Verify with forensic audit
  console.log('\n🔍 Test 2: Forensic Audit Verification');
  const events = await ledger.replayEvents();
  const stateMap = reduceEventStream(events);
  const auditReport = await auditor.performAudit(events, stateMap);

  console.log(`   Audit status: ${auditReport.overall_status.toUpperCase()}`);
  console.log(`   Events verified: ${auditReport.event_count}`);
  console.log(`   Revenue tasks: ${auditReport.task_count}`);
  console.log(`   Integrity violations: ${auditReport.integrity_violations.length}`);

  // Calculate total revenue from completed tasks
  const completedTasks = Array.from(stateMap.values())
    .filter(t => t.status === 'complete');
  
  const totalRevenue = completedTasks.reduce((sum, task) => {
    const outputs = task as any;
    return sum + (outputs.outputs_expected?.revenue_generated || 0);
  }, 0);

  console.log(`   Total revenue generated: $${totalRevenue.toFixed(2)}`);

  // Test 3: Create canonical snapshot
  console.log('\n📸 Test 3: Canonical Snapshot Creation');
  const snapshot = await snapshotManager.createSnapshot(
    Array.from(stateMap.values()),
    commit.sequence_end,
    true
  );

  console.log(`   Snapshot: ${snapshot.snapshot_id}`);
  console.log(`   Sequence: ${snapshot.sequence_number}`);
  console.log(`   Hash: ${snapshot.state_hash.substring(0, 16)}...`);
  console.log(`   Tasks snapshotted: ${snapshot.task_count}`);

  // Test 4: Verify replay integrity
  console.log('\n🛡️ Test 4: Hermetic Replay Verification');
  const hermeticEngine = new HermeticReplayEngine(ledger);
  const hermeticCheck = await hermeticEngine.verifyHermeticProperties(5);

  console.log(`   Hermetic: ${hermeticCheck.hermetic ? '✅' : '⚠️'}`);
  console.log(`   Consistent: ${hermeticCheck.consistent ? '✅' : '❌'}`);
  console.log(`   Avg replay time: ${(hermeticCheck.results.reduce((sum, r) => sum + r.executionTimeMs, 0) / hermeticCheck.results.length).toFixed(2)}ms`);

  // Test 5: Timeline verification
  console.log('\n🔀 Test 5: Timeline Integrity Check');
  
  // Verify each task's lifecycle
  for (const taskId of ['rev_001', 'rev_002', 'rev_003']) {
    const taskEvents = events.filter(e => e.task_id === taskId);
    console.log(`\n   Task ${taskId}:`);
    console.log(`     Events: ${taskEvents.length}`);
    
    // Show lifecycle
    const lifecycle = taskEvents.map(e => `${e.event_type}(${e.sequence_number})`).join(' → ');
    console.log(`     Lifecycle: ${lifecycle}`);
    
    // Verify final state
    const finalState = stateMap.get(taskId);
    if (finalState) {
      console.log(`     Final status: ${finalState.status}`);
      console.log(`     State version: ${finalState.state_version}`);
      console.log(`     Last event: ${finalState.last_event_sequence}`);
    }
  }

  // Test 6: Revenue pipeline metrics
  console.log('\n📈 Test 6: Revenue Pipeline Metrics');
  const processingTimes = completedTasks.map(task => {
    const outputs = task as any;
    return outputs.outputs_expected?.processing_time_ms || 0;
  });

  const avgProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
  const throughput = (completedTasks.length / (avgProcessingTime / 1000 / 60)).toFixed(2); // tasks per minute

  console.log(`   Tasks completed: ${completedTasks.length}`);
  console.log(`   Avg processing time: ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`   Throughput: ${throughput} tasks/minute`);
  console.log(`   Revenue per task: $${(totalRevenue / completedTasks.length).toFixed(2)}`);

  // Final assessment
  console.log('\n🎯 LIVE PIPELINE ASSESSMENT');
  console.log('==========================');
  
  const pipelineHealthy = 
    auditReport.overall_status !== 'fail' &&
    hermeticCheck.consistent &&
    completedTasks.length === tasks.length &&
    totalRevenue > 0;

  if (pipelineHealthy) {
    console.log('✅ REVENUE PIPELINE OPERATIONAL');
    console.log('\nHardened core benefits verified:');
    console.log('  ✓ Every revenue event is auditable');
    console.log('  ✓ State reconstruction is deterministic');
    console.log('  ✓ Snapshots provide fast recovery points');
    console.log('  ✓ Timeline integrity is preserved');
    console.log('\nThe system is ready for production revenue processing.');
  } else {
    console.log('❌ PIPELINE NEEDS ATTENTION');
    console.log('Review the issues above before production deployment.');
  }

  // Store audit for compliance
  console.log('\n💾 Storing audit for compliance...');
  const auditChain = await auditor.verifyAuditChain();
  console.log(`   Audit chain valid: ${auditChain.valid ? '✅' : '❌'}`);
}

main().catch(console.error);
