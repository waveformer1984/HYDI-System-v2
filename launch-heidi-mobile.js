#!/usr/bin/env node
/**
 * Hydi Mobile — ProtoForge Command Server
 * Serves the mobile PWA and provides HTTP + WebSocket APIs for ProtoForge control.
 * Uses Ollama for AI replies when available; falls back to scripted responses.
 */

const express = require('express');
const http    = require('http');
const path    = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// ── Ollama integration ────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const PREFERRED_MODELS = [
  'llama3.2','llama3.1','llama3','llama2',
  'mistral','mixtral','phi3','phi4',
  'gemma3','gemma2','gemma',
  'qwen2.5','qwen2','deepseek-r1',
];

let ollamaModel  = null;
const chatHistories = new Map(); // sessionId -> [{role,content}]
const MAX_HISTORY = 20;

async function detectOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const data = await r.json();
    const models = (data.models || []).map(m => m.name);
    if (!models.length) return null;
    for (const pref of PREFERRED_MODELS) {
      const hit = models.find(m => m.toLowerCase().includes(pref));
      if (hit) { ollamaModel = hit; return hit; }
    }
    ollamaModel = models[0];
    return ollamaModel;
  } catch { return null; }
}

async function ollamaChat(messages) {
  if (!ollamaModel) return null;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        stream: false,
        options: { temperature: 0.7, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.message?.content?.trim() || null;
  } catch { return null; }
}

function buildSystemPrompt() {
  const running = PF.agents.filter(a => a.status === 'running').length;
  const idle    = PF.agents.filter(a => a.status === 'idle').length;
  const level   = PF.autonomyLevel;
  const levelNames = {
    0:'OBSERVE', 1:'ASSIST', 2:'EXECUTE WITH APPROVAL',
    3:'CONDITIONAL AUTONOMY', 4:'FULL AUTONOMY',
  };
  return (
    'You are Hydi, the AI brain and contextual conscience of ProtoForge — ' +
    'a 15-agent autonomous orchestration system designed to build, fund, and grow ' +
    'a rotating cyberpunk container skyscraper project.\n\n' +
    'Your personality: calm, precise, proactive, slightly futuristic. ' +
    'Keep responses concise (3-8 lines) — the user is on mobile.\n\n' +
    `Current system state:\n` +
    `  Autonomy level: ${level} — ${levelNames[level]}\n` +
    `  Agents: ${running} running, ${idle} idle (15 total)\n` +
    `  Capital deployed: $${PF.stats.capital_deployed.toLocaleString()}\n` +
    `  Approvals pending: ${PF.approvalQueue.length}\n` +
    `  Success rate: ${Math.round(PF.stats.success_rate * 100)}%\n\n` +
    'When the user asks you to take an action, confirm what you\'re doing and ' +
    'briefly describe the effect. Always stay in character as Hydi.'
  );
}

async function hydiReply(msg, sessionId = 'default') {
  // Handle state-mutating commands first
  const scripted = handleCommand(msg);

  if (ollamaModel) {
    const history = chatHistories.get(sessionId) || [];
    history.push({ role: 'user', content: msg });

    const messages = [{ role: 'system', content: buildSystemPrompt() }, ...history.slice(-MAX_HISTORY)];

    if (scripted) {
      messages.push({
        role: 'system',
        content: `[System executed command. Result: ${scripted}. Acknowledge naturally in 1-2 sentences.]`,
      });
    }

    const ai = await ollamaChat(messages);
    if (ai) {
      history.push({ role: 'assistant', content: ai });
      if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY);
      chatHistories.set(sessionId, history);
      return ai;
    }
  }

  return scripted || buildScriptedReply(msg);
}

function handleCommand(msg) {
  const t = msg.toLowerCase().trim();

  if (t.includes('start all') || t.includes('start agents') || t.includes('grow agents')) {
    const started = PF.agents.filter(a => a.status === 'idle').map(a => a.id);
    started.forEach(id => { const a = PF.agents.find(x => x.id === id); if (a) a.status = 'running'; });
    PF.stats.agent_actions += started.length;
    return started.length
      ? `Started ${started.length} agents: ${started.join(', ')}. All 15 now running.`
      : 'All agents were already running.';
  }

  if (t.includes('grow finance') || t.includes('finance round')) {
    PF.stats.capital_deployed += 10000;
    PF.stats.agent_actions += 5;
    return `Capital allocation round complete. Deployed: $${PF.stats.capital_deployed.toLocaleString()}.`;
  }

  if (t.includes('grow autonomy') || (t.includes('autonomy') && /raise|increase|up|higher/.test(t))) {
    if (PF.autonomyLevel < 4) PF.autonomyLevel++;
    const names = {0:'OBSERVE',1:'ASSIST',2:'EXECUTE WITH APPROVAL',3:'CONDITIONAL AUTONOMY',4:'FULL AUTONOMY'};
    return `Autonomy raised to Level ${PF.autonomyLevel}: ${names[PF.autonomyLevel]}.`;
  }

  if (t.includes('grow evolution') || t.includes('evolution cycle')) {
    PF.stats.agent_actions += 20;
    return 'CASCADE evolution protocol running. Agent policies optimising across all 15 nodes.';
  }

  const setMatch = t.match(/^set autonomy (\d)$/);
  if (setMatch) {
    const lvl = parseInt(setMatch[1]);
    if (lvl >= 0 && lvl <= 4) {
      PF.autonomyLevel = lvl;
      const names = {0:'OBSERVE',1:'ASSIST',2:'EXECUTE WITH APPROVAL',3:'CONDITIONAL AUTONOMY',4:'FULL AUTONOMY'};
      return `Autonomy set to Level ${lvl}: ${names[lvl]}.`;
    }
  }

  return null; // not a state-mutating command
}

