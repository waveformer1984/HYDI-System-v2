// LIVE HANDSHAKE - First Side Effect Execution
// Transition from forensic replay to live action

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { HermeticReplayEngine } from './src/lib/hermetic-replay.js';
import { CanonicalSnapshotManager } from './src/lib/canonical-snapshot.js';
import { PureTaskStateReducer, reduceEventStream } from './src/lib/pure-state-reducer.js';
import { ForensicAuditor } from './src/lib/forensic-audit.js';

// Mock 3D Printing Engine Interface
class Mock3DPrintingEngine {
  private printerState: 'idle' | 'starting' | 'running' | 'error' = 'idle';
  private failureRate: number;

  constructor(failureRate: number = 0.2) {
    this.failureRate = failureRate;
  }

  async startJob(jobId: string, specs: any): Promise<{ success: boolean; error?: string }> {
    console.log(`   🖨️  3D Printer: Starting job ${jobId}`);
    this.printerState = 'starting';
    
    // Simulate hardware response time
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Simulate potential failure
    if (Math.random() < this.failureRate) {
      this.printerState = 'error';
      return { success: false, error: 'Printer hardware fault' };
    }
    
    this.printerState = 'running';
    return { success: true };
  }

  async getJobStatus(jobId: string): Promise<{ status: string; progress?: number }> {
    if (this.printerState === 'error') {
      return { status: 'failed' };
    }
    if (this.printerState === 'running') {
      return { status: 'running', progress: Math.floor(Math.random() * 100) };
    }
    return { status: 'idle' };
  }

  getState() {
    return this.printerState;
  }
}

// Probabilistic Actuator (Relay)
class ProbabilisticActuator {
  private ledger: EventSourcedLedger;
  private printer: Mock3DPrintingEngine;
  private activeLeases: Map<string, string> = new Map();

  constructor(ledger: EventSourcedLedger, printer: Mock3DPrintingEngine) {
    this.ledger = ledger;
    this.printer = printer;
  }

  async claimTaskLease(taskId: string, workerId: string): Promise<boolean> {
    if (this.activeLeases.has(taskId)) {
      return false; // Already claimed
    }
    this.activeLeases.set(taskId, workerId);
    return true;
  }

  async executeTask(taskId: string, specs: any): Promise<void> {
    const workerId = '3d_printing_relay_001';
    
    // Claim lease
    const leaseClaimed = await this.claimTaskLease(taskId, workerId);
    if (!leaseClaimed) {
      await this.ledger.appendEvent('task_failed', taskId, {
        error: 'Failed to claim task lease',
        failure_type: 'fatal'
      });
      return;
    }

    // Write task_claimed event
    await this.ledger.appendEvent('task_claimed', taskId, {
      worker_id: workerId
    });

    // Write task_started event
    await this.ledger.appendEvent('task_updated', taskId, {
      status: 'running',
      state_version: 3
    });

    try {
      // Execute side effect - interact with hardware
      const result = await this.printer.startJob(taskId, specs);
      
      if (result.success) {
        // Success path
        await this.ledger.appendEvent('task_completed', taskId, {
          status: 'complete',
          state_version: 4,
          outputs: {
            job_completed: true,
            printer_state: this.printer.getState()
          }
        });
        console.log(`   ✅ Task ${taskId} completed successfully`);
      } else {
        // Failure path - trigger failure taxonomy
        await this.handleTaskFailure(taskId, result.error || 'Unknown error');
      }
    } catch (error) {
      await this.handleTaskFailure(taskId, `Execution error: ${error}`);
    } finally {
      // Release lease
      this.activeLeases.delete(taskId);
    }
  }

  private async handleTaskFailure(taskId: string, error: string): Promise<void> {
    // Check retry count
    const events = await this.ledger.replayEvents();
    const taskEvents = events.filter(e => e.task_id === taskId);
    const failures = taskEvents.filter(e => e.event_type === 'task_failed');
    
    if (failures.length >= 3) {
      // Max retries reached - dead letter
      await this.ledger.appendEvent('task_failed', taskId, {
        error: error,
        failure_type: 'fatal',
        retry_count: failures.length + 1,
        dead_lettered: true
      });
      console.log(`   ⚰️  Task ${taskId} moved to DEAD LETTER after ${failures.length + 1} failures`);
    } else {
      // Retryable failure
      await this.ledger.appendEvent('task_failed', taskId, {
        error: error,
        failure_type: 'transient',
        retry_count: failures.length + 1
      });
      console.log(`   ⚠️  Task ${taskId} failed transiently (attempt ${failures.length + 1})`);
    }
  }
}

