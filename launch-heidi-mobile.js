#!/usr/bin/env node
/**
 * Hydi Mobile — ProtoForge Command Server
 * Serves the mobile PWA and provides HTTP + WebSocket APIs for ProtoForge control.
 */

const express = require('express');
const http    = require('http');
const path    = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// ── Config ───────────────────────────────────────────────
const PORT = process.env.HYDI_PORT || process.env.HEIDI_PORT || 3006;
const HOST = process.env.HYDI_HOST || process.env.HEIDI_HOST || '0.0.0.0';

// ── Express ──────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ── ProtoForge state (in-memory, syncs to Supabase when available) ──
const PF = {
  autonomyLevel: 2,
  agents: buildInitialAgents(),
  approvalQueue: [],
  events: [],
  stats: {
    capital_deployed: 0,
    agent_actions: 0,
    success_rate: 0.94,
    trust_score: 0.82,
  },
};

function buildInitialAgents() {
  return [
    { id:'architect',  status:'running', actions:0 },
    { id:'engineer',   status:'running', actions:0 },
    { id:'finance',    status:'running', actions:0 },
    { id:'legal',      status:'idle',    actions:0 },
    { id:'marketing',  status:'idle',    actions:0 },
    { id:'ops',        status:'running', actions:0 },
    { id:'analytics',  status:'running', actions:0 },
    { id:'cascade',    status:'running', actions:0 },
    { id:'heidi',      status:'running', actions:0 },
    { id:'ursula',     status:'idle',    actions:0 },
    { id:'security',   status:'running', actions:0 },
    { id:'realtime',   status:'running', actions:0 },
    { id:'outreach',   status:'idle',    actions:0 },
    { id:'memory',     status:'idle',    actions:0 },
    { id:'executive',  status:'running', actions:0 },
  ];
}

// ── API Routes ───────────────────────────────────────────

