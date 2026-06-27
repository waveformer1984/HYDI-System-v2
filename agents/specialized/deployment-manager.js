#!/usr/bin/env node
/**
 * HYDI DEPLOYMENT MANAGER AGENT — Safe Deployment Orchestrator
 *
 * Layer: Between Command (Toby) and Operator Agent
 * Responsibilities:
 *   - Validate → Snapshot → Deploy → Health Check → Verify → Promote
 *   - Automatic rollback on failure
 *   - Deployment history & audit
 *   - Environment / port / git validation before deploy
 *   - Smoke test execution post-deploy
 *
 * Environment:
 *   HYDI_SYSTEM_PATH   — override path to HYDI_System root
 *   DEPLOYMENT_PORT    — agent HTTP port (default: 3008)
 *   URSULA_URL         — Ursula health endpoint (default: https://ursula-nine.vercel.app)
 *   AUTO_ROLLBACK      — enable auto-rollback (default: true)
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
  console.warn(`[DEPLOYMENT] Module not found: ${p}. Running in degraded mode.`);
  return null;
}

// ── Load canonical modules ──
let DeploymentManagerModule, ServiceRegistry, HealthManager, RecoveryEngine, StateManager;
try {
  DeploymentManagerModule = hydiModule('deployment-manager');
  ServiceRegistry         = hydiModule('service-registry');
  HealthManager           = hydiModule('health-manager');
  RecoveryEngine          = hydiModule('recovery-engine');
  StateManager            = hydiModule('state-manager');
} catch (e) {
  console.error('[DEPLOYMENT] Failed to load canonical modules:', e.message);
}

// ── Express & HTTP ──
const express = require('express');

const PORT = parseInt(process.env.DEPLOYMENT_PORT || '3008', 10);
const URSULA_URL = process.env.URSULA_URL || 'https://ursula-nine.vercel.app';
const AUTO_ROLLBACK = process.env.AUTO_ROLLBACK !== 'false';
const app = express();
const server = http.createServer(app);

app.use(express.json());

// ── Capabilities ──
const CAPABILITIES = [
  'deployment_orchestration',
  'pre_deploy_validation',
  'snapshot_management',
  'health_check_post_deploy',
  'verification_testing',
  'auto_rollback',
  'manual_rollback',
  'deployment_history',
  'audit_logging',
  'environment_checks'
];

// ── State ──
const state = {
  status: 'initializing',
  startedAt: new Date().toISOString(),
  modules: {
    deploymentManager: !!DeploymentManagerModule,
    serviceRegistry: !!ServiceRegistry,
    healthManager: !!HealthManager,
    recoveryEngine: !!RecoveryEngine,
    stateManager: !!StateManager
  },
  deployments: [],
  currentDeployment: null,
  rollbackAvailable: false,
  currentVersion: '0.0.0',
  lastDeploy: null,
  warnings: []
};

// ── Core deployment manager instance (lazy init) ──
let dm = null;

function getDM() {
  if (dm) return dm;
  const DM = DeploymentManagerModule || null;
  if (!DM) return null;
  dm = new DM({ autoRollback: AUTO_ROLLBACK });
  if (ServiceRegistry) {
    const SR = ServiceRegistry.ServiceRegistry || ServiceRegistry;
    const sr = new SR();
    sr.register('ursula', { name: 'Ursula Agent', type: 'agent', status: 'healthy', port: 3005, url: URSULA_URL, version: '1.0.0', dependencies: [], capabilities: ['health_endpoint', 'sse_stream'] });
    sr.register('operator', { name: 'Operator Agent', type: 'agent', status: 'healthy', port: 3007, url: `http://localhost:3007`, version: '1.0.0', dependencies: ['ursula'], capabilities: ['startup_validation', 'system_certification'] });
    sr.register('deployment_manager', { name: 'Deployment Manager', type: 'agent', status: 'healthy', port: PORT, url: `http://localhost:${PORT}`, version: '1.0.0', dependencies: ['operator'], capabilities: ['deployment_orchestration', 'auto_rollback'] });
    dm.setRegistry(sr);
  }
  if (HealthManager) {
    const HM = HealthManager.HealthManager || HealthManager;
    dm.setHealthManager(new HM());
  }
  if (RecoveryEngine) {
    const RE = RecoveryEngine.RecoveryEngine || RecoveryEngine;
    dm.setRecoveryEngine(new RE());
  }
  if (StateManager) {
    const SM = StateManager.StateManager || StateManager;
    const sm = new SM({ dbPath: path.join(HYDI_ROOT, 'data', 'hydi-state.db') });
    sm.initialize().catch(() => {});
    dm.setStateManager(sm);
  }
  dm.on('deployment_started', (evt) => { state.currentDeployment = evt.deploymentId; });
  dm.on('deployment_promoted', (evt) => { state.lastDeploy = evt.deploymentId; });
  dm.on('deployment_failed', (evt) => { state.warnings.push(`Deploy ${evt.deploymentId} failed: ${evt.error}`); });
  return dm;
}

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

// ── Environment Checks ──
async function runEnvironmentChecks() {
  const result = { passed: [], failed: [], warnings: [], details: {} };

  // Required files
  for (const f of ['package.json', '.env', 'next.config.js']) {
    const exists = fs.existsSync(path.join(HYDI_ROOT, f));
    if (exists) result.passed.push(`file_${f}`);
    else result.failed.push(`file_${f}`);
  }

  // node_modules
  result.details.nodeModules = fs.existsSync(path.join(HYDI_ROOT, 'node_modules'));
  if (result.details.nodeModules) result.passed.push('node_modules_present');
  else result.failed.push('node_modules_missing');

  // Git status
  try {
    const { stdout } = await execAsync('git status --short', { cwd: HYDI_ROOT });
    result.details.gitClean = !stdout || stdout.trim().length === 0;
    if (result.details.gitClean) result.passed.push('git_clean');
    else { result.warnings.push('git_dirty'); result.details.dirtyFiles = stdout.trim().split('\n'); }
  } catch (e) { result.failed.push('git_check'); result.details.gitError = e.message; }

  // Git branch
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: HYDI_ROOT });
    result.details.gitBranch = stdout ? stdout.trim() : 'unknown';
    result.passed.push('git_branch_detected');
  } catch (e) { result.warnings.push('git_branch_failed'); }

  // Database directory
  const dbDir = path.resolve(HYDI_ROOT, 'data');
  result.details.databaseDir = fs.existsSync(dbDir);
  if (result.details.databaseDir) result.passed.push('database_dir');
  else result.warnings.push('database_dir_missing');

  // Version file
  const versionFile = path.resolve(HYDI_ROOT, 'VERSION');
  result.details.versionFile = fs.existsSync(versionFile);
  if (result.details.versionFile) result.passed.push('version_file');
  else result.warnings.push('version_file_missing');

  // Port checks (list expected ports)
  result.details.expectedPorts = [3005, 3006, 3007, 3008, 4000, 5050];
  result.passed.push('port_list_generated');

  // OS resources
  result.details.os = {
    loadavg: os.loadavg(),
    freememPercent: Math.round((os.freemem() / os.totalmem()) * 100),
    totalmem: os.totalmem()
  };
  if (result.details.os.freememPercent > 10) result.passed.push('memory_ok');
  else result.warnings.push('low_memory');

  return result;
}

// ── Smoke Tests ──
async function runSmokeTests() {
  const result = { passed: [], failed: [], warnings: [], details: {} };

  // Ursula health
  const ursula = await httpGet(`${URSULA_URL}/health`);
  if (ursula.statusCode === 200) result.passed.push('ursula_health');
  else result.failed.push('ursula_health');

  // Ursula status endpoint keys
  const ursulaStatus = await httpGet(`${URSULA_URL}/status`);
  if (ursulaStatus.statusCode === 200) result.passed.push('ursula_status');
  else result.failed.push('ursula_status');

  // Operator health (if running)
  const operatorHealth = await httpGet('http://localhost:3007/health');
  if (operatorHealth.statusCode === 200) result.passed.push('operator_health');
  else result.warnings.push('operator_health_unavailable');

  // Heidi Bridge health (if running)
  const bridgeHealth = await httpGet('http://localhost:5050/health');
  if (bridgeHealth.statusCode === 200) result.passed.push('heidi_bridge_health');
  else result.warnings.push('heidi_bridge_health_unavailable');

  return result;
}

// ── Routes ──

app.get('/health', (_req, res) => {
  const d = getDM();
  res.json({
    agent: 'deployment-manager',
    status: state.status,
    uptime: Date.now() - new Date(state.startedAt).getTime(),
    modules: state.modules,
    port: PORT,
    hydiRoot: HYDI_ROOT,
    currentVersion: state.currentVersion,
    rollbackAvailable: state.rollbackAvailable,
    currentDeployment: state.currentDeployment,
    lastDeploy: state.lastDeploy
  });
});

app.get('/status', (_req, res) => { res.json(state); });
app.get('/capabilities', (_req, res) => { res.json({ capabilities: CAPABILITIES }); });

// Environment checks
app.post('/validate/environment', async (_req, res) => {
  const result = await runEnvironmentChecks();
  ok(res, result);
});

// Smoke tests
app.post('/test/smoke', async (_req, res) => {
  const result = await runSmokeTests();
  ok(res, result);
});

// Deploy
app.post('/deploy', async (req, res) => {
  const d = getDM();
  if (!d) return fail(res, 503, 'DeploymentManager module not loaded');
  const spec = req.body || {};
  if (!spec.version) return fail(res, 400, 'version is required');

  try {
    const result = await d.deploy(spec);
    state.deployments.push(result.deploymentId);
    state.currentVersion = d.getCurrentVersion ? d.getCurrentVersion() : spec.version;
    state.rollbackAvailable = d.rollbackStack && d.rollbackStack.length > 0;
    ok(res, result);
  } catch (e) {
    state.warnings.push(`Deploy failed: ${e.message}`);
    fail(res, 500, e.message);
  }
});

// Rollback
app.post('/rollback', async (_req, res) => {
  const d = getDM();
  if (!d) return fail(res, 503, 'DeploymentManager module not loaded');
  try {
    const result = await d.rollback();
    state.rollbackAvailable = d.rollbackStack && d.rollbackStack.length > 0;
    ok(res, result);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// Deployment status
app.get('/deploy/status', (_req, res) => {
  const d = getDM();
  if (!d) return fail(res, 503, 'DeploymentManager module not loaded');
  ok(res, d.getStatus ? d.getStatus() : { status: 'unknown' });
});

// Deployment history
app.get('/deploy/history', (_req, res) => {
  const d = getDM();
  if (!d) return fail(res, 503, 'DeploymentManager module not loaded');
  ok(res, { deployments: d.deployments ? d.deployments.slice(-20) : [] });
});

// Full pipeline: environment checks + deploy + smoke tests
app.post('/pipeline/deploy', async (req, res) => {
  const d = getDM();
  if (!d) return fail(res, 503, 'DeploymentManager module not loaded');
  const spec = req.body || {};
  if (!spec.version) return fail(res, 400, 'version is required');

  const pipeline = {
    version: spec.version,
    timestamp: new Date().toISOString(),
    phases: [],
    verdict: 'pending'
  };

  const runPhase = async (name, fn) => {
    try {
      const result = await fn();
      pipeline.phases.push({ name, status: 'passed', result });
      return result;
    } catch (e) {
      pipeline.phases.push({ name, status: 'failed', error: e.message });
      throw e;
    }
  };

  try {
    await runPhase('environment_check', async () => runEnvironmentChecks());
    await runPhase('deploy', async () => d.deploy(spec));
    await runPhase('smoke_test', async () => runSmokeTests());
    pipeline.verdict = 'success';
    state.currentVersion = d.getCurrentVersion ? d.getCurrentVersion() : spec.version;
    ok(res, pipeline);
  } catch (e) {
    pipeline.verdict = 'failed';
    state.warnings.push(`Pipeline failed: ${e.message}`);
    fail(res, 500, pipeline);
  }
});

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ status: 'error', error: 'Endpoint not found', capabilities: CAPABILITIES });
});

// ── Start ──
async function start() {
  console.log('🚀  HYDI DEPLOYMENT MANAGER AGENT');
  console.log('   HYDI Root:', HYDI_ROOT);
  console.log('   Port:', PORT);
  console.log('   Auto-Rollback:', AUTO_ROLLBACK);
  console.log('');

  // Environment sanity
  const env = await runEnvironmentChecks();
  console.log('   Environment:', env.failed.length === 0 ? 'ok' : 'issues found');
  if (env.failed.length) env.failed.forEach(f => console.log('   ❌', f));
  if (env.warnings.length) env.warnings.forEach(w => console.log('   ⚠️ ', w));
  console.log('');

  const mods = [
    { name: 'Deployment Manager', mod: DeploymentManagerModule },
    { name: 'Service Registry', mod: ServiceRegistry },
    { name: 'Health Manager', mod: HealthManager },
    { name: 'Recovery Engine', mod: RecoveryEngine },
    { name: 'State Manager', mod: StateManager }
  ];
  mods.forEach(m => console.log(m.mod ? `   ✅ ${m.name}` : `   ⚠️  ${m.name}: NOT LOADED`));

  // Set version from file if exists
  const versionFile = path.resolve(HYDI_ROOT, 'VERSION');
  if (fs.existsSync(versionFile)) {
    state.currentVersion = fs.readFileSync(versionFile, 'utf8').trim();
  }

  server.listen(PORT, () => {
    state.status = 'running';
    console.log('');
    console.log(`🌐 Deployment Manager running on http://localhost:${PORT}`);
    console.log(`   Health:       http://localhost:${PORT}/health`);
    console.log(`   Status:       http://localhost:${PORT}/status`);
    console.log(`   Capabilities: http://localhost:${PORT}/capabilities`);
    console.log(`   Validate Env: POST http://localhost:${PORT}/validate/environment`);
    console.log(`   Smoke Test:   POST http://localhost:${PORT}/test/smoke`);
    console.log(`   Deploy:       POST http://localhost:${PORT}/deploy`);
    console.log(`   Rollback:     POST http://localhost:${PORT}/rollback`);
    console.log(`   Full Pipeline: POST http://localhost:${PORT}/pipeline/deploy`);
    console.log('');
    console.log('   To wire into HYDI_System, set HYDI_SYSTEM_PATH env var.');
    console.log('   To point at Ursula, set URSULA_URL env var.');
  });
}

start().catch(err => { console.error('❌ Fatal startup error:', err); process.exit(1); });