function buildScriptedReply(msg) {
  const t = msg.toLowerCase();
  const running = PF.agents.filter(a => a.status === 'running');

  if (/status|health|how are/.test(t))
    return `System: OPERATIONAL\nAgents: ${running.length}/15 running\nAutonomy: Level ${PF.autonomyLevel}\nCapital: $${PF.stats.capital_deployed.toLocaleString()}\nApprovals pending: ${PF.approvalQueue.length}`;

  if (/grow|scale|expand/.test(t))
    return 'Growth options:\n  start all agents\n  grow finance\n  grow autonomy\n  grow evolution';

  if (t.includes('agent'))
    return `Running (${running.length}): ${running.map(a=>a.id).join(', ')}\nIdle: ${PF.agents.filter(a=>a.status==='idle').map(a=>a.id).join(', ')}`;

  if (/financ|capital|revenue/.test(t))
    return `Capital deployed: $${PF.stats.capital_deployed.toLocaleString()}\nActions: ${PF.stats.agent_actions}  Success: ${Math.round(PF.stats.success_rate*100)}%`;

  if (/approval|queue|pending/.test(t))
    return PF.approvalQueue.length
      ? `${PF.approvalQueue.length} approvals pending. Check the Approve tab.`
      : 'No pending approvals. All agents within authorised parameters.';

  return `Processing: "${msg.slice(0,60)}"\n${running.length} agents ready.\n(Tip: install Ollama for AI replies — ollama.com)`;
}

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

// Active model info
app.get('/api/models', (req, res) => {
  res.json({
    ollama_url:    OLLAMA_URL,
    active_model:  ollamaModel,
    ollama_online: ollamaModel !== null,
    mode:          ollamaModel ? 'ai' : 'scripted',
  });
});

// Reload / re-detect Ollama
app.post('/api/ollama/reload', async (req, res) => {
  const model = await detectOllama();
  res.json({ active_model: model, ollama_online: model !== null });
});

// Chat (HTTP fallback + Ollama)
app.post('/api/chat', async (req, res) => {
  const { message = '' } = req.body;
  const sessionId = req.headers['x-session-id'] || 'default';
  const reply = await hydiReply(message, sessionId);
  logEvent(`Chat: ${message.slice(0, 50)}`, 'info');
  res.json({ response: reply, system: 'hydi', model: ollamaModel || 'scripted', timestamp: new Date().toISOString() });
});

// PWA routes
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'hydi-mobile-protoforge.html')));
app.get('/hydi', (req, res) =>
  res.sendFile(path.join(__dirname, 'hydi-mobile-protoforge.html')));
app.get('/heidi-mobile', (req, res) =>
  res.sendFile(path.join(__dirname, 'heidi-mobile-chat.html')));


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
    const sessionId = msg.sessionId || clientId;
    hydiReply(msg.content || '', sessionId).then(reply => {
      send(ws, { type: 'chat_response', sender: 'hydi', content: reply, model: ollamaModel || 'scripted' });
    });
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
async function startServer() {
  // Detect Ollama before accepting connections
  process.stdout.write('Checking Ollama... ');
  const model = await detectOllama();
  console.log(model ? `✅ ${model}` : 'not found (scripted mode)');

  server.listen(PORT, HOST, () => {
    const local = `http://localhost:${PORT}`;
    console.log('\n🧠  HYDI — ProtoForge Mobile Command Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📱  Mobile PWA:   ${local}/`);
    console.log(`🔌  WebSocket:    ws://localhost:${PORT}/ws/hydi`);
    console.log(`🤖  Models API:   ${local}/api/models`);
    console.log(`📊  Stats API:    ${local}/api/protoforge/stats`);
    console.log(`⚙️   Server stats: ${local}/api/stats`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (model) {
      console.log(`   AI model:  ✅ ${model}`);
    } else {
      console.log('   AI model:  📝 Scripted (install Ollama for AI replies)');
      console.log('              → https://ollama.com  then: ollama pull llama3.2');
    }
    console.log(`   Supabase:  ${process.env.SUPABASE_URL ? '✅ Configured' : '⚠️  Not configured'}`);
    console.log(`   Autonomy:  Level ${PF.autonomyLevel}`);
    console.log(`   Agents:    ${PF.agents.filter(a=>a.status==='running').length}/${PF.agents.length} running\n`);
  });
}

startServer();

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
