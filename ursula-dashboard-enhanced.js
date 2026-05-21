'use strict';
require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { createClient } = require('@supabase/supabase-js');

// ─── config ───────────────────────────────────────────────────────────────────
const PORT        = parseInt(process.env.DASHBOARD_PORT || '3004', 10);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const SERVICES = {
  protoforge : { label: 'ProtoForge',  url: `http://localhost:${process.env.PROTOFORGE_PORT  || 3001}/health` },
  processor  : { label: 'Processor',   url: `http://localhost:${process.env.PROCESSOR_PORT   || 3003}/health` },
  ollama     : { label: 'Ollama',      url: 'http://localhost:11434/api/tags' },
};

// ─── Supabase client ──────────────────────────────────────────────────────────
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ─── helpers ──────────────────────────────────────────────────────────────────
async function httpGet(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, status: 'timeout' }), timeoutMs);
    const req = http.get(url, (res) => {
      clearTimeout(timer);
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, body }); }
      });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 'unreachable' }); });
  });
}

// ─── data functions ────────────────────────────────────────────────────────────
async function getRecentEvents() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[ursula] events query failed:', e.message);
    return [];
  }
}

async function getStats(events) {
  const counts = { pending: 0, processing: 0, completed: 0, failed: 0, total: events.length };
  for (const e of events) {
    if (counts[e.status] !== undefined) counts[e.status]++;
  }

  // success rate & avg processing time from completed events
  const completed = events.filter(e => e.status === 'completed');
  counts.successRate = counts.total > 0
    ? ((completed.length / counts.total) * 100).toFixed(1)
    : '0.0';

  const withTime = completed.filter(e => e.created_at && e.updated_at);
  if (withTime.length > 0) {
    const totalMs = withTime.reduce((acc, e) => {
      return acc + (new Date(e.updated_at) - new Date(e.created_at));
    }, 0);
    counts.avgProcessingMs = Math.round(totalMs / withTime.length);
  } else {
    counts.avgProcessingMs = null;
  }

  return counts;
}

async function getServiceHealth() {
  const results = {};
  await Promise.all(
    Object.entries(SERVICES).map(async ([key, { label, url }]) => {
      const res = await httpGet(url);
      results[key] = {
        label,
        ok    : res.ok,
        status: res.status,
        detail: res.body,
      };
    })
  );

  // Supabase connectivity check
  if (supabase) {
    try {
      const { error } = await supabase.from('hydi_events').select('event_id').limit(1);
      results.supabase = { label: 'Supabase DB', ok: !error, status: error ? error.message : 'connected' };
    } catch (e) {
      results.supabase = { label: 'Supabase DB', ok: false, status: e.message };
    }
  } else {
    results.supabase = { label: 'Supabase DB', ok: false, status: 'no credentials' };
  }

  return results;
}

