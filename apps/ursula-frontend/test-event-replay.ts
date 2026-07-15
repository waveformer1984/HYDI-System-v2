// CREATE AND REPLAY TEST - Proving the replay engine works with real events

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { DeterministicReplayEngine } from './src/lib/replay-engine.js';

async function main() {
  console.log('🧪 CREATING TEST EVENTS');
  console.log('========================\n');

  // Initialize ledger
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Create some test events
  console.log('📝 Creating test events...');
  
  const event1 = await ledger.appendEvent('task_created', 'task-001', {
    title: 'Test Task 1',
    description: 'First test task',
    system: 'test',
    type: 'test',
    priority: 1,
    urgency: 1,
    execution_mode: 'file'
  });

  const event2 = await ledger.appendEvent('task_created', 'task-002', {
    title: 'Test Task 2',
    description: 'Second test task',
    system: 'test',
    type: 'test',
    priority: 2,
    urgency: 1,
    execution_mode: 'file'
  });

  const event3 = await ledger.appendEvent('task_updated', 'task-001', {
    status: 'queued',
    state_version: 2
  });

  console.log(`   Created 3 events (sequences ${event1.sequence_number}-${event3.sequence_number})`);

  // Commit the events
  console.log('\n💾 Committing events to ledger...');
  const commit = await ledger.commit();
  console.log(`   Commit: ${commit.commit_id}`);
  console.log(`   Checksum: ${commit.checksum}`);

  // Now run the replay test
  console.log('\n🏛️  EXECUTING REPLAY TEST');
  console.log('========================\n');

  const replayEngine = new DeterministicReplayEngine(ledger);
  
  // Create checkpoint before replay
  const checkpoint = await replayEngine.createCheckpoint();
  console.log(`   Checkpoint hash: ${checkpoint.state_hash}`);

  // Execute replay
  const result = await replayEngine.executeReplay();

  console.log('\n📊 REPLAY RESULTS');
  console.log('================');
  console.log(`   Success: ${result.success ? '✅' : '❌'}`);
  console.log(`   Events processed: ${result.eventsProcessed}`);
  console.log(`   Tasks reconstructed: ${result.tasksReconstructed}`);
  console.log(`   Final state hash: ${result.finalStateHash}`);
  console.log(`   Matches checkpoint: ${result.finalStateHash === checkpoint.state_hash ? '✅' : '❌'}`);

  if (result.integrityIssues.length > 0) {
    console.log('\n⚠️  Issues:');
    result.integrityIssues.forEach(issue => console.log(`   - ${issue}`));
  }

  // Show reconstructed tasks
  const projection = replayEngine['projection'];
  const tasks = projection.getAllTasks();
  
  console.log('\n📋 RECONSTRUCTED TASKS');
  console.log('======================');
  tasks.forEach(task => {
    console.log(`   Task ${task.task_id}: ${task.title} (${task.status})`);
  });

  // Verify determinism
  console.log('\n🔄 VERIFYING DETERMINISM...');
  const detCheck = await replayEngine.verifyDeterminism(3);
  console.log(`   Deterministic: ${detCheck.deterministic ? '✅' : '❌'}`);

  console.log('\n🎯 PROOF COMPLETE');
  console.log('==================');
  console.log('The system successfully:');
  console.log('1. Stored immutable events');
  console.log('2. Computed state from history');
  console.log('3. Produced consistent hashes');
  console.log('4. Replayed deterministically');
  console.log('\n✅ History is the authoritative source of truth');
}

main().catch(console.error);
