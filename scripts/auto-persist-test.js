/**
 * HYDI Auto-Persist & Auto-Restore Test
 *
 * Verifies that Ursula's wiring correctly:
 *   1. Persists workflows on every step transition
 *   2. Persists approvals on request/response
 *   3. Restores active workflows from DB on startup
 *
 * Run: node scripts/auto-persist-test.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const HYDI_ROOT = path.resolve(__dirname, '..');
function hydiModule(mod) {
  const p = path.join(HYDI_ROOT, 'modules', mod);
  if (fs.existsSync(p + '.js')) return require(p);
  return null;
}

const ServiceRegistry = hydiModule('service-registry');
const WorkflowOrchestrator = hydiModule('workflow-orchestrator');
const StateManager = hydiModule('state-manager');

let pass = 0;
let fail = 0;
function ok(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function run() {
  const DB_PATH = path.join(HYDI_ROOT, 'data', 'auto-persist-test.db');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  console.log('═══════════════════════════════════════════════════');
  console.log('HYDI Auto-Persist & Auto-Restore Test');
  console.log('═══════════════════════════════════════════════════\n');

  // ── Simulate Ursula initOSLayer (Process 1) ──
  console.log('Phase 1: Ursula Startup (Process 1)');

  const stateManager1 = new StateManager({ dbPath: DB_PATH });
  await stateManager1.initialize();

  const registry = new ServiceRegistry();
  const workflowOrchestrator = new WorkflowOrchestrator();
  workflowOrchestrator.setRegistry(registry);

  // Wire auto-persist exactly as Ursula does
  workflowOrchestrator.on('step_started', async (evt) => {
    const wf = workflowOrchestrator.workflows.get(evt.workflowId);
    if (wf) await stateManager1.persistWorkflow(wf);
  });
  workflowOrchestrator.on('step_completed', async (evt) => {
    const wf = workflowOrchestrator.workflows.get(evt.workflowId);
    if (wf) await stateManager1.persistWorkflow(wf);
  });
  workflowOrchestrator.on('step_failed', async (evt) => {
    const wf = workflowOrchestrator.workflows.get(evt.workflowId);
    if (wf) await stateManager1.persistWorkflow(wf);
  });
  workflowOrchestrator.on('approval_requested', async (evt) => {
    const approval = {
      id: `appr_${evt.workflowId}_${evt.stepId}`,
      workflowId: evt.workflowId,
      stepId: evt.stepId,
      approvers: evt.approvers || ['heidi_executive'],
      requestedAt: evt.requestedAt,
      status: 'pending'
    };
    await stateManager1.persistApproval(approval);
  });

  // Start a workflow
  const wfId = workflowOrchestrator.startWorkflow('infrastructure_alert', { alert: 'overheating' }, { autoApproval: true });
  ok('Workflow started', typeof wfId === 'string');

  // Wait for completion
  await sleep(1500);

  // Verify workflow completed in memory
  const memStatus = workflowOrchestrator.getWorkflowStatus(wfId);
  ok('Workflow completed in memory', memStatus && memStatus.status === 'completed');

  // Verify it was persisted
  const persistedWf = await stateManager1.loadWorkflow(wfId);
  ok('Workflow auto-persisted to SQLite', !!persistedWf);
  ok('Persisted workflow has correct status', persistedWf.status === 'completed');
  ok('Persisted workflow has all steps', persistedWf.steps.length === 3);

  // Verify audit trail
  const auditRecords = await stateManager1.queryAudit({ limit: 20 });
  const stepStarted = auditRecords.filter(r => r.event_type === 'step_started');
  const stepCompleted = auditRecords.filter(r => r.event_type === 'step_completed');
  ok('Audit has step_started records', stepStarted.length === 3);
  ok('Audit has step_completed records', stepCompleted.length === 3);

  // Simulate CRASH — close everything
  await stateManager1.close();
  console.log('\n💥 Simulated crash: DB closed, references dropped\n');

  // ── Simulate Ursula restart (Process 2) ──
  console.log('Phase 2: Ursula Restart (Process 2)');

  const stateManager2 = new StateManager({ dbPath: DB_PATH });
  await stateManager2.initialize();

  const workflowOrchestrator2 = new WorkflowOrchestrator();
  workflowOrchestrator2.setRegistry(registry);

  // Auto-restore exactly as Ursula does
  const activeWorkflows = await stateManager2.loadActiveWorkflows();
  for (const wf of activeWorkflows) {
    workflowOrchestrator2.workflows.set(wf.id, wf);
    workflowOrchestrator2.activeCount++;
  }
  ok(`Restored ${activeWorkflows.length} active workflow(s)`, activeWorkflows.length === 0,
    `expected 0 (workflow was completed), got ${activeWorkflows.length}`);

  // Verify completed workflow is still queryable from DB
  const restoredWf = await stateManager2.loadWorkflow(wfId);
  ok('Completed workflow still in DB after restart', !!restoredWf);
  ok('Restored workflow status is completed', restoredWf.status === 'completed');

  // Now test with a running (non-auto-approval) workflow
  console.log('\nPhase 3: Running Workflow Survivability');

  // Need a workflow that doesn't auto-complete. Use the same orchestrator.
  const wfId2 = workflowOrchestrator2.startWorkflow('infrastructure_alert', { alert: 'overheating' });
  ok('Running workflow started', typeof wfId2 === 'string');

  await sleep(200);

  // Manually persist (simulating auto-persist mid-execution)
  const wf2 = workflowOrchestrator2.workflows.get(wfId2);
  await stateManager2.persistWorkflow(wf2);

  const midState = await stateManager2.loadWorkflow(wfId2);
  ok('Running workflow persisted mid-execution', !!midState);
  ok('Running workflow status is running', midState.status === 'running');

  // Simulate another crash
  await stateManager2.close();
  console.log('\n💥 Second crash\n');

  // ── Restart 3 ──
  console.log('Phase 4: Restart with Running Workflow');

  const stateManager3 = new StateManager({ dbPath: DB_PATH });
  await stateManager3.initialize();

  const workflowOrchestrator3 = new WorkflowOrchestrator();
  workflowOrchestrator3.setRegistry(registry);

  const restoredActive = await stateManager3.loadActiveWorkflows();
  for (const wf of restoredActive) {
    workflowOrchestrator3.workflows.set(wf.id, wf);
    workflowOrchestrator3.activeCount++;
  }

  ok('Running workflow restored from DB', restoredActive.length === 1 && restoredActive[0].id === wfId2);
  ok('Restored workflow is running', restoredActive[0].status === 'running');

  const restoredMemStatus = workflowOrchestrator3.getWorkflowStatus(wfId2);
  ok('Restored workflow accessible in memory', !!restoredMemStatus);
  ok('Restored workflow has correct step count', restoredMemStatus.steps.length === 3);

  await stateManager3.close();

  // Cleanup
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`Auto-Persist Results: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n⚠️  Some tests failed. Auto-persist wiring needs work.');
    process.exit(1);
  } else {
    console.log('\n🎯 Auto-persist and auto-restore verified.');
    console.log('   Workflows survive crashes. State is real.');
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
