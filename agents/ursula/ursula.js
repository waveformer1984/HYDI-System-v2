#!/usr/bin/env node
/**
 * URSULA AGENT BOOTSTRAP — Canonical Entry Point
 *
 * Wires into HYDI_System modules:
 *   - Service Bundle (subscription tiers, 30 passive services)
 *   - SSE Manager   (real-time dashboard streaming)
 *   - Heartbeat     (model health & silent-failure recovery)
 *
 * Environment:
 *   HYDI_SYSTEM_PATH — override path to HYDI_System root (default: auto-detect)
 *   URSULA_PORT      — agent HTTP port (default: 3005)
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Resolve HYDI_System root ──
const DEFAULT_HYDI_PATH = path.resolve(__dirname, '..', '..');
const HYDI_ROOT = process.env.HYDI_SYSTEM_PATH || DEFAULT_HYDI_PATH;

function hydiModule(mod) {
  const p = path.join(HYDI_ROOT, 'modules', mod);
  if (fs.existsSync(p + '.js')) return require(p);
  console.warn(`[URSULA] Module not found: ${p}. Running in degraded mode.`);
  return null;
}

// ── Load canonical modules (graceful degradation) ──
let ServiceBundle, SSEManager, Heartbeat;
let ServiceRegistry, HealthManager, RecoveryEngine, WorkflowOrchestrator;

try {
  ServiceBundle = hydiModule('ursula-service-bundle');
  SSEManager  = hydiModule('ursula-sse-manager');
  Heartbeat   = hydiModule('ursula-heartbeat');
} catch (e) {
  console.error('[URSULA] Failed to load canonical modules:', e.message);
}

// ── Load OS-layer modules (new: registry, health, recovery, workflows, resources) ──
try {
  ServiceRegistry = hydiModule('service-registry');
  HealthManager   = hydiModule('health-manager');
  RecoveryEngine  = hydiModule('recovery-engine');
  WorkflowOrchestrator = hydiModule('workflow-orchestrator');
} catch (e) {
  console.error('[URSULA] Failed to load OS-layer modules:', e.message);
}

let ResourceManager;
try {
  ResourceManager = hydiModule('resource-manager');
} catch (e) {
  console.error('[URSULA] Failed to load ResourceManager:', e.message);
}

let StateManager;
try {
  StateManager = hydiModule('state-manager');
} catch (e) {
  console.error('[URSULA] Failed to load StateManager:', e.message);
}

let DeploymentManager;
try {
  DeploymentManager = hydiModule('deployment-manager');
} catch (e) {
  console.error('[URSULA] Failed to load DeploymentManager:', e.message);
}

// ── Express & HTTP ──
const express = require('express');
const http    = require('http');

const PORT = parseInt(process.env.URSULA_PORT || '3005', 10);
const app    = express();
const server = http.createServer(app);

app.use(express.json());

// ── State ──
const state = {
  status: 'initializing',
  startedAt: new Date().toISOString(),
  modules: {
    serviceBundle: !!ServiceBundle,
    sseManager:    !!SSEManager,
    heartbeat:     !!Heartbeat,
    serviceRegistry: !!ServiceRegistry,
    healthManager: !!HealthManager,
    recoveryEngine: !!RecoveryEngine,
    workflowOrchestrator: !!WorkflowOrchestrator,
    resourceManager: !!ResourceManager,
    stateManager: !!StateManager,
    deploymentManager: !!DeploymentManager
  },
  servicesRegistered: 0,
  subscribers: 0,
  alerts: []
};

// ── OS Layer instances ──
let registry, healthManager, recoveryEngine, workflowOrchestrator, resourceManager, stateManager, deploymentManager;

async function initOSLayer() {
  if (StateManager) {
    stateManager = new StateManager();
    await stateManager.initialize();
    console.log('   ✅ State Manager:', stateManager.memoryMode ? 'in-memory' : 'SQLite');
  }

  if (ServiceRegistry) {
    registry = new ServiceRegistry();
    registry.register('ursula', {
      name: 'Ursula Agent',
      type: 'agent',
      port: PORT,
      url: `http://localhost:${PORT}/health`,
      version: '1.0.0',
      dependencies: ['event-system'],
      capabilities: ['health_endpoint', 'sse_stream', 'intent_handler', 'service_registry', 'workflow_orchestrator', 'resource_manager', 'state_manager']
    });
    registry.startHeartbeatMonitor();
    console.log('   ✅ Service Registry: initialized');
  }

  if (HealthManager) {
    healthManager = new HealthManager();
    if (registry) healthManager.setRegistry(registry);
    healthManager.start();
    console.log('   ✅ Health Manager: monitoring started');
  }

  if (RecoveryEngine) {
    recoveryEngine = new RecoveryEngine();
    if (registry) recoveryEngine.setRegistry(registry);
    if (stateManager) {
      recoveryEngine.on('recovery_success', async (evt) => {
        await stateManager.audit('recovery_success', { target: evt.serviceId, data: evt });
        await stateManager.persistRecovery(evt.attempt);
      });
      recoveryEngine.on('recovery_failed', async (evt) => {
        await stateManager.audit('recovery_failed', { target: evt.serviceId, data: evt });
        await stateManager.persistRecovery(evt.attempt);
      });
      recoveryEngine.on('recovery_error', async (evt) => {
        await stateManager.audit('recovery_error', { target: evt.serviceId, data: evt });
        // Attempt may not exist on error, skip persist
      });
    }
    console.log('   ✅ Recovery Engine: ready');
  }

  if (WorkflowOrchestrator) {
    workflowOrchestrator = new WorkflowOrchestrator();
    if (registry) workflowOrchestrator.setRegistry(registry);

    if (stateManager) {
      // ── Auto-persist: every step and terminal state ──
      workflowOrchestrator.setStateManager(stateManager);

      // ── Auto-audit: record every transition ──
      workflowOrchestrator.on('workflow_started', async (evt) => {
        await stateManager.audit('workflow_started', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('workflow_completed', async (evt) => {
        await stateManager.audit('workflow_completed', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('workflow_failed', async (evt) => {
        await stateManager.audit('workflow_failed', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('workflow_cancelled', async (evt) => {
        await stateManager.audit('workflow_cancelled', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('step_started', async (evt) => {
        await stateManager.audit('step_started', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('step_completed', async (evt) => {
        await stateManager.audit('step_completed', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('step_failed', async (evt) => {
        await stateManager.audit('step_failed', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('approval_requested', async (evt) => {
        await stateManager.audit('approval_requested', { target: evt.workflowId, data: evt });
      });
      workflowOrchestrator.on('approval_response', async (evt) => {
        await stateManager.audit('approval_response', { target: evt.workflowId, data: evt });
      });

      // ── Auto-restore: resume active workflows from DB ──
      const activeWorkflows = await stateManager.loadActiveWorkflows();
      for (const wf of activeWorkflows) {
        workflowOrchestrator.workflows.set(wf.id, wf);
        workflowOrchestrator.activeCount++;
      }
      if (activeWorkflows.length > 0) {
        console.log(`   🔄 Restored ${activeWorkflows.length} active workflow(s) from state`);
      }
    }
    console.log('   ✅ Workflow Orchestrator: ready');
  }

  if (ResourceManager) {
    resourceManager = new ResourceManager();
    if (registry) resourceManager.setRegistry(registry);
    resourceManager.start();
    console.log('   ✅ Resource Manager: monitoring started');
  }

  if (DeploymentManager) {
    deploymentManager = new DeploymentManager();
    if (stateManager) deploymentManager.setStateManager(stateManager);
    if (registry) deploymentManager.setRegistry(registry);
    if (healthManager) deploymentManager.setHealthManager(healthManager);
    if (recoveryEngine) deploymentManager.setRecoveryEngine(recoveryEngine);
    console.log('   ✅ Deployment Manager: ready');
  }
}

// ── Routes ──

app.get('/health', (_req, res) => {
  const uptime = Date.now() - new Date(state.startedAt).getTime();
  const mem = process.memoryUsage ? process.memoryUsage() : {};

  res.json({
    agent: 'ursula',
    status: state.status,
    uptime,
    memory: mem.heapUsed ? Math.round(mem.heapUsed / 1024 / 1024) : null,
    cpu: null,
    modules: state.modules,
    port: PORT,
    hydiRoot: HYDI_ROOT
  });
});

app.get('/status', (_req, res) => {
  res.json(state);
});

// ── Unified System Status ──
app.get('/system/status', async (_req, res) => {
  const registryStatus = registry ? registry.getStatus() : null;
  const healthStatus = healthManager ? healthManager.getSystemHealth() : null;
  const recoveryStats = recoveryEngine ? recoveryEngine.getStats() : null;
  const workflowList = workflowOrchestrator ? workflowOrchestrator.listWorkflows({ includeHistory: false }) : null;
  const stateStatus = stateManager ? await stateManager.getStatus() : null;

  res.json({
    agent: 'ursula',
    status: state.status,
    uptime: Date.now() - new Date(state.startedAt).getTime(),
    osLayer: {
      registry: !!registry,
      healthManager: !!healthManager,
      recoveryEngine: !!recoveryEngine,
      workflowOrchestrator: !!workflowOrchestrator,
      resourceManager: !!resourceManager,
      stateManager: !!stateManager,
      deploymentManager: !!deploymentManager
    },
    registry: registryStatus,
    health: healthStatus,
    recovery: recoveryStats,
    workflows: workflowList,
    state: stateStatus,
    deployment: deploymentManager ? deploymentManager.getStatus() : null
  });
});

app.get('/system/health', (_req, res) => {
  if (!healthManager) {
    return res.status(503).json({ error: 'Health Manager not loaded' });
  }
  res.json(healthManager.getSystemHealth());
});

app.get('/system/registry', (_req, res) => {
  if (!registry) {
    return res.status(503).json({ error: 'Service Registry not loaded' });
  }
  res.json(registry.getStatus());
});

app.get('/system/resources', (_req, res) => {
  if (!resourceManager) {
    return res.status(503).json({ error: 'Resource Manager not loaded' });
  }
  res.json(resourceManager.getStatus());
});

app.get('/system/audit', async (_req, res) => {
  if (!stateManager) {
    return res.status(503).json({ error: 'State Manager not loaded' });
  }
  try {
    const records = await stateManager.queryAudit({ limit: 100 });
    res.json({ count: records.length, records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deployments ──
app.post('/deploy', async (req, res) => {
  if (!deploymentManager) {
    return res.status(503).json({ error: 'Deployment Manager not loaded' });
  }
  const { version, description, changes, packagePath } = req.body || {};
  if (!version) {
    return res.status(400).json({ error: 'version required' });
  }
  try {
    const result = await deploymentManager.deploy({ version, description, changes, packagePath });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/deploy/status', (_req, res) => {
  if (!deploymentManager) {
    return res.status(503).json({ error: 'Deployment Manager not loaded' });
  }
  res.json(deploymentManager.getStatus());
});

app.post('/deploy/rollback', async (_req, res) => {
  if (!deploymentManager) {
    return res.status(503).json({ error: 'Deployment Manager not loaded' });
  }
  try {
    const result = await deploymentManager.rollback();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflows ──
app.post('/workflows/start', (req, res) => {
  if (!workflowOrchestrator) {
    return res.status(503).json({ error: 'Workflow Orchestrator not loaded' });
  }
  const { definition, payload, autoApproval } = req.body || {};
  if (!definition) {
    return res.status(400).json({ error: 'definition required' });
  }
  try {
    const workflowId = workflowOrchestrator.startWorkflow(definition, payload || {}, { autoApproval });
    res.json({ workflowId, status: 'started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/workflows', (_req, res) => {
  if (!workflowOrchestrator) {
    return res.status(503).json({ error: 'Workflow Orchestrator not loaded' });
  }
  res.json(workflowOrchestrator.listWorkflows());
});

app.get('/workflows/:id', (req, res) => {
  if (!workflowOrchestrator) {
    return res.status(503).json({ error: 'Workflow Orchestrator not loaded' });
  }
  const status = workflowOrchestrator.getWorkflowStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Workflow not found' });
  res.json(status);
});

app.get('/services', (_req, res) => {
  if (ServiceBundle && ServiceBundle.services) {
    const list = Array.from(ServiceBundle.services.values()).map(s => ({
      name: s.name,
      category: s.category,
      tier: s.tier,
      description: s.description
    }));
    return res.json({ count: list.length, services: list });
  }
  res.json({ count: 0, services: [], note: 'Service bundle not loaded' });
});

// SSE stream for dashboard
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (SSEManager) {
    const clientId = SSEManager.addClient(res);
    req.on('close', () => SSEManager.removeClient(clientId));
    SSEManager.broadcast({
      type: 'client_connected',
      clientId,
      totalClients: SSEManager.getSubscriberCount()
    });
  } else {
    res.write(`data: ${JSON.stringify({ type: 'degraded', message: 'SSE Manager unavailable' })}\n\n`);
  }
});

// Simulate an intent (integration point for Heidi)
app.post('/intent', (req, res) => {
  const { input, source = 'unknown' } = req.body || {};
  if (!input || typeof input !== 'string') {
    return res.status(400).json({ error: 'input string required' });
  }

  const intent = parseIntent(input);
  state.alerts.push({ type: 'intent', input, intent, time: new Date().toISOString() });

  if (SSEManager) {
    SSEManager.broadcast({ type: 'intent_received', source, intent });
  }

  res.json({ intent, handled: true });
});

// ── Lightweight Intent Parser (fallback until TS layer is fully wired) ──
function parseIntent(input) {
  const scores = { revenue: 0, ops: 0, build: 0, analysis: 0, unknown: 0 };
  const patterns = {
    revenue: /\b(revenue|income|profit|sales|money|pricing|subscription)\b/i,
    ops:     /\b(run|start|stop|status|health|monitor|task|system)\b/i,
    build:   /\b(build|deploy|create|setup|install|release)\b/i,
    analysis:/\b(analyze|audit|check|report|metrics|review)\b/i
  };
  for (const [type, re] of Object.entries(patterns)) {
    const m = input.match(re);
    if (m) scores[type] += m.length * 0.5;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return {
    type: best[0],
    confidence: Math.min(best[1], 1.0),
    rawInput: input,
    timestamp: new Date().toISOString()
  };
}

// ── Start ──
async function start() {
  console.log('🏗️  URSULA AGENT BOOTSTRAP (Canonical)');
  console.log('   HYDI Root:', HYDI_ROOT);
  console.log('   Port:', PORT);
  console.log('');

  if (ServiceBundle) {
    try {
      const bundle = ServiceBundle.UrsulaServiceBundle
        ? new ServiceBundle.UrsulaServiceBundle()
        : ServiceBundle;
      if (bundle && bundle.services) {
        state.servicesRegistered = bundle.services.size;
        console.log('   ✅ Service Bundle:', state.servicesRegistered, 'services');
      } else {
        console.log('   ⚠️  Service Bundle loaded but no services registry found');
      }
    } catch (e) {
      console.log('   ⚠️  Service Bundle init error:', e.message);
    }
  } else {
    console.log('   ⚠️  Service Bundle: NOT LOADED');
  }

  if (SSEManager) console.log('   ✅ SSE Manager: ready');
  else            console.log('   ⚠️  SSE Manager: NOT LOADED');

  if (Heartbeat)  console.log('   ✅ Heartbeat module: present');
  else            console.log('   ⚠️  Heartbeat: NOT LOADED');

  // ── Initialize OS Layer ──
  console.log('');
  console.log('🔧 Initializing HYDI OS Layer...');
  await initOSLayer();

  server.listen(PORT, () => {
    state.status = 'running';
    console.log('');
    console.log(`🚀 Ursula Agent running on http://localhost:${PORT}`);
    console.log(`   Health:       http://localhost:${PORT}/health`);
    console.log(`   System:       http://localhost:${PORT}/system/status`);
    console.log(`   Registry:     http://localhost:${PORT}/system/registry`);
    console.log(`   Health:       http://localhost:${PORT}/system/health`);
    console.log(`   Resources:    http://localhost:${PORT}/system/resources`);
    console.log(`   Audit:        http://localhost:${PORT}/system/audit`);
    console.log(`   Deploy:       POST http://localhost:${PORT}/deploy`);
    console.log(`   DeployStatus: http://localhost:${PORT}/deploy/status`);
    console.log(`   Workflows:    http://localhost:${PORT}/workflows`);
    console.log(`   Stream:       http://localhost:${PORT}/stream`);
    console.log(`   Intent:       POST http://localhost:${PORT}/intent`);
    console.log('');
    console.log('   HYDI OS Layer: ServiceRegistry + HealthManager + RecoveryEngine + WorkflowOrchestrator + ResourceManager + StateManager + DeploymentManager');
  });
}

start().catch(err => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
