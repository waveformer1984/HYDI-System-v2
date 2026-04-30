// supabase/functions/chaos-runner/index.ts
// HYDI Chaos Runner - Deterministic chaos testing with bounded concurrency

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

interface ChaosConfig {
  chaos_run_id: string;
}

interface ChaosRun {
  id: string;
  name: string;
  seed: number;
  total_runs: number;
  concurrency: number;
  failure_rate: number;
  duplicate_event_rate: number;
  stall_probability: number;
  latency_profile_ms: number[];
  status: string;
}

// Deterministic PRNG from seed (mulberry32)
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper: delay
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Helper: maybe inject fault
function maybe(rate: number, rnd: () => number): boolean {
  return rnd() < rate;
}

// Helper: sample from latency profile
function sampleLatency(profile: number[], rnd: () => number): number {
  const idx = Math.floor(rnd() * profile.length);
  return profile[idx];
}

// Record fault injection
async function recordFault(
  runId: string,
  instanceId: string | null,
  faultType: string,
  phase: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await supabase.from("chaos_fault_injections").insert({
    chaos_run_id: runId,
    instance_id: instanceId,
    fault_type: faultType,
    phase,
    payload
  });
}

// Bounded concurrency worker pool
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const executing: Promise<void>[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const p = fn(items[i], i);
    executing.push(p);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(ep => ep === p), 1);
    }
  }
  
  await Promise.all(executing);
}

// Execute single chaos scenario
async function executeScenario(
  runConfig: ChaosRun,
  scenarioIndex: number,
  rnd: () => number
): Promise<{ success: boolean; error?: string; illegalTransitions: number; duplicateSideEffects: number }> {
  const scenarioKey = `run-${scenarioIndex.toString().padStart(4, '0')}`;
  const runId = `${runConfig.id}-${scenarioKey}`;
  
  let illegalTransitions = 0;
  let duplicateSideEffects = 0;
  
  try {
    // Create instance record
    const { data: instance } = await supabase
      .from("chaos_run_instances")
      .insert({
        chaos_run_id: runConfig.id,
        scenario_key: scenarioKey,
        state: 'running'
      })
      .select()
      .single();
    
    // Phase 1: Initialize run
    if (maybe(runConfig.failure_rate, rnd)) {
      await recordFault(runConfig.id, instance.id, 'forced_error', 'init', { reason: 'random_failure' });
      throw new Error('Chaos: init failure');
    }
    
    const initDelay = sampleLatency(runConfig.latency_profile_ms, rnd);
    await delay(initDelay);
    
    // Call hydi-transition to init
    const { error: initError } = await supabase.functions.invoke('hydi-transition', {
      body: {
        run_id: runId,
        from: 'initialized',
        to: 'audit',
        payload: { scope: ['chaos-test'] },
        actor: 'ursula',
        idempotency_key: `${runId}-init`
      }
    });
    
    if (initError) {
      if (initError.message.includes('Illegal transition')) illegalTransitions++;
      throw initError;
    }
    
    // Phase 2: Audit (HEIDI)
    if (maybe(runConfig.stall_probability, rnd)) {
      await recordFault(runConfig.id, instance.id, 'stall', 'audit', { duration_ms: 3000 });
      await delay(3000);
    }
    
    const auditDelay = sampleLatency(runConfig.latency_profile_ms, rnd);
    await delay(auditDelay);
    
    // Simulate findings with potential duplicate
    const findings = [
      { component: 'chaos-test', severity: 'CRITICAL', description: `Finding 1 for ${scenarioKey}` },
      { component: 'chaos-test', severity: 'WARNING', description: `Finding 2 for ${scenarioKey}` }
    ];
    
    // First persist
    const { error: auditError1 } = await supabase.rpc('hydi_persist_findings', {
      p_run_id: runId,
      p_findings: findings,
      p_actor: 'auditor'
    });
    
    if (auditError1) throw auditError1;
    
    // Maybe duplicate (to test idempotency)
    if (maybe(runConfig.duplicate_event_rate, rnd)) {
      await recordFault(runConfig.id, instance.id, 'duplicate', 'audit', { attempt: 2 });
      duplicateSideEffects++;
      
      // Fire duplicate without awaiting
      supabase.rpc('hydi_persist_findings', {
        p_run_id: runId,
        p_findings: findings,
        p_actor: 'auditor'
      }).catch(() => {}); // Should be rejected by idempotency
    }
    
    // Transition to execute
    const { error: transError1 } = await supabase.functions.invoke('hydi-transition', {
      body: {
        run_id: runId,
        from: 'audit',
        to: 'execute',
        payload: { findings_count: findings.length },
        actor: 'auditor',
        idempotency_key: `${runId}-audit-to-execute`
      }
    });
    
    if (transError1) {
      if (transError1.message.includes('Illegal transition')) illegalTransitions++;
      throw transError1;
    }
    
    // Phase 3: Execute (EXECUTOR)
    if (maybe(runConfig.failure_rate, rnd)) {
      await recordFault(runConfig.id, instance.id, 'forced_error', 'execute', { reason: 'random_failure' });
      throw new Error('Chaos: execute failure');
    }
    
    const execDelay = sampleLatency(runConfig.latency_profile_ms, rnd);
    await delay(execDelay);
    
    const tasks = [
      { task_name: 'fix-1', status: 'completed' },
      { task_name: 'fix-2', status: 'completed' }
    ];
    
    const { error: execError } = await supabase.rpc('hydi_persist_tasks', {
      p_run_id: runId,
      p_tasks: tasks,
      p_actor: 'executor'
    });
    
    if (execError) throw execError;
    
    // Transition to verify
    const { error: transError2 } = await supabase.functions.invoke('hydi-transition', {
      body: {
        run_id: runId,
        from: 'execute',
        to: 'verify',
        payload: { tasks_done: tasks.length },
        actor: 'executor',
        idempotency_key: `${runId}-execute-to-verify`
      }
    });
    
    if (transError2) {
      if (transError2.message.includes('Illegal transition')) illegalTransitions++;
      throw transError2;
    }
    
    // Phase 4: Verify (KILO)
    if (maybe(runConfig.stall_probability, rnd)) {
      await recordFault(runConfig.id, instance.id, 'stall', 'verify', { duration_ms: 2000 });
      await delay(2000);
    }
    
    const verifyDelay = sampleLatency(runConfig.latency_profile_ms, rnd);
    await delay(verifyDelay);
    
    const results = [
      { component: 'test-1', status: 'pass', baseline: 'ok', actual: 'ok', delta: 'none' },
      { component: 'test-2', status: 'pass', baseline: 'ok', actual: 'ok', delta: 'none' }
    ];
    
    const { error: verifyError } = await supabase.rpc('hydi_persist_verification', {
      p_run_id: runId,
      p_results: results,
      p_actor: 'verifier'
    });
    
    if (verifyError) throw verifyError;
    
    // Certification
    const { error: certError } = await supabase.rpc('hydi_persist_certification', {
      p_run_id: runId,
      p_status: 'CLEAN',
      p_passed: 2,
      p_warnings: 0,
      p_failed: 0,
      p_actor: 'verifier'
    });
    
    if (certError) throw certError;
    
    // Finalize
    const { error: finalError } = await supabase.functions.invoke('hydi-transition', {
      body: {
        run_id: runId,
        from: 'verify',
        to: 'completed',
        payload: { passed: 2, failed: 0 },
        actor: 'verifier',
        idempotency_key: `${runId}-finalize`
      }
    });
    
    if (finalError) {
      if (finalError.message.includes('Illegal transition')) illegalTransitions++;
      throw finalError;
    }
    
    // Replay fidelity check
    const { data: finalState } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    const expectedHash = Deno.env.get('HYDI_REPLAY_SALT') + JSON.stringify(finalState);
    
    const { data: replayed } = await supabase.rpc('hydi_reconstruct_run', { p_run_id: runId });
    const replayedHash = Deno.env.get('HYDI_REPLAY_SALT') + JSON.stringify(replayed);
    
    const match = expectedHash === replayedHash;
    
    await supabase.rpc('record_replay_integrity', {
      p_run_id: runId,
      p_source_version: '2.1.0',
      p_target_version: '2.1.0',
      p_expected_hash: expectedHash,
      p_reconstructed_hash: replayedHash,
      p_details: { chaos_run: true, scenario_key: scenarioKey, match }
    });
    
    // Update instance to done
    await supabase
      .from("chaos_run_instances")
      .update({ state: 'done' })
      .eq('id', instance.id);
    
    return { success: true, illegalTransitions, duplicateSideEffects };
    
  } catch (error) {
    // Update instance to error
    await supabase
      .from("chaos_run_instances")
      .update({ 
        state: 'error',
        last_error: error.message
      })
      .eq('chaos_run_id', runConfig.id)
      .eq('scenario_key', scenarioKey);
    
    return { 
      success: false, 
      error: error.message,
      illegalTransitions,
      duplicateSideEffects
    };
  }
}