async function getProcessorMetrics() {
  const res = await httpGet(`http://localhost:${process.env.PROCESSOR_PORT || 3003}/stats`);
  if (res.ok && res.body && res.body.stats) return res.body.stats;
  return null;
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────
const sseClients = new Set();

async function buildSnapshot() {
  const events  = await getRecentEvents();
  const stats   = await getStats(events);
  const health  = await getServiceHealth();
  const procStats = await getProcessorMetrics();

  return {
    events,
    stats,
    health,
    procStats,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    port: PORT,
  };
}

let lastSnapshot = null;
let broadcasting = false;

async function broadcast() {
  if (broadcasting) return;
  broadcasting = true;
  try {
    lastSnapshot = await buildSnapshot();
    const payload = `data: ${JSON.stringify(lastSnapshot)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  } catch (e) {
    console.error('[ursula] broadcast error:', e.message);
  } finally {
    broadcasting = false;
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS — allow dashboard to be loaded from file:// or other ports during dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// SSE stream
app.get('/events/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type' : 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection'   : 'keep-alive',
  });
  res.flushHeaders?.();

  // Send whatever we have immediately
  if (lastSnapshot) {
    res.write(`data: ${JSON.stringify(lastSnapshot)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// REST APIs
app.get('/api/events', async (req, res) => {
  const events = await getRecentEvents();
  res.json(events);
});

app.get('/api/health', async (req, res) => {
  const health = await getServiceHealth();
  const allOk = Object.values(health).every(h => h.ok);
  res.status(allOk ? 200 : 207).json(health);
});

app.get('/api/stats', async (req, res) => {
  const events = await getRecentEvents();
  res.json(await getStats(events));
});

app.get('/api/export', async (req, res) => {
  const events = await getRecentEvents();
  const fmt = req.query.format || 'json';
  if (fmt === 'csv') {
    if (!events.length) return res.send('no data');
    const keys = Object.keys(events[0]);
    const rows = [keys.join(','), ...events.map(e =>
      keys.map(k => `"${String(e[k] ?? '').replace(/"/g, '""')}"`).join(',')
    )];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=hydi-events.csv');
    return res.send(rows.join('\n'));
  }
  res.json(events);
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', pid: process.pid, uptime: process.uptime(), port: PORT })
);

// Dashboard HTML
app.get('/', (req, res) => res.send(dashboardHTML()));

// 404 fallthrough
app.use((req, res) => res.status(404).json({ error: `unknown route: ${req.path}` }));

// ─── HTTP server with proper error handling ────────────────────────────────────
const server = http.createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ursula] ❌  Port ${PORT} is already in use. Set DASHBOARD_PORT to a free port.`);
  } else {
    console.error('[ursula] Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n✨  Ursula Dashboard  →  http://localhost:${PORT}`);
  console.log(`📡  SSE stream       →  http://localhost:${PORT}/events/stream`);
  console.log(`🔗  REST API         →  http://localhost:${PORT}/api/health\n`);

  // Immediately build first snapshot, then poll every 3 s
  broadcast();
  setInterval(broadcast, 3000);
});

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`\n[ursula] ${sig} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[ursula] Unhandled rejection:', reason);
});

// ─── HTML ─────────────────────────────────────────────────────────────────────
function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ursula — HYDI Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg0:#0f1117;--bg1:#1a1d27;--bg2:#22263a;--bg3:#2c3150;
  --text:#e8eaf6;--muted:#7b82a8;--border:#2e3357;
  --green:#4caf50;--yellow:#ffc107;--red:#ef5350;--blue:#5c9cf5;
  --purple:#9575cd;--cyan:#26c6da;
}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg0);color:var(--text);font-size:14px;min-height:100vh}
a{color:var(--blue);text-decoration:none}

/* header */
header{background:var(--bg1);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;z-index:100}
header h1{font-size:18px;font-weight:700;letter-spacing:0.5px}
header h1 span{color:var(--purple)}
.badge{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;background:var(--bg3);color:var(--muted);border:1px solid var(--border)}
.badge.live{background:#1a3320;color:var(--green);border-color:#2d6b3a;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.hdr-right{display:flex;align-items:center;gap:10px}
#ts{font-size:12px;color:var(--muted)}
.btn{background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;transition:.15s}
.btn:hover{border-color:var(--blue);color:var(--blue)}

/* layout */
main{padding:20px 24px;max-width:1600px;margin:0 auto;display:flex;flex-direction:column;gap:18px}

/* stat row */
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.stat-card{background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:4px}
.stat-card .num{font-size:32px;font-weight:700}
.stat-card .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.green{color:var(--green)} .yellow{color:var(--yellow)} .red{color:var(--red)} .blue{color:var(--blue)} .purple{color:var(--purple)} .cyan{color:var(--cyan)}

/* grid */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:900px){.grid2,.grid3{grid-template-columns:1fr}}

/* card */
.card{background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:12px}
.card h3{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}

/* health grid */
.health-grid{display:flex;flex-direction:column;gap:8px}
.health-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:var(--bg2)}
.health-row .svc{display:flex;align-items:center;gap:8px;font-weight:500}
.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dot.ok{background:var(--green);box-shadow:0 0 6px var(--green)}
.dot.fail{background:var(--red);box-shadow:0 0 6px var(--red)}
.dot.warn{background:var(--yellow);box-shadow:0 0 6px var(--yellow)}
.health-status{font-size:11px;color:var(--muted);text-align:right}

/* events */
.event-filters{display:flex;gap:8px;flex-wrap:wrap}
.f-btn{background:var(--bg2);border:1px solid var(--border);color:var(--muted);padding:4px 12px;border-radius:999px;cursor:pointer;font-size:12px;transition:.15s}
.f-btn:hover,.f-btn.on{background:var(--blue);border-color:var(--blue);color:#fff}
.search{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none}
.search:focus{border-color:var(--blue)}
.event-list{display:flex;flex-direction:column;gap:6px;max-height:440px;overflow-y:auto}
.event-list::-webkit-scrollbar{width:5px} .event-list::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:4px}
.ev{background:var(--bg2);border:1px solid var(--border);border-left-width:3px;border-radius:6px;padding:10px 12px;cursor:pointer;transition:.15s;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.ev:hover{background:var(--bg3);border-color:var(--blue)}
.ev.pending{border-left-color:var(--yellow)}
.ev.failed{border-left-color:var(--red)}
.ev.completed{border-left-color:var(--green)}
.ev.processing{border-left-color:var(--blue)}
.ev-type{font-weight:600;font-size:13px}
.ev-id{font-size:10px;color:var(--muted);font-family:monospace}
.ev-time{font-size:11px;color:var(--muted);white-space:nowrap}
.tag{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase}
.tag.pending{background:#332d00;color:var(--yellow)}
.tag.failed{background:#330000;color:var(--red)}
.tag.completed{background:#0d2e13;color:var(--green)}
.tag.processing{background:#0d1f3c;color:var(--blue)}

/* proc stats */
.proc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.proc-item{background:var(--bg2);border-radius:6px;padding:12px}
.proc-item .val{font-size:20px;font-weight:700;margin-bottom:2px}
.proc-item .key{font-size:11px;color:var(--muted)}

/* modal */
.modal-wrap{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;align-items:center;justify-content:center}
.modal-wrap.show{display:flex}
.modal{background:var(--bg1);border:1px solid var(--border);border-radius:12px;width:min(640px,95vw);max-height:85vh;overflow-y:auto;padding:24px;position:relative}
.modal h2{margin-bottom:16px;font-size:16px}
.modal-close{position:absolute;top:16px;right:16px;background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1}
.modal-close:hover{color:var(--text)}
.m-row{border-bottom:1px solid var(--border);padding:10px 0;display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:start}
.m-key{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;padding-top:2px}
.m-val{font-size:13px;word-break:break-all}
pre{background:var(--bg2);border-radius:6px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap}

/* empty state */
.empty{color:var(--muted);text-align:center;padding:30px;font-size:13px}
</style>
</head>
<body>

<header>
  <h1>🎯 <span>Ursula</span> — HYDI Monitor</h1>
  <div class="hdr-right">
    <span id="connBadge" class="badge">connecting…</span>
    <span id="ts" class="badge"></span>
    <button class="btn" onclick="exportData()">↓ Export</button>
  </div>
</header>

<main>

  <!-- stat row -->
  <div class="stat-row">
    <div class="stat-card"><div class="num yellow" id="sPending">—</div><div class="lbl">Pending</div></div>
    <div class="stat-card"><div class="num blue"   id="sProcessing">—</div><div class="lbl">Processing</div></div>
    <div class="stat-card"><div class="num green"  id="sCompleted">—</div><div class="lbl">Completed</div></div>
    <div class="stat-card"><div class="num red"    id="sFailed">—</div><div class="lbl">Failed</div></div>
    <div class="stat-card"><div class="num muted"  id="sTotal">—</div><div class="lbl">Total</div></div>
    <div class="stat-card"><div class="num cyan"   id="sSuccessRate">—</div><div class="lbl">Success Rate</div></div>
    <div class="stat-card"><div class="num purple" id="sAvgTime">—</div><div class="lbl">Avg Process Time</div></div>
    <div class="stat-card"><div class="num blue"   id="sUptime">—</div><div class="lbl">Dashboard Uptime</div></div>
  </div>

  <!-- health + processor stats -->
  <div class="grid2">
    <div class="card">
      <h3>Service Health</h3>
      <div class="health-grid" id="healthGrid">
        <div class="empty">Connecting…</div>
      </div>
    </div>

    <div class="card">
      <h3>Processor Stats (live from :3003)</h3>
      <div class="proc-grid" id="procStats">
        <div class="empty" style="grid-column:span 2">Waiting for processor…</div>
      </div>
    </div>
  </div>

  <!-- events -->
  <div class="card" style="gap:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3>Recent Events</h3>
      <div class="event-filters" id="statusFilters"></div>
    </div>
    <input class="search" id="search" placeholder="Filter by type, ID, source…" oninput="renderEvents()">
    <div class="event-list" id="eventList"><div class="empty">No events yet…</div></div>
  </div>

</main>

<!-- modal -->
<div class="modal-wrap" id="modalWrap" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">×</button>
    <h2>Event Detail</h2>
    <div id="modalBody"></div>
  </div>
</div>

<script>
const POLL_MS = 3000;
let allEvents = [];
let activeStatuses = new Set();
let connected = false;

// ── SSE ──────────────────────────────────────────────────────────────────────
let es;
function connectSSE() {
  es = new EventSource('/events/stream');
  es.onopen = () => {
    connected = true;
    document.getElementById('connBadge').className = 'badge live';
    document.getElementById('connBadge').textContent = '● LIVE';
  };
  es.onmessage = (e) => {
    try { applySnapshot(JSON.parse(e.data)); } catch {}
  };
  es.onerror = () => {
    connected = false;
    document.getElementById('connBadge').className = 'badge';
    document.getElementById('connBadge').textContent = 'reconnecting…';
    es.close();
    setTimeout(connectSSE, 3000);
  };
}
connectSSE();

// ── snapshot ─────────────────────────────────────────────────────────────────
function applySnapshot(snap) {
  // timestamp
  document.getElementById('ts').textContent = new Date(snap.timestamp).toLocaleTimeString();

  // stats
  const s = snap.stats || {};
  document.getElementById('sPending').textContent     = s.pending    ?? '—';
  document.getElementById('sProcessing').textContent  = s.processing ?? '—';
  document.getElementById('sCompleted').textContent   = s.completed  ?? '—';
  document.getElementById('sFailed').textContent      = s.failed     ?? '—';
  document.getElementById('sTotal').textContent       = s.total      ?? '—';
  document.getElementById('sSuccessRate').textContent = s.successRate != null ? s.successRate + '%' : '—';
  document.getElementById('sAvgTime').textContent     = s.avgProcessingMs != null ? s.avgProcessingMs + 'ms' : '—';
  document.getElementById('sUptime').textContent      = snap.uptime != null ? fmtUptime(snap.uptime) : '—';

  // health
  const hg = document.getElementById('healthGrid');
  if (snap.health && Object.keys(snap.health).length) {
    hg.innerHTML = Object.entries(snap.health).map(([, h]) => {
      const cls = h.ok ? 'ok' : 'fail';
      const detail = typeof h.status === 'object' ? JSON.stringify(h.status) : h.status;
      return \`<div class="health-row">
        <div class="svc"><div class="dot \${cls}"></div>\${h.label}</div>
        <div class="health-status">\${detail}</div>
      </div>\`;
    }).join('');
  }

  // processor stats
  const pg = document.getElementById('procStats');
  if (snap.procStats && Object.keys(snap.procStats).length) {
    const items = Object.entries(snap.procStats)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => \`<div class="proc-item"><div class="val">\${v}</div><div class="key">\${k}</div></div>\`);
    pg.innerHTML = items.length ? items.join('') : '<div class="empty" style="grid-column:span 2">No stats returned</div>';
  } else {
    pg.innerHTML = '<div class="empty" style="grid-column:span 2">Processor not reachable</div>';
  }

  // events
  allEvents = snap.events || [];
  buildStatusFilters();
  renderEvents();
}

// ── filters ───────────────────────────────────────────────────────────────────
function buildStatusFilters() {
  const statuses = [...new Set(allEvents.map(e => e.status).filter(Boolean))].sort();
  const bar = document.getElementById('statusFilters');
  // preserve active set, just re-render buttons
  bar.innerHTML = statuses.map(s => {
    const on = activeStatuses.has(s) ? 'on' : '';
    return \`<button class="f-btn \${on}" onclick="toggleStatus('\${s}',this)">\${s}</button>\`;
  }).join('');
}

function toggleStatus(s, btn) {
  activeStatuses.has(s) ? activeStatuses.delete(s) : activeStatuses.add(s);
  btn.classList.toggle('on');
  renderEvents();
}

// ── event list ────────────────────────────────────────────────────────────────
function renderEvents() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const list = document.getElementById('eventList');

  const filtered = allEvents.filter(ev => {
    if (activeStatuses.size && !activeStatuses.has(ev.status)) return false;
    if (q) {
      const hay = [ev.event_id, ev.type, ev.source, ev.status].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).slice(0, 30);

  if (!filtered.length) {
    list.innerHTML = '<div class="empty">No matching events</div>';
    return;
  }

  list.innerHTML = filtered.map(ev => \`
    <div class="ev \${ev.status || ''}" onclick="openModal('\${ev.event_id}')">
      <div>
        <div class="ev-type">\${(ev.type || 'unknown').toUpperCase()}
          <span class="tag \${ev.status}">\${ev.status}</span>
        </div>
        <div class="ev-id">\${ev.event_id}</div>
        \${ev.source ? \`<div class="ev-id" style="color:var(--muted)">from \${ev.source}</div>\` : ''}
      </div>
      <div class="ev-time">\${fmtTime(ev.created_at)}</div>
    </div>
  \`).join('');
}

// ── modal ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const ev = allEvents.find(e => e.event_id === id);
  if (!ev) return;
  const rows = [
    ['Event ID', ev.event_id],
    ['Type', ev.type],
    ['Status', ev.status],
    ['Source', ev.source || '—'],
    ['Severity', ev.severity || '—'],
    ['Retry Count', ev.retry_count ?? ev.retries ?? '—'],
    ['Created', fmtFull(ev.created_at)],
    ['Updated', fmtFull(ev.updated_at)],
    ['Payload', typeof ev.payload === 'object' ? JSON.stringify(ev.payload, null, 2) : ev.payload],
  ];
  if (ev.metadata) rows.push(['Metadata', JSON.stringify(ev.metadata, null, 2)]);
  if (ev.failure_reason) rows.push(['Failure Reason', ev.failure_reason]);

  document.getElementById('modalBody').innerHTML = rows.map(([k, v]) => {
    const isJson = v && v.startsWith('{') || (v && v.startsWith('['));
    return \`<div class="m-row">
      <div class="m-key">\${k}</div>
      <div class="m-val">\${isJson ? \`<pre>\${escHtml(v)}</pre>\` : escHtml(String(v ?? '—'))}</div>
    </div>\`;
  }).join('');
  document.getElementById('modalWrap').classList.add('show');
}

function closeModal() { document.getElementById('modalWrap').classList.remove('show'); }

// ── export ────────────────────────────────────────────────────────────────────
function exportData() { window.open('/api/export?format=json', '_blank'); }

// ── util ──────────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}
function fmtFull(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function fmtUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && h + 'h', m && m + 'm', sec + 's'].filter(Boolean).join(' ');
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
}
