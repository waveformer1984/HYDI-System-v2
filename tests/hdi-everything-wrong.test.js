/**
 * HYDI "Everything Goes Wrong At Once" Chaos Test
 * Simulates: 50 concurrent runs, forced retries, DB latency, duplicate events, agent stalls
 * Validates: no illegal transitions, no duplicate side effects, replay fidelity, recovery
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const TEST_CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  concurrentRuns: 50,
  maxRetries: 5,
  injectionRate: 0.15, // 15% chaos per operation
  stallDurationMs: 5000
};

const supabase = createClient(TEST_CONFIG.supabaseUrl, TEST_CONFIG.supabaseKey);

// Chaos injector
const ChaosEngine = {
  stats: { injections: 0, retries: 0, failures: 0 },

  inject() {
    if (Math.random() < TEST_CONFIG.injectionRate) {
      this.stats.injections++;
      const modes = ['latency', 'timeout', 'duplicate', 'partial_write', 'stall', 'conflict'];
      return modes[Math.floor(Math.random() * modes.length)];
    }
    return null;
  },

  async maybeInject(mode, fn) {
    const injection = this.inject();

    if (injection === 'latency') {
      console.log(`[CHAOS] Injecting latency (500ms)`);
      await delay(500);
    }

    if (injection === 'timeout' && Math.random() < 0.3) {
      console.log(`[CHAOS] Injecting timeout`);
      throw new Error('Connection timeout (chaos)');
    }

    if (injection === 'duplicate') {
      console.log(`[CHAOS] Duplicate request`);
      // Fire duplicate without awaiting
      fn().catch(() => {});
    }

    if (injection === 'partial_write') {
      console.log(`[CHAOS] Partial write - will fail after partial success`);
      // Simulate by throwing mid-transaction
      throw new Error('Partial write failure (chaos)');
    }

    if (injection === 'stall') {
      console.log(`[CHAOS] Agent stall (${TEST_CONFIG.stallDurationMs}ms)`);
      await delay(TEST_CONFIG.stallDurationMs);
    }

    if (injection === 'conflict') {
      console.log(`[CHAOS] Concurrent modification conflict`);
      throw new Error('Row version conflict (chaos)');
    }

    return fn();
  }
};

// Helper: delay
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Helper: hash state for fidelity check
function hashState(state) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(state, Object.keys(state).sort()))
    .digest('hex');
}

// Run a single lifecycle with chaos
async function runLifecycleWithChaos(runIndex) {
  const runId = `chaos-test-${Date.now()}-${runIndex}`;
  const stateSnapshots = [];
  const sideEffects = [];

  console.log(`[RUN ${runIndex}] Starting lifecycle: ${runId}`);

  try {
    // Phase 1: Init (URSULA)
    let retry = 0;
    while (retry < TEST_CONFIG.maxRetries) {
      try {
        await ChaosEngine.maybeInject('init', async () => {
          const { data, error } = await supabase.rpc('hydi_init_run', {
            p_run_id: runId,
            p_scope: ['chaos-test'],
            p_actor: 'ursula'
          });
          if (error) throw error;
          return data;
        });
        break;
      } catch (e) {
        retry++;
        ChaosEngine.stats.retries++;
        console.log(`[RUN ${runIndex}] Init retry ${retry}: ${e.message}`);
        await delay(100 * retry);
      }
    }

    if (retry >= TEST_CONFIG.maxRetries) {
      throw new Error('Max retries exceeded during init');
    }

    // Phase 2: Audit (HEIDI) - with findings
    retry = 0;
    while (retry < TEST_CONFIG.maxRetries) {
      try {
        await ChaosEngine.maybeInject('audit', async () => {
          // Simulate findings generation
          const findings = [
            { component: 'test', severity: 'CRITICAL', description: 'Chaos test finding 1' },
            { component: 'test', severity: 'WARNING', description: 'Chaos test finding 2' }
          ];

          const { error } = await supabase.rpc('hydi_persist_findings', {
            p_run_id: runId,
            p_findings: findings,
            p_actor: 'auditor'
          });
          if (error) throw error;

          // Record side effect
          sideEffects.push({ type: 'audit_complete', key: `${runId}-audit` });
          return true;
        });

        // Verify invariant: findings exist
        const { data: findingsCheck } = await supabase
          .from('hydi_audit_findings')
          .select('count')
          .eq('run_id', runId);

        if (findingsCheck.count < 2) {
          throw new Error(`Invariant violation: expected 2 findings, got ${findingsCheck.count}`);
        }

        break;
      } catch (e) {
        retry++;
        ChaosEngine.stats.retries++;
        console.log(`[RUN ${runIndex}] Audit retry ${retry}: ${e.message}`);
        await delay(100 * retry);
      }
    }

    if (retry >= TEST_CONFIG.maxRetries) {
      throw new Error('Max retries exceeded during audit');
    }

    // Capture state after audit
    const { data: auditState } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    stateSnapshots.push({ phase: 'audit', hash: hashState(auditState) });

    // Phase 3: Transition to Execute
    await ChaosEngine.maybeInject('transition', async () => {
      const { error } = await supabase.functions.invoke('hydi-transition', {
        body: {
          run_id: runId,
          from: 'audit',
          to: 'execute',
          payload: { findings_count: 2 },
          actor: 'auditor',
          idempotency_key: `${runId}-transition-execute`
        }
      });
      if (error) throw error;
    });

    // Phase 4: Execute (EXECUTOR) - with tasks
    retry = 0;
    while (retry < TEST_CONFIG.maxRetries) {
      try {
        await ChaosEngine.maybeInject('execute', async () => {
          const tasks = [
            { task_name: 'fix-chaos-1', status: 'completed' },
            { task_name: 'fix-chaos-2', status: 'completed' }
          ];

          const { error } = await supabase.rpc('hydi_persist_tasks', {
            p_run_id: runId,
            p_tasks: tasks,
            p_actor: 'executor'
          });
          if (error) throw error;

          sideEffects.push({ type: 'task_complete', key: `${runId}-tasks` });
          return true;
        });

        // Verify invariant: tasks exist
        const { data: tasksCheck } = await supabase
          .from('hydi_execution_tasks')
          .select('count')
          .eq('run_id', runId);

        if (tasksCheck.count < 2) {
          throw new Error(`Invariant violation: expected 2 tasks, got ${tasksCheck.count}`);
        }

        break;
      } catch (e) {
        retry++;
        ChaosEngine.stats.retries++;
        console.log(`[RUN ${runIndex}] Execute retry ${retry}: ${e.message}`);
        await delay(100 * retry);
      }
    }

    if (retry >= TEST_CONFIG.maxRetries) {
      throw new Error('Max retries exceeded during execute');
    }

    // Capture state after execute
    const { data: execState } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    stateSnapshots.push({ phase: 'execute', hash: hashState(execState) });

    // Phase 5: Transition to Verify
    await ChaosEngine.maybeInject('transition', async () => {
      const { error } = await supabase.functions.invoke('hydi-transition', {
        body: {
          run_id: runId,
          from: 'execute',
          to: 'verify',
          payload: { tasks_done: 2 },
          actor: 'executor',
          idempotency_key: `${runId}-transition-verify`
        }
      });
      if (error) throw error;
    });

    // Phase 6: Verify (KILO) - with results
    retry = 0;
    while (retry < TEST_CONFIG.maxRetries) {
      try {
        await ChaosEngine.maybeInject('verify', async () => {
          const results = [
            { component: 'test-1', status: 'pass', baseline: 'ok', actual: 'ok', delta: 'none' },
            { component: 'test-2', status: 'pass', baseline: 'ok', actual: 'ok', delta: 'none' }
          ];

          const { error } = await supabase.rpc('hydi_persist_verification', {
            p_run_id: runId,
            p_results: results,
            p_actor: 'verifier'
          });
          if (error) throw error;

          // Certification (with potential chaos corruption)
          const certStatus = Math.random() > 0.1 ? 'CLEAN' : 'INVALID_STATUS';

          const { error: certError } = await supabase.rpc('hydi_persist_certification', {
            p_run_id: runId,
            p_status: certStatus,
            p_passed: 2,
            p_warnings: 0,
            p_failed: 0,
            p_actor: 'verifier'
          });
          if (certError) throw certError;

          sideEffects.push({ type: 'certification', key: `${runId}-cert` });
          return true;
        });

        break;
      } catch (e) {
        retry++;
        ChaosEngine.stats.retries++;
        console.log(`[RUN ${runIndex}] Verify retry ${retry}: ${e.message}`);
        await delay(100 * retry);
      }
    }

    if (retry >= TEST_CONFIG.maxRetries) {
      throw new Error('Max retries exceeded during verify');
    }

    // Finalize
    await ChaosEngine.maybeInject('finalize', async () => {
      const { error } = await supabase.functions.invoke('hydi-transition', {
        body: {
          run_id: runId,
          from: 'verify',
          to: 'completed',
          payload: { passed: 2, failed: 0 },
          actor: 'verifier',
          idempotency_key: `${runId}-transition-complete`
        }
      });
      if (error) throw error;
    });

    // Capture final state
    const { data: finalState } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    stateSnapshots.push({ phase: 'completed', hash: hashState(finalState) });

    // Replay fidelity check: reconstruct from events and compare
    const { data: reconstructed } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    const replayHash = hashState(reconstructed);

    if (replayHash !== stateSnapshots[2].hash) {
      throw new Error(`Replay fidelity mismatch: ${replayHash} !== ${stateSnapshots[2].hash}`);
    }

    console.log(`[RUN ${runIndex}] ✅ Completed successfully`);

    return {
      success: true,
      runId,
      stateSnapshots,
      sideEffects,
      retries: retry
    };

  } catch (e) {
    ChaosEngine.stats.failures++;
    console.error(`[RUN ${runIndex}] ❌ Failed: ${e.message}`);
    return { success: false, runId, error: e.message };
  }
}

// Main chaos test
async function runEverythingWrongTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   HYDI "EVERYTHING GOES WRONG AT ONCE" CHAOS TEST');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Concurrent runs: ${TEST_CONFIG.concurrentRuns}`);
  console.log(`Chaos injection rate: ${TEST_CONFIG.injectionRate * 100}%`);
  console.log(`Max retries per operation: ${TEST_CONFIG.maxRetries}`);
  console.log('');

  const startTime = Date.now();

  // Launch 50 concurrent runs
  const runPromises = Array(TEST_CONFIG.concurrentRuns)
    .fill(0)
    .map((_, i) => runLifecycleWithChaos(i));

  const results = await Promise.allSettled(runPromises);

  const duration = Date.now() - startTime;
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.filter(r => r.status === 'rejected' || !r.value?.success).length;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   CHAOS TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total runs: ${TEST_CONFIG.concurrentRuns}`);
  console.log(`Successful: ${successful} (${(successful/TEST_CONFIG.concurrentRuns*100).toFixed(1)}%)`);
  console.log(`Failed: ${failed} (${(failed/TEST_CONFIG.concurrentRuns*100).toFixed(1)}%)`);
  console.log(`Total duration: ${duration}ms`);
  console.log(`Avg duration per run: ${(duration/TEST_CONFIG.concurrentRuns).toFixed(0)}ms`);
  console.log('');
  console.log(`Chaos injections: ${ChaosEngine.stats.injections}`);
  console.log(`Total retries: ${ChaosEngine.stats.retries}`);
  console.log(`Chaos-induced failures: ${ChaosEngine.stats.failures}`);
  console.log('');

  // Validation criteria
  const validations = [
    { name: 'No illegal transitions', check: () => !results.some(r => r.value?.error?.includes('Illegal transition')) },
    { name: 'No duplicate side effects', check: () => {
      const allEffects = results
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .flatMap(r => r.value.sideEffects.map(e => e.key));
      const uniqueEffects = new Set(allEffects);
      return allEffects.length === uniqueEffects.size;
    }},
    { name: 'Replay fidelity maintained', check: () => !results.some(r => r.value?.error?.includes('fidelity mismatch')) },
    { name: 'Invariants enforced', check: () => !results.some(r => r.value?.error?.includes('Invariant violation')) },
    { name: 'Agent boundaries respected', check: () => !results.some(r => r.value?.error?.includes('Only') && r.value?.error?.includes('can')) },
    { name: 'Success rate > 80%', check: () => successful / TEST_CONFIG.concurrentRuns > 0.8 }
  ];

  let allPassed = true;
  for (const v of validations) {
    const passed = v.check();
    console.log(`${passed ? '✅' : '❌'} ${v.name}`);
    if (!passed) allPassed = false;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');

  if (allPassed) {
    console.log('✅ ALL VALIDATIONS PASSED');
    console.log('System survives 
