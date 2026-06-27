// THE EMPTY ROOM TEST - Proving Mathematical Consistency
// Can the system rebuild its entire reality from pure history?

import { EventSourcedLedger } from './src/lib/event-sourced-ledger.js';
import { DeterministicReplayEngine } from './src/lib/replay-engine.js';
import { createHash } from 'crypto';

async function main() {
  console.log('🧪 STARTING EMPTY ROOM TEST');
  console.log('===============================\n');

  // Initialize the ledger and replay engine
  const ledger = new EventSourcedLedger();
  await ledger.initialize();

  // Check for buffer recovery first
  const recovered = await ledger.recoverFromBuffer();
  if (recovered) {
    console.log('🔄 Recovered events from buffer');
  }

  const replayEngine = new DeterministicReplayEngine(ledger);

  // Step 1: Create initial checkpoint (if not exists)
  console.log('📸 Creating initial checkpoint...');
  const initialCheckpoint = await replayEngine.createCheckpoint();
  console.log(`   Checkpoint: ${initialCheckpoint.checkpoint_id}`);
  console.log(`   Sequence:  ${initialCheckpoint.sequence_number}`);
  console.log(`   Hash:      ${initialCheckpoint.state_hash}\n`);

  // Step 2: Execute the Empty Room Test
  console.log('🏛️  EXECUTING EMPTY ROOM TEST');
  console.log('   Wiping projection...');
  console.log('   Rebuilding from event log...\n');

  const replayResult = await replayEngine.executeReplay();

  // Step 3: Report results
  console.log('📊 REPLAY RESULTS');
  console.log('================');
  console.log(`   Success:           ${replayResult.success ? '✅' : '❌'}`);
  console.log(`   Events Processed:  ${replayResult.eventsProcessed}`);
  console.log(`   Tasks Rebuilt:     ${replayResult.tasksReconstructed}`);
  console.log(`   Final State Hash:  ${replayResult.finalStateHash}`);
  console.log(`   Expected Hash:     ${replayResult.expectedStateHash || 'N/A'}`);
  console.log(`   Replay Time:       ${replayResult.replayTimeMs}ms\n`);

  if (replayResult.integrityIssues.length > 0) {
    console.log('⚠️  INTEGRITY ISSUES:');
    for (const issue of replayResult.integrityIssues) {
      console.log(`   - ${issue}`);
    }
    console.log();
  }

  // Step 4: Verify determinism (run multiple times)
  console.log('🔄 VERIFYING DETERMINISM...');
  const determinismCheck = await replayEngine.verifyDeterminism(3);

  console.log(`   Deterministic: ${determinismCheck.deterministic ? '✅' : '❌'}`);

  if (!determinismCheck.deterministic) {
    console.log('   Non-deterministic results detected:');
    determinismCheck.results.forEach((result, i) => {
      console.log(`     Run ${i + 1}: ${result.finalStateHash}`);
    });
  }

  // Step 5: Test timeline forking
  console.log('\n🔀 TESTING TIMELINE FORK...');
  const events = await ledger.replayEvents();
  if (events.length > 0) {
    const forkPoint = Math.floor(events.length / 2);
    const forkedState = await replayEngine.forkTimeline(forkPoint);
    const forkHash = createHash('sha256')
      .update(JSON.stringify(forkedState.sort((a, b) => a.task_id.localeCompare(b.task_id))))
      .digest('hex');

    console.log(`   Fork at event: ${forkPoint}`);
    console.log(`   Forked tasks:  ${forkedState.length}`);
    console.log(`   Fork hash:     ${forkHash}`);
  }

  // Step 6: Final verdict
  console.log('\n🎯 FINAL VERDICT');
  console.log('================');

  if (replayResult.success && determinismCheck.deterministic) {
    console.log('✅ SYSTEM IS MATHEMATICALLY CONSISTENT');
    console.log('   History is the authoritative source of truth');
    console.log('   State is correctly derived from events');
    console.log('   The machine can prove its own memory');
  } else {
    console.log('❌ SYSTEM HAS INTEGRITY VIOLATIONS');
    console.log('   The ledger cannot be trusted');
    console.log('   Immediate investigation required');
  }

  // Step 7: Show current state
  console.log('\n📈 CURRENT SYSTEM STATE');
  console.log('=======================');
  const projection = replayEngine['projection']; // Access private property for debugging
  const stats = projection.getProjectionStats();

  console.log(`   Total Tasks:    ${stats.totalTasks}`);
  console.log(`   By Status:`);
  Object.entries(stats.tasksByStatus).forEach(([status, count]) => {
    console.log(`     ${status}: ${count}`);
  });
  console.log(`   Last Event:     ${stats.lastEventSequence}`);
}

// Execute the test
main().catch(console.error);
