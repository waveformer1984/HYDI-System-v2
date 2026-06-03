// SIMPLE CHECKPOINT TEST - Clear demonstration of anchored replay

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { DeterministicReplayEngine } from './src/lib/replay-engine.js';

async function main() {
  console.log('🧪 SIMPLE CHECKPOINT TEST');
  console.log('========================\n');

  // Create fresh ledger
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Add events
  console.log('📝 Adding events...');
  await ledger.appendEvent('task_created', 'task-1', { title: 'Task 1', system: 'test', execution_mode: 'file' });
  await ledger.appendEvent('task_created', 'task-2', { title: 'Task 2', system: 'test', execution_mode: 'file' });
  await ledger.commit();
  console.log('   Added 2 events');

  // Create replay engine
  const replayEngine = new DeterministicReplayEngine(ledger);

  // Create checkpoint at current state
  console.log('\n📸 Creating checkpoint...');
  const checkpoint = await replayEngine.createCheckpoint();
  console.log(`   Sequence: ${checkpoint.sequence_number}`);
  console.log(`   Hash: ${checkpoint.state_hash}`);

  // Test replay matches checkpoint
  console.log('\n🏛️  Testing replay...');
  const replay = await replayEngine.executeReplay();
  
  console.log(`   Events processed: ${replay.eventsProcessed}`);
  console.log(`   Replay hash: ${replay.finalStateHash}`);
  console.log(`   Matches checkpoint: ${replay.finalStateHash === checkpoint.state_hash ? '✅' : '❌'}`);

  // Test determinism
  console.log('\n🔄 Testing determinism...');
  const detCheck = await replayEngine.verifyDeterminism(3);
  console.log(`   Deterministic: ${detCheck.deterministic ? '✅' : '❌'}`);

  // Show tasks
  const tasks = replayEngine['projection'].getAllTasks();
  console.log('\n📋 Tasks from replay:');
  tasks.forEach(t => console.log(`   ${t.task_id}: ${t.title}`));

  console.log('\n🎯 RESULT:');
  if (replay.success && detCheck.deterministic && replay.finalStateHash === checkpoint.state_hash) {
    console.log('✅ Checkpoint anchoring works');
    console.log('   - Events stored immutably');
    console.log('   - State reconstructed deterministically');
    console.log('   - Checkpoint matches replay');
  } else {
    console.log('❌ Issues detected');
  }
}

main().catch(console.error);