async function executeLiveHandshake() {
  console.log('🚀 LIVE HANDSHAKE EXECUTION');
  console.log('==========================\n');

  // Initialize hardened core
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  const auditor = new ForensicAuditor();
  const snapshotManager = new CanonicalSnapshotManager();
  await snapshotManager.loadMetadata();

  // Step 1: Verify audit chain is valid
  console.log('🔍 Step 1: Verifying Audit Chain');
  const auditChain = await auditor.verifyAuditChain();
  console.log(`   Audit chain valid: ${auditChain.valid ? '✅' : '❌'}`);
  
  if (!auditChain.valid) {
    console.log('   ❌ Audit chain broken - aborting live execution');
    return;
  }

  // Step 2: Initialize components
  console.log('\n🔧 Step 2: Initializing Components');
  const printer = new Mock3DPrintingEngine(0.3); // 30% failure rate for testing
  const actuator = new ProbabilisticActuator(ledger, printer);
  console.log(`   3D Printer initialized (failure rate: 30%)`);
  console.log(`   Probabilistic Actuator ready`);

  // Step 3: Create initial snapshot
  console.log('\n📸 Step 3: Creating Pre-Execution Snapshot');
  const events = await ledger.replayEvents();
  const stateMap = reduceEventStream(events);
  const preSnapshot = await snapshotManager.createSnapshot(
    Array.from(stateMap.values()),
    events.length,
    true
  );
  console.log(`   Pre-execution snapshot: ${preSnapshot.snapshot_id}`);

  // Step 4: Inject first Revenue Intent
  console.log('\n💉 Step 4: Injecting Revenue Intent');
  const revenueTask = {
    id: '3d_job_001',
    title: 'Live Test Print - Mechanical Bracket',
    description: 'First live execution on hardened core',
    source: '3D_PRINTING',
    system: 'revenue_engine',
    type: 'manufacturing',
    priority: 1,
    urgency: 1,
    revenue_impact: { stage: 'confirmed', value: 250 },
    execution_mode: 'file',
    specs: {
      material: 'PLA',
      infill: '20%',
      resolution: '0.2mm',
      supports: true
    }
  };

  // The Ingestion Gate - Event #N+1
  console.log('   📍 Ingestion Gate: Capturing intent...');
  const ingestEvent = await ledger.appendEvent('task_created', revenueTask.id, {
    title: revenueTask.title,
    description: revenueTask.description,
    source: revenueTask.source,
    system: revenueTask.system,
    type: revenueTask.type,
    priority: revenueTask.priority,
    urgency: revenueTask.urgency,
    revenue_impact: revenueTask.revenue_impact,
    execution_mode: revenueTask.execution_mode,
    specs: revenueTask.specs
  });
  console.log(`   Event #${ingestEvent.sequence_number} created: ${ingestEvent.event_id}`);

  // The Reducer Pass
  console.log('\n   🔄 Reducer Pass: Validating transition...');
  const currentState = stateMap.get(revenueTask.id) || null;
  const reducerResult = PureTaskStateReducer.reduce(currentState, ingestEvent);
  
  if (reducerResult.sideEffects.length > 0) {
    console.log(`   ⚠️  Reducer detected side effects: ${reducerResult.sideEffects.join(', ')}`);
  }
  console.log(`   State projection updated: ${reducerResult.newState.status}`);

  // Queue the task
  await ledger.appendEvent('task_updated', revenueTask.id, {
    status: 'queued',
    state_version: 2
  });
  console.log(`   Task queued for execution`);

  // Step 5: The Execution Handshake
  console.log('\n⚡ Step 5: Execution Handshake');
  console.log('   🤝 Probabilistic Actuator claiming task...');
  
  // Monitor the execution
  actuator.executeTask(revenueTask.id, revenueTask.specs).then(async () => {
    // Step 6: Post-execution audit
    console.log('\n🔍 Step 6: Post-Execution Forensic Audit');
    
    const finalEvents = await ledger.replayEvents();
    const finalStateMap = reduceEventStream(finalEvents);
    const finalAudit = await auditor.performAudit(finalEvents, finalStateMap);
    
    console.log(`   Audit status: ${finalAudit.overall_status.toUpperCase()}`);
    console.log(`   Total events: ${finalAudit.event_count}`);
    console.log(`   Integrity violations: ${finalAudit.integrity_violations.length}`);
    
    if (finalAudit.integrity_violations.length > 0) {
      console.log('   ⚠️  Violations detected:');
      finalAudit.integrity_violations.forEach(v => {
        console.log(`      - ${v.type}: ${v.description}`);
      });
    }

    // Step 7: Create post-execution snapshot
    console.log('\n📸 Step 7: Creating Post-Execution Snapshot');
    const postSnapshot = await snapshotManager.createSnapshot(
      Array.from(finalStateMap.values()),
      finalEvents.length,
      true
    );
    console.log(`   Post-execution snapshot: ${postSnapshot.snapshot_id}`);
    
    // Verify timeline continuity
    const timelineGaps = finalAudit.timeline_gaps;
    console.log(`   Timeline gaps: ${timelineGaps.length}`);
    
    if (timelineGaps.length === 0 && finalAudit.overall_status !== 'fail') {
      console.log('\n🎯 LIVE HANDSHAKE COMPLETE');
      console.log('========================');
      console.log('✅ First side effect executed successfully');
      console.log('✅ Timeline integrity maintained');
      console.log('✅ Audit chain preserved');
      console.log('\nThe hardened core is now LIVE and authorizing the future.');
    } else {
      console.log('\n❌ LIVE HANDSHAKE ISSUES DETECTED');
      console.log('Review audit report before proceeding.');
    }
  });

  // Commit events
  const commit = await ledger.commit();
  console.log(`\n💾 Committed events up to sequence ${commit.sequence_end}`);
}

// Execute the live handshake
executeLiveHandshake().catch(console.error);
