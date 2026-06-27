/**
 * HYDI OS Layer Validation Script
 *
 * Tests the core plumbing without starting the HTTP server.
 * Run: node scripts/validate-os-layer.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const HYDI_ROOT = path.resolve(__dirname, '..');
function hydiModule(mod) {
  const p = path.join(HYDI_ROOT, 'modules', mod);
  if (fs.existsSync(p + '.js')) return require(p);
  console.warn(`[VALIDATE] Module not found: ${p}`);
  return null;
}

// ── Load all new OS modules ──
const ServiceRegistry = hydiModule('service-registry');
const HealthManager = hydiModule('health-manager');
const RecoveryEngine = hydiModule('recovery-engine');
const WorkflowOrchestrator = hydiModule('workflow-orchestrator');
const ResourceManager = hydiModule('resource-manager');

// ── Track test results ──
let pass = 0;
let fail = 0;
function ok(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function run() {
  console.log('═══════════════════════════════════════════════════');
  console.log('HYDI OS Layer Validation');
  console.log('═══════════════════════════════════════════════════\n');

  // ── Module Load Tests ──
  console.log('1. Module Loading');
  ok('ServiceRegistry loaded', !!ServiceRegistry);
  ok('HealthManager loaded', !!HealthManager);
  ok('RecoveryEngine loaded', !!RecoveryEngine);
  ok('WorkflowOrchestrator loaded', !!WorkflowOrchestrator);
  ok('ResourceManager loaded', !!ResourceManager);

  if (!ServiceRegistry) {
    console.error('\n❌ Core module missing — aborting validation.');
    process.exit(1);
  }

  // ── Registry Tests ──
  console.log('\n2. Service Registry');
  const registry = new ServiceRegistry();

  registry.register('event-system', {
    name: 'ProtoForge Event System',
    type: 'module',
    port: null,
    version: '1.0.0',
    dependencies: [],
    capabilities: ['event_bus', 'priority_queue']
  });

  registry.register('financial-engine', {
    name: 'ProtoForge Financial Engine',
    type: 'module',
    port: null,
    version: '1.0.0',
    dependencies: ['event-system'],
    capabilities: ['treasury', 'forecasting']
  });

  registry.register('infrastructure-engine', {
    name: 'ProtoForge Infrastructure',
    type: 'module',
    port: null,
    version: '1.0.0',
    dependencies: ['event-system'],
    capabilities: ['digital_twin', 'power_monitoring']
  });

  // Check startup sequence respects dependencies
  const seq = registry.getStartupSequence();
  const eventIdx = seq.findIndex(s => s.id === 'event-system');
  const financeIdx = seq.findIndex(s => s.id === 'financial-engine');
  ok('Startup sequence computed', seq.length === 3);
  ok('Event system before finance (topological)', eventIdx < financeIdx);

  const status = registry.getStatus();
  ok('Registry status has 3 services', status.total === 3);
  ok('Registry status has dependency graph', status.dependencyGraph.nodes.length === 3);
  ok('Financial engine depends on event-system',
    status.dependencyGraph.edges.some(e => e.from === 'event-system' && e.to === 'financial-engine'));

  // ── Health Manager Tests ──
  console.log('\n3. Health Manager');
  const healthManager = new HealthManager();
  healthManager.setRegistry(registry);

  // Simulate heartbeats
  registry.heartbeat('event-system', { status: 'healthy', uptime: 1000, memory: 45, cpu: 12 });
  registry.heartbeat('financial-engine', { status: 'healthy', uptime: 500, memory: 30, cpu: 8 });

  const sysHealth = healthManager.getSystemHealth();
  ok('Health manager sees 3 services', sysHealth.total === 3);
  ok('All services healthy', sysHealth.overall === 'healthy');
  ok('Health history stored', healthManager.getHealthHistory('event-system').length >= 1);

  // ── Failure Injection Test ──
  console.log('\n4. Failure Injection');
  let recoveryTriggered = false;
  let failureDetected = false;

  // Mark a service as failed manually
  registry.markFailed('financial-engine', 'simulated_failure');

  ok('Registry marks service failed', registry.services.get('financial-engine').status === 'failed');

  // Verify dependents are notified
  const dependents = registry.getDependents('event-system');
  ok('Financial engine is dependent of event-system', dependents.includes('financial-engine'));

  // ── Recovery Engine Tests ──
  console.log('\n5. Recovery Engine');
  const recoveryEngine = new RecoveryEngine({ checkInterval: 1000 });
  recoveryEngine.setRegistry(registry);

  recoveryEngine.on('recovery_failed', (evt) => { recoveryTriggered = true; });

  const recoveryResult = await recoveryEngine.recover('financial-engine', 'test_failure');
  ok('Recovery engine attempted restart', recoveryResult.action === 'restart' || recoveryResult.action === 'escalate');
  ok('Recovery stats tracked', recoveryEngine.getStats().total >= 1);

  // ── Workflow Orchestrator Tests ──
  console.log('\n6. Workflow Orchestrator');
  const workflowOrchestrator = new WorkflowOrchestrator();
  workflowOrchestrator.setRegistry(registry);

  ok('Definitions registered', workflowOrchestrator.definitions.size > 0);
  ok('Grant application definition exists', workflowOrchestrator.definitions.has('grant_application'));
  ok('Revenue pipeline definition exists', workflowOrchestrator.definitions.has('revenue_pipeline'));

  // Start a workflow with auto-approval (no human in the loop for test)
  const workflowId = workflowOrchestrator.startWorkflow('infrastructure_alert', { alert: 'overheating' }, { autoApproval: true });
  ok('Workflow started', typeof workflowId === 'string');

  // Wait briefly for execution
  await sleep(1000);

  const wfStatus = workflowOrchestrator.getWorkflowStatus(workflowId);
  ok('Workflow status retrievable', !!wfStatus, wfStatus ? null : 'workflowId may be Promise or workflow crashed');
  ok('Workflow has steps', wfStatus && wfStatus.steps.length > 0);

  const wfList = workflowOrchestrator.listWorkflows();
  ok('Workflow list returns definitions', wfList.definitions.length > 0);

  // ── Resource Manager Tests ──
  console.log('\n7. Resource Manager');
  const resourceManager = new ResourceManager();
  resourceManager.setRegistry(registry);

  resourceManager.sampleResources();
  const resStatus = resourceManager.getStatus();
  ok('Resource status has CPU', typeof resStatus.resources.cpu.current === 'number');
  ok('Resource status has RAM', typeof resStatus.resources.ram.current === 'number');
  ok('Resource status has agents', typeof resStatus.resources.agents.current === 'number');

  // Test allocation
  resourceManager.allocate('test-service', { cpu: 10, ram: 256 });
  ok('Resource allocation tracked', resourceManager.allocations.has('test-service'));

  resourceManager.release('test-service');
  ok('Resource release works', !resourceManager.allocations.has('test-service'));

  // ── State Manager Tests ──
  console.log('\n8. State Manager');
  const StateManager = hydiModule('state-manager');
  ok('StateManager loaded', !!StateManager);

  let sm = null;
  if (StateManager) {
    sm = new StateManager({ dbPath: path.join(__dirname, '..', 'data', 'test-state.db') });
    await sm.initialize();
    ok('State manager initialized', sm.initialized);

    await sm.audit('workflow_started', { actor: 'test', target: 'wf_123', data: { test: true } });
    const auditRecords = await sm.queryAudit({ limit: 10 });
    ok('Audit ledger records events', auditRecords.length >= 1);
    ok('Audit record has event type', auditRecords[0].event_type === 'workflow_started');

    const wfState = { id: 'wf_test', definition: 'test', status: 'running', steps: [], currentStepIndex: 0, createdAt: Date.now() };
    await sm.persistWorkflow(wfState);
    const loadedWf = await sm.loadWorkflow('wf_test');
    ok('Workflow persisted and loaded', !!loadedWf && loadedWf.id === 'wf_test');

    const status = await sm.getStatus();
    ok('State status returned', !!status);
    ok('State status has audit count', typeof status.auditRecords === 'number' || typeof status.auditRecords === 'object');

    await sm.close();
  }

  // ── Full System Snapshot ──
  console.log('\n9. System Snapshot');
  const snapshot = registry.exportSnapshot();
  ok('Snapshot exported', !!snapshot.timestamp);
  ok('Snapshot has services', Object.keys(snapshot.services).length === 3);

  // ── Cleanup ──
  healthManager.stop();
  resourceManager.stop();

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n⚠️  Some validations failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n🎯 All validations passed. OS layer is wired correctly.');
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

run().catch(err => {
  console.error('Fatal validation error:', err);
  process.exit(1);
});
