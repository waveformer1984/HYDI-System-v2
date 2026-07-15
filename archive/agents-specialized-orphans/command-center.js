#!/usr/bin/env node
/**
 * HYDI COMMAND CENTER — Thin Orchestration & Aggregation Layer
 *
 * Layer: Above Operator Agent and Deployment Manager
 * Responsibilities:
 *   - Route commands to Operator or DM
 *   - Aggregate health/status from all agents
 *   - Emit unified events to Heidi Bridge
 *   - Serve a single dashboard endpoint
 *   - NO business logic, NO persistence, NO recovery
 *
 * Environment:
 *   HYDI_SYSTEM_PATH   — override path to HYDI_System root
 *   COMMAND_PORT       — agent HTTP port (default: 3009)
 *   URSULA_URL         — Ursula health endpoint (default: http://localhost:3005)
 *   OPERATOR_URL       — Operator health endpoint (default: http://localhost:3007)
 *   DEPLOYMENT_URL     — DM health endpoint (default: http://localhost:3008)
 *   HEIDI_BRIDGE_URL   — Heidi Bridge endpoint (default: http://localhost:5050)
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const http  = require('http');
const https = require('https');

// ── Resolve HYDI_System root ──
const DEFAULT_HYDI_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'HYDI_System');
const HYDI_ROOT = process.env.HYDI_SYSTEM_PATH || DEFAULT_HYDI_PATH;

// ── Express & HTTP ──
const express = require('express');

const PORT = parseInt(process.env.COMMAND_PORT || '3009', 10);
const URSULA_URL    = process.env.URSULA_URL    || 'http://localhost:3005';
const OPERATOR_URL  = process.env.OPERATOR_URL  || 'http://localhost:3007';
const DEPLOYMENT_URL= process.env.DEPLOYMENT_URL|| 'http://localhost:3008';
const HEIDI_BRIDGE  = process.env.HEIDI_BRIDGE_URL || 'http://localhost:5050';

const AGENTS = {
  ursula: { name: 'Ursula', url: URSULA_URL, endpoints: { health: '/health', status: '/status' } },
  operator: { name: 'Operator Agent', url: OPERATOR_URL, endpoints: { health: '/health', status: '/status', certify: '/certify' } },
  deployment: { name: 'Deployment Manager', url: DEPLOYMENT_URL, endpoints: { health: '/health', status: '/status', deploy: '/deploy', pipeline: '/pipeline/deploy' } }
};

const app = express();
const server = require('http').createServer(app);
app.use(express.json());

// ── State ──
const state = {
  status: 'initializing',
  startedAt: new Date().toISOString(),
  aggregate: {},
  lastPoll: null,
  pollIntervalMs: 30000,
  pollTimer: null,
  alerts: []
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

async function httpPost(url, body, timeout = 30000) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout
    };
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.on('error', () => resolve({ statusCode: 0, body: null }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, body: null }); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Aggregation ──
async function pollAgents() {
  const results = {};
  for (const [key, agent] of Object.entries(AGENTS)) {
    try {
      const health = await httpGet(`${agent.url}${agent.endpoints.health}`);
      results[key] = { name: agent.name, url: agent.url, health: health.statusCode === 200 ? health.body : null, reachable: health.statusCode === 200 };
    } catch (e) {
      results[key] = { name: agent.name, url: agent.url, health: null, reachable: false, error: e.message };
    }
  }
  state.aggregate = results;
  state.lastPoll = new Date().toISOString();

  const down = Object.entries(results).filter(([_, r]) => !r.reachable).map(([k, r]) => r.name);
  if (down.length > 0) {
    const alert = { type: 'agents_down', agents: down, time: state.lastPoll };
    state.alerts.push(alert);
    if (state.alerts.length > 100) state.alerts.shift();
    console.warn(`[COMMAND CENTER] Agents unreachable: ${down.join(', ')}`);
  }
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    pollAgents().catch(err => console.error('[COMMAND CENTER] Poll error:', err.message));
  }, state.pollIntervalMs);
  console.log(`[COMMAND CENTER] Started polling agents every ${state.pollIntervalMs}ms`);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ── Routes ──

app.get('/health', (_req, res) => {
  res.json({ agent: 'command-center', status: state.status, uptime: Date.now() - new Date(state.startedAt).getTime(), port: PORT, hydiRoot: HYDI_ROOT, lastPoll: state.lastPoll });
});

app.get('/status', (_req, res) => {
  res.json({
    status: state.status,
    startedAt: state.startedAt,
    aggregate: state.aggregate,
    lastPoll: state.lastPoll,
    pollIntervalMs: state.pollIntervalMs,
    pollTimer: state.pollTimer ? 'active' : null,
    alerts: state.alerts.slice(-20)
  });
});

// Unified dashboard
app.get('/dashboard', async (_req, res) => {
  await pollAgents();
  const agents = Object.entries(state.aggregate).map(([key, data]) => ({
    key,
    name: data.name,
    reachable: data.reachable,
    status: data.health ? (data.health.status || 'unknown') : 'unreachable',
    uptime: data.health ? data.health.uptime : null,
    version: data.health ? (data.health.version || data.health.currentVersion || null) : null
  }));
  const overall = agents.every(a => a.reachable) ? 'healthy' : agents.some(a => a.reachable) ? 'degraded' : 'down';
  res.json({
    overall,
    timestamp: new Date().toISOString(),
    agents,
    alerts: state.alerts.slice(-10)
  });
});

// Route: certify → Operator Agent
app.post('/command/certify', async (_req, res) => {
  const result = await httpPost(`${OPERATOR_URL}/certify`, {});
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Operator certification failed: HTTP ${result.statusCode}`);
});

// Route: deploy → Deployment Manager
app.post('/command/deploy', async (req, res) => {
  const body = req.body || {};
  if (!body.version) return fail(res, 400, 'version is required');
  const result = await httpPost(`${DEPLOYMENT_URL}/deploy`, body);
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Deploy failed: HTTP ${result.statusCode}`);
});

// Route: pipeline deploy → Deployment Manager
app.post('/command/pipeline', async (req, res) => {
  const body = req.body || {};
  if (!body.version) return fail(res, 400, 'version is required');
  const result = await httpPost(`${DEPLOYMENT_URL}/pipeline/deploy`, body);
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Pipeline failed: HTTP ${result.statusCode}`);
});

// Route: chaos test → Operator Agent
app.post('/command/chaos', async (req, res) => {
  const result = await httpPost(`${OPERATOR_URL}/test/chaos`, req.body || {});
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Chaos test failed: HTTP ${result.statusCode}`);
});

// Route: workflow test → Operator Agent
app.post('/command/test-workflow', async (_req, res) => {
  const result = await httpPost(`${OPERATOR_URL}/test/workflow`, {});
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Workflow test failed: HTTP ${result.statusCode}`);
});

// Route: rollback → Deployment Manager
app.post('/command/rollback', async (_req, res) => {
  const result = await httpPost(`${DEPLOYMENT_URL}/rollback`, {});
  if (result.statusCode === 200) ok(res, result.body);
  else fail(res, 502, `Rollback failed: HTTP ${result.statusCode}`);
});

// Route: notify Heidi Bridge
app.post('/notify', async (req, res) => {
  const body = req.body || {};
  if (!body.event) return fail(res, 400, 'event is required');
  try {
    const result = await httpPost(`${HEIDI_BRIDGE}/api/forge/webhook`, { type: 'command_center', ...body });
    ok(res, { delivered: result.statusCode === 200, bridgeStatus: result.statusCode });
  } catch (e) {
    fail(res, 502, `Heidi Bridge unreachable: ${e.message}`);
  }
});

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ status: 'error', error: 'Endpoint not found', agents: Object.keys(AGENTS) });
});

// ── Start ──
async function start() {
  console.log('🎯  HYDI COMMAND CENTER');
  console.log('   HYDI Root:', HYDI_ROOT);
  console.log('   Port:', PORT);
  console.log('');

  await pollAgents();
  console.log('   Initial poll complete');
  Object.entries(state.aggregate).forEach(([key, data]) => {
    console.log(`   ${data.reachable ? '✅' : '❌'} ${data.name} at ${data.url}`);
  });
  console.log('');

  startPolling();

  server.listen(PORT, () => {
    state.status = 'running';
    console.log(`🌐 Command Center running on http://localhost:${PORT}`);
    console.log(`   Health:     http://localhost:${PORT}/health`);
    console.log(`   Status:     http://localhost:${PORT}/status`);
    console.log(`   Dashboard:  http://localhost:${PORT}/dashboard`);
    console.log(`   Certify:    POST http://localhost:${PORT}/command/certify`);
    console.log(`   Deploy:     POST http://localhost:${PORT}/command/deploy`);
    console.log(`   Pipeline:   POST http://localhost:${PORT}/command/pipeline`);
    console.log(`   Rollback:   POST http://localhost:${PORT}/command/rollback`);
    console.log(`   Chaos:      POST http://localhost:${PORT}/command/chaos`);
    console.log('');
    console.log('   To wire into HYDI_System, set HYDI_SYSTEM_PATH env var.');
    console.log('   To point at agents, set URSULA_URL, OPERATOR_URL, DEPLOYMENT_URL env vars.');
  });
}

start().catch(err => { console.error('❌ Fatal startup error:', err); process.exit(1); });