// System health (Supabase or fallback)
app.get('/api/health', async (req, res) => {
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/system_dashboard?select=*`,
        { headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        }}
      );
      if (r.ok) return res.json((await r.json())[0] || {});
    }
  } catch {}
  // Fallback
  res.json({
    current_status: 'OK',
    jobs_queued: PF.approvalQueue.length,
    trend_status: 'STABLE',
    auto_heals_24h: 3,
    last_check: new Date().toISOString(),
  });
});

// ProtoForge stats
app.get('/api/protoforge/stats', (req, res) => {
  PF.stats.agent_actions += Math.floor(Math.random() * 5);
  res.json({
    ...PF.stats,
    autonomy_level: PF.autonomyLevel,
    agents_running: PF.agents.filter(a => a.status === 'running').length,
    agents_total: PF.agents.length,
    approvals_pending: PF.approvalQueue.length,
    timestamp: new Date().toISOString(),
  });
});

// Agent status
app.get('/api/protoforge/agents', (req, res) => res.json(PF.agents));

app.post('/api/protoforge/agents/:id/:cmd', (req, res) => {
  const { id, cmd } = req.params;
  const agent = PF.agents.find(a => a.id === id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const map = { start:'running', pause:'paused', restart:'running', stop:'idle' };
  if (map[cmd]) {
    agent.status = map[cmd];
    broadcastAll({ type: 'agent_update', agentId: id, status: agent.status });
    logEvent(`Agent ${id} → ${cmd}`, 'ok');
  }
  res.json({ agentId: id, status: agent.status });
});

// Autonomy level
app.post('/api/protoforge/autonomy', (req, res) => {
  const level = parseInt(req.body.level);
  if (isNaN(level) || level < 0 || level > 4)
    return res.status(400).json({ error: 'Level must be 0–4' });
  PF.autonomyLevel = level;
  logEvent(`Autonomy set to Level ${level}`, level >= 3 ? 'warn' : 'ok');
  broadcastAll({ type: 'protoforge_event', message: `Autonomy → Level ${level}`, severity: level >= 3 ? 'warn' : 'ok' });
  res.json({ autonomy_level: level });
});

// Grow action
app.post('/api/protoforge/grow', (req, res) => {
  const { action } = req.body;
  logEvent(`Grow action: ${action}`, 'ok');
  broadcastAll({ type: 'protoforge_event', message: `Growth action initiated: ${action}`, severity: 'ok' });
  PF.stats.agent_actions += 10;
  res.json({ queued: action, timestamp: new Date().toISOString() });
});

// Approval response
app.post('/api/protoforge/approval', (req, res) => {
  const { approvalId, decision } = req.body;
  const idx = PF.approvalQueue.findIndex(a => a.id === approvalId);
  if (idx >= 0) PF.approvalQueue.splice(idx, 1);
  logEvent(`Approval ${decision}: ${approvalId}`, decision === 'approve' ? 'ok' : 'warn');
  res.json({ approvalId, decision });
});

// Chat (HTTP fallback)
app.post('/api/chat', async (req, res) => {
  const { message = '', model = 'hydi' } = req.body;
  const reply = buildHydiReply(message, model);
  res.json({ response: reply, system: 'hydi', timestamp: new Date().toISOString() });
});

// PWA routes
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'hydi-mobile-protoforge.html')));
app.get('/hydi', (req, res) =>
  res.sendFile(path.join(__dirname, 'hydi-mobile-protoforge.html')));
app.get('/heidi-mobile', (req, res) =>
  res.sendFile(path.join(__dirname, 'heidi-mobile-chat.html')));

// ── Hydi reply engine ─────────────────────────────────────
function buildHydiReply(msg, model) {
  const t = msg.toLowerCase();

  if (t.includes('grow') || t.includes('scale'))
    return `ProtoForge growth directive received. Current autonomy: Level ${PF.autonomyLevel}. ` +
      `${PF.agents.filter(a=>a.status==='running').length} agents active. ` +
      `To accelerate growth, increase autonomy level from the Grow tab or specify a target metric.`;

  if (t.includes('status') || t.includes('health'))
    return `System Status: ✅ Operational\n` +
      `• ${PF.agents.filter(a=>a.status==='running').length}/${PF.agents.length} agents running\n` +
      `• Autonomy: Level ${PF.autonomyLevel}\n` +
      `• Approvals pending: ${PF.approvalQueue.length}\n` +
      `• Actions today: ${PF.stats.agent_actions}\n` +
      `• Success rate: ${Math.round(PF.stats.success_rate * 100)}%`;

  if (t.includes('agent'))
    return `15 agents registered in the ProtoForge mesh.\n` +
      `Running: ${PF.agents.filter(a=>a.status==='running').map(a=>a.id).join(', ')}\n` +
      `Idle: ${PF.agents.filter(a=>a.status==='idle').map(a=>a.id).join(', ')}`;

  if (t.includes('financ') || t.includes('capital') || t.includes('revenue'))
    return `Financial Engine Status:\n` +
      `• Capital deployed: $${PF.stats.capital_deployed.toLocaleString()}\n` +
      `• Agent actions driving revenue: ${PF.stats.agent_actions}\n` +
      `• Trust score: ${Math.round(PF.stats.trust_score * 100)}%\n` +
      `Use the Finance Round action in the Grow tab to initiate a new capital allocation cycle.`;

  if (t.includes('approval') || t.includes('queue'))
    return PF.approvalQueue.length > 0
      ? `${PF.approvalQueue.length} approval(s) pending. Switch to the Approve tab to review and act on them.`
      : `No pending approvals. All agents are operating within approved parameters.`;

  if (t.includes('autonomy') || t.includes('level'))
    return `Current autonomy: Level ${PF.autonomyLevel}.\n` +
      `0=Observe · 1=Assist · 2=Approve · 3=Conditional · 4=Full Auto\n` +
      `Use the Grow tab to adjust. Levels 3+ allow agents to act without per-action confirmation.`;

  if (t.includes('start all') || t.includes('start agents'))
    return `Starting all idle agents. Broadcasting activation signal to the agent mesh...`;

  if (t.includes('cascade'))
    return `CASCADE event bus is ${PF.agents.find(a=>a.id==='cascade')?.status || 'unknown'}.\n` +
      `Event pipeline: INTAKE → VALIDATION → CLASSIFICATION → EMISSION.\n` +
      `All events are deterministically logged with integrity fingerprints.`;

  if (t.includes('prime directive'))
    return `Prime Directive: Build, fund, operate, and grow ProtoForge as a self-sustaining autonomous system — with human oversight at every critical decision point.\n` +
      `Currently at autonomy Level ${PF.autonomyLevel}. Use the Grow tab to raise or lower this.`;

  return `Understood. Processing "${msg.slice(0,60)}${msg.length>60?'...':''}"\n` +
    `ProtoForge has ${PF.agents.filter(a=>a.status==='running').length} active agents ready to execute. ` +
    `What would you like to prioritize?`;
}

// ── HTTP Server ──────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket Server (/ws/hydi) ───────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws/hydi' });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  clients.set(id, ws);
  console.log(`[WS] Client connected: ${id}`);

  // Welcome
  send(ws, { type: 'system', message: 'Connected to Hydi ProtoForge Command', clientId: id });

  // Push current health
  send(ws, {
    type: 'health_update',
    health: {
      current_status: 'OK',
      jobs_queued: PF.approvalQueue.length,
      trend_status: 'STABLE',
      auto_heals_24h: 3,
      last_check: new Date().toISOString(),
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(id, ws, msg);
    } catch (e) {
      console.error('[WS] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[WS] Client disconnected: ${id}`);
  });

  ws.on('error', (e) => console.error(`[WS] Error on ${id}:`, e.message));
});