// Main handler
Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
  
  const body = await req.json() as ChaosConfig;
  
  // Fetch chaos run config
  const { data: runConfig, error: runErr } = await supabase
    .from("chaos_runs")
    .select("*")
    .eq("id", body.chaos_run_id)
    .single();
  
  if (runErr || !runConfig) {
    return new Response(
      JSON.stringify({ error: "chaos_run not found" }), 
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // Mark as running
  await supabase
    .from("chaos_runs")
    .update({ 
      status: 'running', 
      started_at: new Date().toISOString() 
    })
    .eq('id', runConfig.id);
  
  // Initialize PRNG
  const rnd = mulberry32(Number(runConfig.seed));
  
  // Create scenario indices
  const scenarios = Array.from({ length: runConfig.total_runs }, (_, i) => i);
  
  // Run with bounded concurrency
  EdgeRuntime.waitUntil((async () => {
    const results: { success: boolean; error?: string; illegalTransitions: number; duplicateSideEffects: number }[] = [];
    
    await runWithConcurrency(scenarios, runConfig.concurrency, async (scenarioIdx) => {
      const result = await executeScenario(runConfig, scenarioIdx, rnd);
      results.push(result);
    });
    
    // Aggregate results
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalIllegalTransitions = results.reduce((sum, r) => sum + r.illegalTransitions, 0);
    const totalDuplicateSideEffects = results.reduce((sum, r) => sum + r.duplicateSideEffects, 0);
    
    // Check success criteria
    const passed = 
      totalIllegalTransitions === 0 &&
      totalDuplicateSideEffects === 0 &&
      (successful / runConfig.total_runs) >= 0.8;
    
    // Update chaos run status
    await supabase
      .from("chaos_runs")
      .update({
        status: passed ? 'completed' : 'failed',
        finished_at: new Date().toISOString()
      })
      .eq('id', runConfig.id);
    
    console.log(`[CHAOS RUN ${runConfig.id}] Completed:`, {
      successful,
      failed,
      illegalTransitions: totalIllegalTransitions,
      duplicateSideEffects: totalDuplicateSideEffects,
      passed
    });
  })());
  
  return new Response(
    JSON.stringify({ 
      ok: true, 
      chaos_run_id: runConfig.id,
      status: 'running',
      message: `Launched ${runConfig.total_runs} scenarios with concurrency ${runConfig.concurrency}`
    }), 
    {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      status: 202
    }
  );
});
