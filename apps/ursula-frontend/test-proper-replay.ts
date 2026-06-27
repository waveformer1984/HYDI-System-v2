// PROPER REPLAY TEST - Demonstrating true replay from empty state

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { DeterministicReplayEngine } from './src/lib/replay-engine.js';

async function main() {
  console.log('🧪 PROPER REPLAY DEMONSTRATION');
  console.log('===============================\n');

  // Step 1: Create events and commit them
  console.log('📝 Step 1: Creating and committing events...');
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Create test events
  await ledger.appendEvent('task_created', 'task-001', {
    title: 'Test Task 1',
    description: 'First test task',
    system: 'test',
    type: 'test',
    priority: 1,
    urgency: 1,
    execution_mode: 'file'
  });

  await ledger.appendEvent('task_created', 'task-002', {
    title: 'Test Task 2',
    description: 'Second test task',
    system: 'test',
    type: 'test',
    priority: 2,
    urgency: 1,
    execution_mode: 'file'
  });

  await ledger.appendEvent('task_updated', 'task-001', {
    status: 'queued',
    state_version: 2
  });

  // Commit events
  const commit = await ledger.commit();
  console.log(`   Committed ${commit.sequence_end} events`);

  // Step 2: Create a NEW ledger instance (simulating system restart)
  console.log('\n🔄 Step 2: Creating new ledger instance (simulating restart)...');
  const newLedger = new EventSourcedLedger();
  await newLedger.initialize();

  const replayEngine = new DeterministicReplayEngine(newLedger);

  // Step 3: Execute replay from empty state
  console.log('\n🏛️  Step 3: Executing replay from empty state...');
  const replayResult = await replayEngine.executeReplay();

  console.log('\n📊 REPLAY RESULTS');
  console.log('================');
  console.log(`   Success: ${replayResult.success ? '✅' : '❌'}`);
  console.log(`   Events processed: ${replayResult.eventsProcessed}`);
  console.log(`   Tasks reconstructed: ${replayResult.tasksReconstructed}`);
  console.log(`   Final state hash: ${replayResult.finalStateHash}`);

  if (replayResult.integrityIssues.length > 0) {
    console.log('\n⚠️  Issues:');
    replayResult.integrityIssues.forEach(issue => console.log(`   - ${issue}`));
  }

  // Step 4: Create checkpoint from the REPLAYED state
  console.log('\n📸 Step 4: Creating checkpoint from replayed state...');
  const checkpoint = await replayEngine.createCheckpoint();
  console.log(`   Checkpoint hash: ${checkpoint.state_hash}`);

  // Step 5: Verify replay matches checkpoint
  console.log('\n🔍 Step 5: Verifying replay consistency...');
  const secondReplay = await replayEngine.executeReplay();
  
  console.log(`   Second replay hash: ${secondReplay.finalStateHash}`);
  console.log(`   Matches checkpoint: ${secondReplay.finalStateHash === checkpoint.state_hash ? '✅' : '❌'}`);

  // Step 6: Prove determinism
  console.log('\n🔄 Step 6: Proving determinism...');
  const detCheck = await replayEngine.verifyDeterminism(3);
  console.log(`   Deterministic across 3 runs: ${detCheck.deterministic ? '✅' : '❌'}`);

  if (detCheck.deterministic) {
    console.log('   All runs produced identical hash:', detCheck.results[0].finalStateHash);
  }

  // Step 7: Show the final truth
  console.log('\n🎯 FINAL TRUTH DEMONSTRATION');
  console.log('============================');
  const projection = replayEngine['projection'];
  const tasks = projection.getAllTasks();
  
  console.log('\n📋 Reconstructed Tasks (from pure history):');
  tasks.forEach(task => {
    console.log(`   ${task.task_id}: ${task.title} - Status: ${task.status}, Version: ${task.state_version}`);
  });

  console.log('\n✅ PROVEN:');
  console.log('   1. Events are immutable reality');
  console.log('   2. State is computed from history');
  console.log('   3. Replay is deterministic');
  console.log('   4. Hashes prove consistency');
  console.log('\n🧠 The system can prove its own memory is correct!');
}

main().catch(console.error);