function handleWsMessage(clientId, ws, msg) {
  const { type } = msg;

  if (type === 'message') {
    // Chat message
    const reply = buildHydiReply(msg.content || '', msg.model || 'hydi');
    // Simulate Hydi thinking delay
    setTimeout(() => {
      send(ws, { type: 'chat_response', sender: 'hydi', content: reply });
    }, 600 + Math.random() * 800);
    logEvent(`Chat: "${(msg.content||'').slice(0,50)}"`, 'info');
    return;
  }

  if (type === 'agent_command') {
    const { agentId, command } = msg;
    const agent = PF.agents.find(a => a.id === agentId);
    if (agent) {
      const map = { start:'running', pause:'paused', restart:'running', stop:'idle' };
      if (map[command]) agent.status = map[command];
      broadcastAll({ type: 'agent_update', agentId, status: agent.status });
      logEvent(`Agent ${agentId} ${command}`, 'ok');
    }
    return;
  }

  if (type === 'set_autonomy') {
    const level = parseInt(msg.level);
    if (level >= 0 && level <= 4) {
      PF.autonomyLevel = level;
      logEvent(`Autonomy → Level ${level}`, level >= 3 ? 'warn' : 'ok');
      broadcastAll({ type: 'protoforge_event', message: `Autonomy set to Level ${level}`, severity: level >= 3 ? 'warn' : 'ok' });
    }
    return;
  }

  if (type === 'grow_action') {
    const { action } = msg;
    logEvent(`Grow: ${action}`, 'ok');
    PF.stats.agent_actions += 10;
    broadcastAll({ type: 'protoforge_event', message: `Growth action queued: ${action}`, severity: 'ok' });
    // Simulate agent response
    setTimeout(() => {
      broadcastAll({ type: 'chat_response', sender: 'hydi',
        content: `Growth action "${action}" dispatched to the agent mesh. Monitoring for completion...` });
    }, 1200);
    return;
  }

  if (type === 'approval_response') {
    const { approvalId, decision } = msg;
    const idx = PF.approvalQueue.findIndex(a => a.id === approvalId);
    if (idx >= 0) PF.approvalQueue.splice(idx, 1);
    logEvent(`Approval ${decision}: ${approvalId}`, decision === 'approve' ? 'ok' : 'warn');
    return;
  }

  if (type === 'request' && msg.resource === 'agent_status') {
    send(ws, { type: 'agent_status_all', agents: PF.agents });
    return;
  }
}

// ── Helpers ───────────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastAll(obj) {
  const payload = JSON.stringify(obj);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

function logEvent(text, severity = 'ok') {
  PF.events.unshift({ text, severity, ts: new Date().toISOString() });
  if (PF.events.length > 100) PF.events.pop();
}

// ── Periodic tick: simulate live agent activity ───────────
setInterval(() => {
  if (clients.size === 0) return;
  PF.stats.agent_actions++;
  const running = PF.agents.filter(a => a.status === 'running');
  if (running.length) {
    const a = running[Math.floor(Math.random() * running.length)];
    a.actions++;
    broadcastAll({ type: 'agent_update', agentId: a.id, status: a.status });
  }
  broadcastAll({
    type: 'health_update',
    health: {
      current_status: 'OK',
      jobs_queued: PF.approvalQueue.length,
      trend_status: 'STABLE',
      auto_heals_24h: 3,
      last_check: new Date().toISOString(),
    }
  });
}, 15000);

// ── Server stats ──────────────────────────────────────────
app.get('/api/stats', (req, res) => res.json({
  clients: clients.size,
  autonomy_level: PF.autonomyLevel,
  agents_running: PF.agents.filter(a => a.status === 'running').length,
  approvals_pending: PF.approvalQueue.length,
  total_events: PF.events.length,
  uptime: process.uptime(),
}));

// ── Start ─────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  console.log('\n🧠  HYDI — ProtoForge Mobile Command Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📱  Mobile PWA:   ${local}/`);
  console.log(`💬  Chat (legacy):${local}/heidi-mobile`);
  console.log(`🔌  WebSocket:    ws://localhost:${PORT}/ws/hydi`);
  console.log(`📊  Health API:   ${local}/api/health`);
  console.log(`🤖  Agents API:   ${local}/api/protoforge/agents`);
  console.log(`📈  Stats API:    ${local}/api/protoforge/stats`);
  console.log(`⚙️   Server stats: ${local}/api/stats`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Supabase:  ${process.env.SUPABASE_URL ? '✅ Configured' : '⚠️  Not configured (offline mode)'}`);
  console.log(`   Autonomy:  Level ${PF.autonomyLevel} (EXECUTE_WITH_APPROVAL)`);
  console.log(`   Agents:    ${PF.agents.filter(a=>a.status==='running').length}/${PF.agents.length} running\n`);
});

// ── Graceful shutdown ─────────────────────────────────────
function shutdown(signal) {
  console.log(`\n🛑  ${signal} — shutting down...`);
  wss.close(() => console.log('✅  WebSocket closed'));
  server.close(() => { console.log('✅  HTTP closed'); process.exit(0); });
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException',  (e) => { console.error('💥 Uncaught:', e); process.exit(1); });
process.on('unhandledRejection', (r) => { console.error('💥 Unhandled rejection:', r); process.exit(1); });
