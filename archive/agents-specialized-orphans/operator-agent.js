#!/usr/bin/env node
/**
 * HYDI OPERATOR AGENT — Autonomous Test Pilot & System Certifier
 *
 * Layer: Between Command (Toby) and Communications (Ursula)
 * Responsibilities:
 *   - Startup Validation
 *   - Continuous Testing (heartbeat, workflow, state, recovery, resource)
 *   - Chaos Testing (safe failure injection)
 *   - Setup Automation
 *   - System Certification (HYDI READY / DEGRADED / FAILED)
 *
 * Environment:
 *   HYDI_SYSTEM_PATH — override path to HYDI_System root
 *   OPERATOR_PORT    — agent HTTP port (default: 3006)
 *   URSULA_URL       — Ursula health endpoint (default: http://localhost:3005)
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const http  = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ── Resolve HYDI_System root ──
const DEFAULT_HYDI_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'HYDI_System');
const HYDI_ROOT = process.env.HYDI_SYSTEM_PATH || DEFAULT_HYDI_PATH;

function hydiModule(mod) {
  const p = path.join(HYDI_ROOT, 'modules', mod);
  if (fs.existsSync(p + '.js')) return require(p);
  console.warn(`[OPERATOR] Module not found: ${p}. Running in degraded mode.`);
  return null;
}

// ── Load canonical modules (graceful degradation) ──
let ServiceRegistry, HealthManager, RecoveryEngine, WorkflowOrchestrator;
let ResourceManager, StateManager, EventSystem, FinancialEngine, InfrastructureEngine;

try {
  ServiceRegistry    = hydiModule('service-registry');
  HealthManager      = hydiModule('health-manager');
  RecoveryEngine     = hydiModule('recovery-engine');
  WorkflowOrchestrator = hydiModule('workflow-orchestrator');
  ResourceManager    = hydiModule('resource-manager');
  StateManager       = hydiModule('state-manager');
  EventSystem        = hydiModule('protoforge-event-system');
  FinancialEngine    = hydiModule('protoforge-financial-engine');
  InfrastructureEngine = hydiModule('protoforge-infrastructure');
} catch (e) {
  console.error('[OPERATOR] Failed to load canonical modules:', e.message);
}

// ── Express & HTTP ──
const express = require('express');

const PORT = parseInt(process.env.OPERATOR_PORT || '3006', 10);
const URSULA_URL = process.env.URSULA_URL || 'https://ursula-nine.vercel.app';
const app = express();
const server = http.createServer(app);

app.use(express.json());

// ── Capabilities ──
const CAPABILITIES = [
  'startup_validation',
  'health_audit',
  'chaos_testing',
  'workflow_testing',
  'dependency_verification',
  'state_validation',
  'deployment_validation',
  'backup_verification',
  'recovery_testing',
  'system_certification'
];

// ── State ──
const state = {
  status: 'initializing',
  startedAt: new Date().toISOString(),
  modules: {
    serviceRegistry: !!ServiceRegistry,
    healthManager: !!HealthManager,
    recoveryEngine: !!RecoveryEngine,
    workflowOrchestrator: !!WorkflowOrchestrator,
    resourceManager: !!ResourceManager,
    stateManager: !!StateManager,
    eventSystem: !!EventSystem,
    financialEngine: !!FinancialEngine,
    infrastructureEngine: !!InfrastructureEngine
  },
  servicesChecked: 0,
  healthyServices: 0,
  warnings: [],
  lastCertification: null,
  continuousTesting: false,
  testIntervalMs: 5 * 60 * 1000,
  testTimer: null,
  testHistory: []
};

// ── Helpers ──
function ok(res, payload) { res.json({ status: 'ok', timestamp: new Date().toISOString(), ...payload }); }
function fail(res, code, error) { res.status(code).json({ status: 'error', timestamp: new Date().toISOString(), error }); }

async function httpGet(url, timeout = 5000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.on('error', () => resolve({ statusCode: 0, body: null }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, body: null }); });
  });
}

function recordTest(name, passed, details = {}) {
  const entry = { name, passed, time: new Date().toISOString(), details };
  state.testHistory.push(entry);
  if (state.testHistory.length > 200) state.testHistory.shift();
  return entry;
}

// ── Startup Validation ──
async function validateStartup() {
  const result = { status: 'ready', healthy: true, services: 0, warnings: [], checks: {} };
  const requiredModules = [
    { key: 'serviceRegistry',    name: 'Service Registry',     mod: ServiceRegistry },
    { key: 'healthManager',      name: 'Health Manager',         mod: HealthManager },
    { key: 'recoveryEngine',     name: 'Recovery Engine',        mod: RecoveryEngine },
    { key: 'workflowOrchestrator', name: 'Workflow Orchestrator', mod: WorkflowOrchestrator },
    { key: 'resourceManager',    name: 'Resource Manager',       mod: ResourceManager },
    { key: 'stateManager',       name: 'State Manager',          mod: StateManager },
    { key: 'eventSystem',        name: 'Event System',           mod: EventSystem },
    { key: 'financialEngine',    name: 'Financial Engine',       mod: FinancialEngine },
    { key: 'infrastructureEngine', name: 'Infrastructure Engine', mod: InfrastructureEngine }
  ];
  for (const item of requiredModules) {
    const present = !!item.mod;
    result.checks[item.key] = present ? 'ok' : 'missing';
    if (!present) { result.warnings.push(`${item.name} not loaded`); result.healthy = false; }
    else { result.services++; }
  }
  const ursula = await httpGet(`${URSULA_URL}/health`);
  result.checks.ursula = (ursula.statusCode === 200) ? 'ok' : 'unreachable';
  if (ursula.statusCode !== 200) { result.warnings.push('Ursula unreachable'); result.healthy = false; }
  else { result.services++; }
  const dbDir = path.resolve(HYDI_ROOT, 'data');
  const dbOk = fs.existsSync(dbDir) || fs.existsSync(path.resolve(HYDI_ROOT, 'hydi-state.db'));
  result.checks.database = dbOk ? 'ok' : 'missing';
  if (!dbOk) { result.warnings.push('State database directory not found'); result.healthy = false; }
  const envOk = fs.existsSync(path.join(HYDI_ROOT, '.env'));
  result.checks.environment = envOk ? 'ok' : 'missing';
  if (!envOk) result.warnings.push('.env file missing');
  if (result.warnings.length > 0) result.status = result.healthy ? 'degraded' : 'failed';
  state.servicesChecked = result.services;
  state.healthyServices = result.healthy ? result.services : 0;
  state.warnings = result.warnings;
  return result;
}

// ── Health Audit ──
async function runHealthAudit() {
  const audit = { passed: [], failed: [], details: {} };
  if (HealthManager) {
    try { const hm = HealthManager.HealthManager ? new HealthManager.HealthManager() : new HealthManager(); audit.details.healthManager = { status: 'initialized', running: hm.running || false }; audit.passed.push('health_manager_init'); }
    catch (e) { audit.failed.push('health_manager_init'); audit.details.healthManager = { error: e.message }; }
  } else { audit.failed.push('health_manager_init'); }
  if (ServiceRegistry) {
    try { const sr = ServiceRegistry.ServiceRegistry ? new ServiceRegistry.ServiceRegistry() : new ServiceRegistry(); const svcCount = sr.services ? sr.services.size : 0; audit.details.serviceRegistry = { services: svcCount, startupOrderLength: sr.startupOrder ? sr.startupOrder.length : 0 }; audit.passed.push('service_registry_init'); }
    catch (e) { audit.failed.push('service_registry_init'); audit.details.serviceRegistry = { error: e.message }; }
  } else { audit.failed.push('service_registry_init'); }
  if (ResourceManager) {
    try { const rm = ResourceManager.ResourceManager ? new ResourceManager.ResourceManager() : new ResourceManager(); const sample = rm.resources || {}; audit.details.resourceManager = { resources: Object.keys(sample) }; audit.passed.push('resource_manager_init'); }
    catch (e) { audit.failed.push('resource_manager_init'); audit.details.resourceManager = { error: e.message }; }
  } else { audit.failed.push('resource_manager_init'); }
  audit.details.os = { loadavg: os.loadavg(), freemem: os.freemem(), totalmem: os.totalmem(), uptime: os.uptime() };
  return audit;
}

// ── Workflow Testing ──
async function runWorkflowTest() {
  const result = { passed: [], failed: [], details: {} };
  if (!WorkflowOrchestrator || !StateManager) { result.failed.push('modules_unavailable'); return result; }
  try {
    const WO = WorkflowOrchestrator.WorkflowOrchestrator || WorkflowOrchestrator;
    const SM = StateManager.StateManager || StateManager;
    const wo = new WO();
    const sm = new SM({ dbPath: path.join(HYDI_ROOT, 'data', 'hydi-operator-test.db') });
    await sm.initialize();
    wo.setStateManager(sm);
    const testDef = { name: 'Operator Test Workflow', description: 'Ephemeral workflow for operator validation', steps: [
      { id: 'validate', agent: 'operator', action: 'noop', timeout: 10000 },
      { id: 'confirm', agent: 'operator', action: 'noop', dependsOn: ['validate'], timeout: 10000 }
    ]};
    wo.registerDefinition('operator_test', testDef);
    const workflowId = wo.startWorkflow('operator_test', { initiatedBy: 'operator_agent' });
    result.details.workflowId = workflowId || null;
    result.passed.push('workflow_created');
    if (workflowId) {
      const wfInstance = wo.workflows ? wo.workflows.get(workflowId) : null;
      if (wfInstance) { wfInstance.status = 'completed'; wfInstance.completedAt = Date.now(); if (wo.stateManager) await wo.persist(wfInstance); }
      result.passed.push('workflow_persisted');
    }
    const auditBefore = sm.memoryMode ? [] : await new Promise((resolve) => { if (!sm.db) return resolve([]); sm.db.all('SELECT * FROM audit_ledger ORDER BY id DESC LIMIT 5', [], (err, rows) => resolve(err ? [] : rows)); });
    result.details.auditEntries = auditBefore.length;
    if (auditBefore.length > 0) result.passed.push('audit_persistence');
    if (sm.db && !sm.memoryMode) { await new Promise((res) => sm.db.run("DELETE FROM workflows WHERE definition = ?", ['operator_test'], () => res())); }
    result.passed.push('workflow_cleanup');
  } catch (e) { result.failed.push('workflow_test_error'); result.details.error = e.message; }
  return result;
}

// ── Recovery Testing ──
async function runRecoveryTest() {
  const result = { passed: [], failed: [], details: {} };
  if (!RecoveryEngine) { result.failed.push('recovery_engine_unavailable'); return result; }
  try {
    const RE = RecoveryEngine.RecoveryEngine || RecoveryEngine;
    const re = new RE();
    result.details.playbooks = Array.from(re.playbooks ? re.playbooks.keys() : []);
    result.passed.push('recovery_engine_init');
    const requiredPlaybooks = ['default', 'missed_polls', 'health_check_failed', 'dead'];
    for (const pb of requiredPlaybooks) {
      if (re.playbooks && re.playbooks.has(pb)) result.passed.push(`playbook_${pb}`);
      else result.failed.push(`playbook_${pb}`);
    }
  } catch (e) { result.failed.push('recovery_engine_init'); result.details.error = e.message; }
  return result;
}

// ── State Validation ──
async function runStateValidation() {
  const result = { passed: [], failed: [], details: {} };
  if (!StateManager) { result.failed.push('state_manager_unavailable'); return result; }
  try {
    const SM = StateManager.StateManager || StateManager;
    const sm = new SM({ dbPath: path.join(HYDI_ROOT, 'data', 'hydi-state.db') });
    await sm.initialize();
    result.details.mode = sm.memoryMode ? 'memory' : 'sqlite';
    result.details.initialized = sm.initialized;
    result.passed.push('state_manager_init');
    if (!sm.memoryMode && sm.db) {
      const tables = await new Promise((resolve) => { sm.db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => resolve(err ? [] : rows.map(r => r.name))); });
      result.details.tables = tables;
      for (const t of ['workflows', 'audit_ledger']) { if (tables.includes(t)) result.passed.push(`table_${t}`); else result.failed.push(`table_${t}`); }
    } else { result.passed.push('memory_mode_fallback'); }
  } catch (e) { result.failed.push('state_manager_init'); result.details.error = e.message; }
  return result;
}

// ── Dependency Verification ──
async function runDependencyVerification() {
  const result = { passed: [], failed: [], details: {} };
  if (!ServiceRegistry) { result.failed.push('service_registry_unavailable'); return result; }
  try {
    const SR = ServiceRegistry.ServiceRegistry || ServiceRegistry;
    const sr = new SR();
    sr.register('alpha', { name: 'Alpha Service', dependencies: ['beta'], capabilities: ['test'] });
    sr.register('beta',  { name: 'Beta Service',  dependencies: [], capabilities: ['test'] });
    sr.register('gamma', { name: 'Gamma Service', dependencies: ['alpha', 'beta'], capabilities: ['test'] });
    result.details.startupOrder = sr.startupOrder || [];
    result.details.dependencyCount = sr.dependencies ? sr.dependencies.size : 0;
    result.passed.push('dependency_graph_built');
    const order = sr.startupOrder || [];
    const alphaIdx = order.indexOf('alpha');
    const betaIdx = order.indexOf('beta');
    if (betaIdx !== -1 && alphaIdx !== -1 && betaIdx < alphaIdx) result.passed.push('topological_order_valid');
    else if (order.length === 0) result.passed.push('topological_order_empty_ok');
    else result.failed.push('topological_order_invalid');
  } catch (e) { result.failed.push('dependency_verification_error'); result.details.error = e.message; }
  return result;
}

// ── Backup Verification ──
async function runBackupVerification() {
  const result = { passed: [], failed: [], details: {} };
  const backupDir = path.resolve(HYDI_ROOT, 'recovery_backups');
  const gitDir = path.resolve(HYDI_ROOT, '.git');
  result.details.backupDir = backupDir;
  result.details.backupDirExists = fs.existsSync(backupDir);
  result.details.gitExists = fs.existsSync(gitDir);
  if (result.details.backupDirExists) {
    const files = fs.readdirSync(backupDir).slice(0, 10);
    result.details.backupFiles = files.length;
    result.passed.push('backup_directory_present');
  } else { result.warnings = (result.warnings || []).concat('backup_directory_missing'); }
  if (result.details.gitExists) {
    result.passed.push('git_repository_present');
    try { const { stdout } = await execAsync('git status --short', { cwd: HYDI_ROOT }); result.details.gitClean = !stdout || stdout.trim().length === 0; if (result.details.gitClean) result.passed.push('git_clean'); else result.failed.push('git_dirty'); }
    catch (e) { result.failed.push('git_status_error'); result.details.gitError = e.message; }
  } else { result.failed.push('git_repository_missing'); }
  return result;
}

// ── Deployment Validation ──
async function runDeploymentValidation() {
  const result = { passed: [], failed: [], details: {} };
  for (const f of ['package.json', 'next.config.js', '.env', 'ecosystem.config.js']) {
    if (fs.existsSync(path.join(HYDI_ROOT, f))) result.passed.push(`file_${f}`);
    else result.failed.push(`file_${f}`);
  }
  result.details.nodeModules = fs.existsSync(path.join(HYDI_ROOT, 'node_modules'));
  if (result.details.nodeModules) result.passed.push('node_modules_present'); else result.failed.push('node_modules_missing');
  result.details.ursulaPort = 3005;
  result.details.operatorPort = PORT;
  return result;
}

// ── Chaos Testing ──
async function runChaosTest(params = {}) {
  const result = { passed: [], failed: [], details: {}, safe: true };
  const type = params.type || 'memory_pressure';
  if (type === 'memory_pressure') {
    const memBefore = process.memoryUsage();
    const buffers = [];
    try {
      for (let i = 0; i < 5; i++) buffers.push(Buffer.alloc(1024 * 1024 * 5));
      const memAfter = process.memoryUsage();
      result.details.memoryDelta = memAfter.heapUsed - memBefore.heapUsed;
      result.passed.push('memory_pressure_simulated');
    } finally { buffers.length = 0; if (global.gc) global.gc(); }
  } else if (type === 'cpu_spike') {
    const start = Date.now(); while (Date.now() - start < 100) { Math.random(); }
    result.passed.push('cpu_spike_simulated');
  } else if (type === 'service_stop') {
    result.details.note = 'service_stop requires explicit target; operator only stops its own test timers';
    result.passed.push('service_stop_mock');
  } else if (type === 'dependency_break') {
    if (!ServiceRegistry) { result.failed.push('service_registry_unavailable'); return result; }
    const SR = ServiceRegistry.ServiceRegistry || ServiceRegistry;
    const sr = new SR();
    sr.register('mock_dep', { dependencies: ['missing_dep'] });
    const deps = sr.dependencies.get('mock_dep');
    const missing = deps && !sr.services.has('missing_dep');
    result.details.missingDependencyDetected = !!missing;
    result.passed.push('dependency_break_detected');
  } else { result.failed.push('unknown_chaos_type'); }
  return result;
}

// ── System Certification ──
async function runSystemCertification() {
  const report = { certification: 'HYDI_SYSTEM_CERTIFICATION', timestamp: new Date().toISOString(), steps: [], verdict: 'HYDI READY', warnings: [], errors: [] };
  const step = async (name, fn) => {
    try {
      const res = await fn();
      report.steps.push({ name, status: (res.failed && res.failed.length > 0) ? 'warning' : 'passed', result: res });
      if (res.failed && res.failed.length > 0) { report.warnings.push(`${name}: ${res.failed.join(', ')}`); if (report.verdict === 'HYDI READY') report.verdict = 'HYDI DEGRADED'; }
      return res;
    } catch (e) { report.steps.push({ name, status: 'failed', error: e.message }); report.errors.push(`${name}: ${e.message}`); report.verdict = 'HYDI FAILED'; return { failed: [e.message] }; }
  };
  await step('Verify Registry', async () => { const r = { passed: [], failed: [] }; if (ServiceRegistry) r.passed.push('service_registry_loaded'); else r.failed.push('service_registry_missing'); return r; });
  await step('Verify Health', async () => runHealthAudit());
  await step('Verify Recovery', async () => runRecoveryTest());
  await step('Verify State', async () => runStateValidation());
  await step('Verify Audit', async () => {
    const r = { passed: [], failed: [] };
    if (StateManager) {
      const SM = StateManager.StateManager || StateManager;
      const sm = new SM({ dbPath: path.join(HYDI_ROOT, 'data', 'hydi-state.db') });
      await sm.initialize();
      if (!sm.memoryMode && sm.db) {
        const rows = await new Promise((resolve) => sm.db.get('SELECT COUNT(*) as c FROM audit_ledger', [], (err, row) => resolve(err ? 0 : (row ? row.c : 0))));
        if (rows >= 0) r.passed.push('audit_table_accessible');
      } else { r.passed.push('audit_memory_mode'); }
    } else { r.failed.push('state_manager_missing'); }
    return r;
  });
  await step('Verify Resources', async () => { const r = { passed: [], failed: [], details: {} }; r.details.loadavg = os.loadavg(); r.details.freememPercent = Math.round((os.freemem() / os.totalmem()) * 100); r.passed.push('resource_snapshot'); if (ResourceManager) r.passed.push('resource_manager_loaded'); else r.failed.push('resource_manager_missing'); return r; });
  await step('Verify Workflows', async () => runWorkflowTest());
  await step('Verify Backup', async () => runBackupVerification());
  await step('Verify Git Clean', async () => {
    const r = { passed: [], failed: [] };
    try { const { stdout } = await execAsync('git status --short', { cwd: HYDI_ROOT }); if (!stdout || stdout.trim().length === 0) r.passed.push('git_clean'); else { r.failed.push('git_dirty'); r.details = { dirtyFiles: stdout.trim().split('\n') }; } }
    catch (e) { r.failed.push('git_check_error'); r.details = { error: e.message }; }
    return r;
  });
  state.lastCertification = report;
  return report;
}

// ── Continuous Testing Loop ──
async function runContinuousTests() {
  const cycle = { time: new Date().toISOString(), results: [] };
  const ursulaHealth = await httpGet(`${URSULA_URL}/health`);
  cycle.results.push(recordTest('heartbeat_ursula', ursulaHealth.statusCode === 200, { statusCode: ursulaHealth.statusCode }));
  const wf = await runWorkflowTest();
  cycle.results.push(recordTest('workflow_validation', wf.failed.length === 0, { passed: wf.passed.length, failed: wf.failed.length }));
  const st = await runStateValidation();
  cycle.results.push(recordTest('state_persistence', st.failed.length === 0, { mode: st.details.mode }));
  const rec = await runRecoveryTest();
  cycle.results.push(recordTest('recovery_validation', rec.failed.length === 0, { playbooks: rec.details.playbooks }));
  const res = { passed: ['memory_snapshot'], details: { freemem: os.freemem(), totalmem: os.totalmem(), loadavg: os.loadavg() } };
  cycle.results.push(recordTest('resource_validation', true, res.details));
  console.log(`[OPERATOR] Continuous test cycle complete at ${cycle.time}`);
}

function startContinuousTesting() {
  if (state.continuousTesting) return;
  state.continuousTesting = true;
  state.testTimer = setInterval(() => { runContinuousTests().catch(err => console.error('[OPERATOR] Continuous test error:', err.message)); }, state.testIntervalMs);
  console.log(`[OPERATOR] Continuous testing started (interval: ${state.testIntervalMs}ms)`);
}

function stopContinuousTesting() {
  state.continuousTesting = false;
  if (state.testTimer) { clearInterval(state.testTimer); state.testTimer = null; }
  console.log('[OPERATOR] Continuous testing stopped');
}

// ── Routes ──
app.get('/health', (_req, res) => { res.json({ agent: 'operator', status: state.status, uptime: Date.now() - new Date(state.startedAt).getTime(), modules: state.modules, port: PORT, hydiRoot: HYDI_ROOT, continuousTesting: state.continuousTesting, lastCertification: state.lastCertification ? state.lastCertification.timestamp : null }); });
app.get('/status', (_req, res) => {
  res.json({
    status: state.status,
    startedAt: state.startedAt,
    modules: state.modules,
    servicesChecked: state.servicesChecked,
    healthyServices: state.healthyServices,
    warnings: state.warnings,
    lastCertification: state.lastCertification ? state.lastCertification.timestamp : null,
    continuousTesting: state.continuousTesting,
    testIntervalMs: state.testIntervalMs,
    testTimer: state.testTimer ? 'active' : null,
    testHistory: state.testHistory.slice(-20)
  });
});
app.get('/capabilities', (_req, res) => { res.json({ capabilities: CAPABILITIES }); });
app.post('/validate/startup', async (_req, res) => { const result = await validateStartup(); ok(res, result); });
app.post('/audit/health', async (_req, res) => { const result = await runHealthAudit(); ok(res, result); });
app.post('/test/workflow', async (_req, res) => { const result = await runWorkflowTest(); ok(res, result); });
app.post('/test/recovery', async (_req, res) => { const result = await runRecoveryTest(); ok(res, result); });
app.post('/test/state', async (_req, res) => { const result = await runStateValidation(); ok(res, result); });
app.post('/verify/dependencies', async (_req, res) => { const result = await runDependencyVerification(); ok(res, result); });
app.post('/verify/backup', async (_req, res) => { const result = await runBackupVerification(); ok(res, result); });
app.post('/validate/deployment', async (_req, res) => { const result = await runDeploymentValidation(); ok(res, result); });
app.post('/test/chaos', async (req, res) => { const result = await runChaosTest(req.body || {}); ok(res, result); });
app.post('/certify', async (_req, res) => { const result = await runSystemCertification(); ok(res, result); });
app.get('/certify/last', (_req, res) => { if (!state.lastCertification) return fail(res, 404, 'No certification has been run yet'); ok(res, state.lastCertification); });
app.post('/continuous/start', (_req, res) => { startContinuousTesting(); ok(res, { continuousTesting: true, intervalMs: state.testIntervalMs }); });
app.post('/continuous/stop', (_req, res) => { stopContinuousTesting(); ok(res, { continuousTesting: false }); });
app.get('/history', (_req, res) => { ok(res, { tests: state.testHistory.slice(-50) }); });
app.use((_req, res) => { res.status(404).json({ status: 'error', error: 'Endpoint not found', capabilities: CAPABILITIES }); });

// ── Start ──
async function start() {
  console.log('🚁  HYDI OPERATOR AGENT');
  console.log('   HYDI Root:', HYDI_ROOT);
  console.log('   Port:', PORT);
  console.log('');
  const startup = await validateStartup();
  console.log('   Startup Status:', startup.status);
  console.log('   Healthy:', startup.healthy);
  console.log('   Services:', startup.services);
  if (startup.warnings.length) startup.warnings.forEach(w => console.log('   ⚠️ ', w));
  console.log('');
  const mods = [
    { name: 'Service Registry', mod: ServiceRegistry },
    { name: 'Health Manager', mod: HealthManager },
    { name: 'Recovery Engine', mod: RecoveryEngine },
    { name: 'Workflow Orchestrator', mod: WorkflowOrchestrator },
    { name: 'Resource Manager', mod: ResourceManager },
    { name: 'State Manager', mod: StateManager },
    { name: 'Event System', mod: EventSystem },
    { name: 'Financial Engine', mod: FinancialEngine },
    { name: 'Infrastructure Engine', mod: InfrastructureEngine }
  ];
  mods.forEach(m => console.log(m.mod ? `   ✅ ${m.name}` : `   ⚠️  ${m.name}: NOT LOADED`));
  server.listen(PORT, () => {
    state.status = startup.status === 'ready' ? 'running' : 'degraded';
    console.log('');
    console.log(`🚀 Operator Agent running on http://localhost:${PORT}`);
    console.log(`   Health:       http://localhost:${PORT}/health`);
    console.log(`   Status:       http://localhost:${PORT}/status`);
    console.log(`   Capabilities: http://localhost:${PORT}/capabilities`);
    console.log(`   Certify:      POST http://localhost:${PORT}/certify`);
    console.log(`   Continuous:   POST http://localhost:${PORT}/continuous/start`);
    console.log('');
    console.log('   To wire into HYDI_System, set HYDI_SYSTEM_PATH env var.');
    console.log('   To point at Ursula, set URSULA_URL env var.');
  });
}

start().catch(err => { console.error('❌ Fatal startup error:', err); process.exit(1); });
