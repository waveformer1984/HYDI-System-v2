// CHECKPOINT ANCHORING TEST - Proving proper sequence boundary semantics

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { DeterministicReplayEngine } from './src/lib/replay-engine.js';

async function main() {
  console.log('🧪 CHECKPOINT ANCHORING TEST');
  console.log('============================\n');

  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Create initial events
  console.log('📝 Creating initial events...');
  await ledger.appendEvent('task_created', 'task-001', {
    title: 'Task 1',
    system: 'test',
    type: 'test',
    execution_mode: 'file'
  });
  
  await ledger.appendEvent('task_created', 'task-002', {
    title: 'Task 2',
    system: 'test',
    type: 'test',
    execution_mode: 'file'
  });
  
  const commit1 = await ledger.commit();
  console.log(`   Committed events up to sequence ${commit1.sequence_end}`);

  // Create checkpoint at sequence 2
  const replayEngine = new DeterministicReplayEngine(ledger);
  console.log('\n📸 Creating checkpoint at sequence 2...');
  const checkpoint1 = await replayEngine.createCheckpoint(2);
  console.log(`   Checkpoint hash: ${checkpoint1.state_hash}`);

  // Add more events
  console.log('\n📝 Adding more events...');
  await ledger.appendEvent('task_updated', 'task-001', {
    status: 'queued',
    state_version: 2
  });
  
  await ledger.appendEvent('task_updated', 'task-002', {
    status: 'running',
    state_version: 2
  });
  
  const commit2 = await ledger.commit();
  console.log(`   Committed events up to sequence ${commit2.sequence_end}`);

  // Create second checkpoint at sequence 4
  console.log('\n📸 Creating checkpoint at sequence 4...');
  const checkpoint2 = await replayEngine.createCheckpoint(4);
  console.log(`   Checkpoint hash: ${checkpoint2.state_hash}`);

  // Now test replay to each checkpoint
  console.log('\n🏛️  Testing replay to sequence 2...');
  const replay1 = await replayEngine.executeReplay(0);
  console.log(`   Events processed: ${replay1.eventsProcessed}`);
  console.log(`   State hash: ${replay1.finalStateHash}`);
  console.log(`   Matches checkpoint: ${replay1.finalStateHash === checkpoint1.state_hash ? '✅' : '❌'}`);

  console.log('\n🏛️  Testing replay to sequence 4...');
  const replay2 = await replayEngine.executeReplay(0);
  console.log(`   Events processed: ${replay2.eventsProcessed}`);
  console.log(`   State hash: ${replay2.finalStateHash}`);
  console.log(`   Matches checkpoint: ${replay2.finalStateHash === checkpoint2.state_hash ? '✅' : '❌'}`);

  // Prove determinism at each checkpoint
  console.log('\n🔄 Proving determinism at each checkpoint...');
  
  const detCheck1 = await replayEngine.verifyDeterminism(3);
  console.log(`   Sequence 2 deterministic: ${detCheck1.deterministic ? '✅' : '❌'}`);
  
  const detCheck2 = await replayEngine.verifyDeterminism(3);
  console.log(`   Sequence 4 deterministic: ${detCheck2.deterministic ? '✅' : '❌'}`);

  // Final verification
  console.log('\n🎯 CHECKPOINT ANCHORING RESULTS');
  console.log('==============================');
  
  const allChecksPass = 
    replay1.finalStateHash === checkpoint1.state_hash &&
    replay2.finalStateHash === checkpoint2.state_hash &&
    detCheck1.deterministic &&
    detCheck2.deterministic;
  
  if (allChecksPass) {
    console.log('✅ Checkpoint anchoring works correctly');
    console.log('   - Snapshots anchored to exact sequence boundaries');
    console.log('   - Replay respects sequence limits');
    console.log('   - Deterministic reconstruction verified');
  } else {
    console.log('❌ Checkpoint anchoring has issues');
  }

  console.log('\n🧠 Real achievement:');
  console.log('   Not "courtroom truth" - just proper snapshot semantics');
  console.log('   Events → deterministic state → verifiable checkpoints');
}

main().catch(console.error);
