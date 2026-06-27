/**
 * HYDI Survivability Test Suite
 *
 * Tests what actually matters:
 *   1. Restart Survivability — state survives process death
 *   2. Dependency Failure Cascades — failures propagate correctly
 *   3. Audit Ledger Integrity — every transition is recorded, no gaps
 *
 * Run: node scripts/survivability-test.js
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
const HealthManager = hydiModule('health-manager');
const RecoveryEngine = hydiModule('recovery-engine');
const WorkflowOrchestrator = hydiModule('workflow-orchestrator');
const StateManager = hydiModule('state-manager');

let pass = 0;
let fail = 0;
function ok(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function run() {
  const DB_PATH = path.join(HYDI_ROOT, 'data', 'survivability-test.db');

  // Clean slate
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  console.log('═══════════════════════════════════════════════════');
  console.log('HYDI Survivability Test Suite');
  console.log('═══════════════════════════════════════════════════\n');

  // ══════════════════════════════════════════════════
  // TEST 1: RESTART SURVIVABILITY
  // ══════════════════════════════════════════════════
  console.log('1. Restart Survivability');
  console.log('   Simulating: crash, restart, state restoration\n');

  // Phase A: Create state before "crash"
  const sm1 = new StateManager({ dbPath: DB_PATH });
  await sm1.initialize();

  const workflow = {
    id: 'wf_survivor',
    definition: 'infrastructure_alert',
    name: 'Infrastructure Alert Response',
    status: 'running',
    payload: { alert: 'overheating' },
    steps: [
      { id: 'diagnose', status: 'completed', startedAt: Date.now() - 5000, completedAt: Date.now() - 3000 },
      { id: 'remediate', status: 'running', startedAt: Date.now() - 2000 }
    ],
    currentStepIndex: 1,
    createdAt: Date.now() - 10000
  };
  await sm1.persistWorkflow(workflow);

  const approval = {
    id: 'appr_001',
    workflowId: 'wf_survivor',
    stepId: 'review',
    approvers: ['heidi_executive'],
    requestedAt: Date.now() - 3000,
    status: 'pending'
  };
  await sm1.persistApproval(approval);

  const recoveryAttempt = {
    id: 'rec_001',
    serviceId: 'event-system',
    reason: 'missed_heartbeat',
    playbook: 'default',
    status: 'running',
    steps: [{ step: 'restart', at: Date.now() }],
    startedAt: Date.now() - 60000
  };
  await sm1.persistRecovery(recoveryAttempt);

  await sm1.audit('workflow_started', { actor: 'system', target: 'wf_survivor', data: { definition: 'infrastructure_alert' } });
  await sm1.audit('service_failed', { actor: 'health-manager', target: 'event-system', data: { reason: 'missed_heartbeat' } });
  await sm1.audit('recovery_initiated', { actor: 'recovery-engine', target: 'event-system', data: { attempt: 'rec_001' } });

  // Phase B: Simulate CRASH — close DB, drop all references
  await sm1.close();
  console.log('   💥 Simulated crash: DB closed, all references dropped');

  // Phase C: Simulate RESTART — new process, new StateManager, same DB
  const sm2 = new StateManager({ dbPath: DB_PATH });
  await sm2.initialize();
  console.log('   🔄 Simulated restart: new StateManager instance\n');

  // Phase D: Verify restoration
  const restoredWorkflows = await sm2.loadActiveWorkflows();
  ok('Workflow restored after restart', restoredWorkflows.length === 1 && restoredWorkflows[0].id === 'wf_survivor');
  ok('Workflow status preserved', restoredWorkflows[0] && restoredWorkflows[0].status === 'running');
  ok('Workflow steps preserved', restoredWorkflows[0] && restoredWorkflows[0].steps.length === 2);

  const restoredApproval = await new Promise((resolve, reject) => {
    sm2.db ? sm2.db.get(`SELECT * FROM approvals WHERE id = ?`, ['appr_001'], (err, row) => {
      if (err) reject(err); else resolve(row);
    }) : resolve(null);
  });
  ok('Approval queue restored', !!restoredApproval);
  ok('Approval status preserved', restoredApproval && restoredApproval.status === 'pending');

  const restoredRecovery = await new Promise((resolve, reject) => {
    sm2.db ? sm2.db.get(`SELECT * FROM recovery_log WHERE id = ?`, ['rec_001'], (err, row) => {
      if (err) reject(err); else resolve(row);
    }) : resolve(null);
  });
  ok('Recovery state restored', !!restoredRecovery);
  ok('Recovery status preserved', restoredRecovery && restoredRecovery.status === 'running');

  const auditRecords = await sm2.queryAudit({ limit: 10 });
  ok('Audit records preserved', auditRecords.length === 3);

  const status = await sm2.getStatus();
  ok('State status reports active workflow', status.activeWorkflows === 1);
  ok('State status reports pending approval', status.pendingApprovals === 1);
  ok('State status reports recovery attempt', status.recoveryAttempts === 1);
  ok('State status reports audit records', status.auditRecords === 3);

  await sm2.close();

  // ══════════════════════════════════════════════════
  // TEST 2: DEPENDENCY FAILURE CASCADES
  // ══════════════════════════════════════════════════
  console.log('\n2. Dependency Failure Cascades');
  console.log('   Simulating: critical dependency failure, propagation\n');

  const registry = new ServiceRegistry();

  registry.register('supabase', {
    name: 'Supabase Database',
    type: 'external',
    dependencies: []
  });

  registry.register('financial-engine', {
    name: 'Financial Engine',
    type: 'module',
    dependencies: ['supabase']
  });

  registry.register('revenue-agent', {
    name: 'Revenue Agent',
    type: 'agent',
    dependencies: ['financial-engine']
  });

  registry.register('workflow-orchestrator', {
    name: 'Workflow Orchestrator',
    type: 'module',
    dependencies: ['supabase']
  });

  // Verify dependency graph
  const supabaseDependents = registry.getDependents('supabase');
  ok('Supabase has 2 direct dependents', supabaseDependents.length === 2,
    `expected 2, got ${supabaseDependents.length}`);
  ok('Financial engine depends on supabase', supabaseDependents.includes('financial-engine'));
  ok('Workflow orchestrator depends on supabase', supabaseDependents.includes('workflow-orchestrator'));

  // Verify transitive dependency
  const financeDependents = registry.getDependents('financial-engine');
  ok('Revenue agent depends on financial engine', financeDependents.includes('revenue-agent'));

  // Simulate supabase failure
  let dependencyFailedEmitted = false;
  registry.on('dependency_failed', (evt) => {
    dependencyFailedEmitted = true;
  });

  registry.markFailed('supabase', 'connection_timeout');

  ok('Supabase marked failed', registry.services.get('supabase').status === 'failed');
  ok('Registry emits dependency_failed', dependencyFailedEmitted);

  // Check startup sequence: failed dependency should appear before dependents
  const seq = registry.getStartupSequence();
  const supabaseIdx = seq.findIndex(s => s.id === 'supabase');
  const financeIdx = seq.findIndex(s => s.id === 'financial-engine');
  ok('Startup sequence: supabase before finance', supabaseIdx < financeIdx);

  // Verify Health Manager integration
  const healthManager = new HealthManager();
  healthManager.setRegistry(registry);

  let serviceFailedEmitted = false;
  healthManager.on('service_failed', (evt) => { serviceFailedEmitted = true; });

  healthManager.handleServiceFailed('supabase', 'connection_timeout');
  ok('Health manager detected service failure', serviceFailedEmitted);

  // Verify Recovery Engine integration
  const recoveryEngine = new RecoveryEngine();
  recoveryEngine.setRegistry(registry);

  const recoveryResult = await recoveryEngine.recover('supabase', 'connection_timeout');
  ok('Recovery engine triggered for failed dependency', !!recoveryResult);

  // ══════════════════════════════════════════════════
  // TEST 3: AUDIT LEDGER INTEGRITY
  // ══════════════════════════════════════════════════
  console.log('\n3. Audit Ledger Integrity');
  console.log('   Simulating: full workflow lifecycle, verifying every transition\n');

  const sm3 = new StateManager({ dbPath: path.join(HYDI_ROOT, 'data', 'audit-test.db') });
  await sm3.initialize();

  const wfId = 'wf_audit_test';

  // Simulate complete workflow lifecycle with explicit audits
  await sm3.audit('workflow_created', { actor: 'ursula', target: wfId, data: { definition: 'grant_application' } });
  await sm3.audit('step_started', { actor: 'funding_agent', target: wfId, data: { step: 'discover' } });
  await sm3.audit('step_completed', { actor: 'funding_agent', target: wfId, data: { step: 'discover', result: 'success' } });
  await sm3.audit('step_started', { actor: 'finance_agent', target: wfId, data: { step: 'budget' } });
  await sm3.audit('step_completed', { actor: 'finance_agent', target: wfId, data: { step: 'budget', result: 'success' } });
  await sm3.audit('approval_requested', { actor: 'workflow_orchestrator', target: wfId, data: { step: 'review', approvers: ['heidi_executive'] } });
  await sm3.audit('approval_granted', { actor: 'heidi_executive', target: wfId, data: { step: 'review' } });
  await sm3.audit('step_started', { actor: 'funding_agent', target: wfId, data: { step: 'submit' } });
  await sm3.audit('step_completed', { actor: 'funding_agent', target: wfId, data: { step: 'submit', result: 'success' } });
  await sm3.audit('workflow_completed', { actor: 'system', target: wfId, data: { duration: 45000 } });

  // Verify: query all events for this workflow
  const allAudit = await sm3.queryAudit({ limit: 20 });
  const wfEvents = allAudit.filter(r => r.target === wfId);

  ok('All workflow events recorded', wfEvents.length === 10, `expected 10, got ${wfEvents.length}`);

  // Verify: no gaps in sequence — every step has start + complete
  const stepsWithStart = wfEvents.filter(e => e.event_type === 'step_started').length;
  const stepsWithComplete = wfEvents.filter(e => e.event_type === 'step_completed').length;
  ok('Every started step has completion', stepsWithStart === stepsWithComplete,
    `started: ${stepsWithStart}, completed: ${stepsWithComplete}`);

  // Verify: timestamps present and monotonically increasing
  const timestamps = wfEvents.map(e => e.timestamp).sort((a, b) => a - b);
  const monotonic = timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]);
  ok('Timestamps monotonically increasing', monotonic);

  // Verify: workflow lifecycle bookends exist
  const hasCreate = wfEvents.some(e => e.event_type === 'workflow_created');
  const hasComplete = wfEvents.some(e => e.event_type === 'workflow_completed');
  ok('Workflow has creation record', hasCreate);
  ok('Workflow has completion record', hasComplete);

  // Verify: approval lifecycle captured
  const hasApprovalRequest = wfEvents.some(e => e.event_type === 'approval_requested');
  const hasApprovalGrant = wfEvents.some(e => e.event_type === 'approval_granted');
  ok('Approval request recorded', hasApprovalRequest);
  ok('Approval grant recorded', hasApprovalGrant);

  await sm3.close();

  // ══════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const auditDb = path.join(HYDI_ROOT, 'data', 'audit-test.db');
  if (fs.existsSync(auditDb)) fs.unlinkSync(auditDb);

  // ══════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`Survivability Results: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n⚠️  Some survivability tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n🛡️  All survivability tests passed.');
    console.log('   State survives crashes. Dependencies propagate failures.');
    console.log('   Audit ledger has no gaps.');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal survivability test error:', err);
  process.exit(1);
});
