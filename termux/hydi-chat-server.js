#!/usr/bin/env node
/**
 * HYDI Chat Server for Termux — zero-dependency, phone-local.
 *
 * Serves the mobile chat UI and implements the chat API directly against
 * Supabase's REST interface (PostgREST) using only Node's built-in fetch.
 * No npm install, no Vercel, no GitHub — just `node hydi-chat-server.js`.
 *
 * Env:
 *   SUPABASE_URL               required for live data (else canned replies)
 *   SUPABASE_SERVICE_ROLE_KEY  required for live data
 *   HYDI_SERVICE_SECRET        optional — if set, /api/chat requires the
 *                              HMAC token (same scheme as production);
 *                              if unset, only local requests are accepted
 *   PORT                       default 8787
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHmac, timingSafeEqual } = require('crypto');

const PORT = parseInt(process.env.PORT || '8787', 10);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SERVICE_SECRET = process.env.HYDI_SERVICE_SECRET || '';
const TOKEN_WINDOW_MS = 5 * 60 * 1000;

// ── Supabase REST helpers (PostgREST over fetch) ─────────────────────────────

function sbConfigured() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }

async function sbGet(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function sbRpc(fn, args = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function getDashboard() {
  const rows = await sbGet('system_dashboard?select=*&limit=1');
  return rows[0] || null;
}

async function countRows(table, filter = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${filter}&limit=1`, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
    },
    signal: AbortSignal.timeout(10000),
  });
  const range = r.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

// ── Service token (same scheme as api/chat/route.js) ─────────────────────────

function checkServiceToken(token) {
  if (!SERVICE_SECRET) return { valid: true, service: 'local' };
  if (!token) return { valid: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 4) return { valid: false, reason: 'malformed token' };
  const [ts, requestId, service, sig] = parts;
  const timestamp = parseInt(ts, 10);
  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > TOKEN_WINDOW_MS) {
    return { valid: false, reason: 'token expired or clock skew exceeds 5 minutes' };
  }
  const payload = `${ts}:${requestId}:${service}`;
  const expected = createHmac('sha256', SERVICE_SECRET).update(payload).digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'signature mismatch' };
    }
  } catch (_) {
    return { valid: false, reason: 'invalid signature encoding' };
  }
  return { valid: true, service, requestId };
}

// ── System handlers (ported from api/chat/route.js, PostgREST edition) ───────

const NO_DB = '⚠️ Supabase not configured on this node — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then restart. Answering in offline mode.';

const EMOJI = {
  OK: '✅', WARNING: '🟡', CRITICAL: '🔴', UNKNOWN: '❓',
  stable: '📈', degrading: '📉', critical_trend: '🚨', unknown: '❓',
};

async function handleUrsula(message) {
  const m = message.toLowerCase();
  if (m.includes('status')) {
    if (!sbConfigured()) return `❓ Ursula: ${NO_DB}`;
    try {
      const dash = await getDashboard();
      if (!dash) return '❓ Ursula: system_dashboard view returned no data.';
      let out = `${EMOJI[dash.current_status] || '❓'} HYDI Status: ${dash.current_status}\n`;
      out += `${EMOJI[dash.trend_status] || ''} Trend: ${dash.trend_status} — ${dash.trend_reason}\n`;
      if (dash.escalation_level !== 'OK') {
        out += `⚠️ Escalation: ${dash.escalation_action} — ${dash.escalation_reason}\n`;
      }
      out += `📊 Queue: ${dash.jobs_queued} queued | ${dash.jobs_failed} failed | ${dash.events_last_hour} events/hr`;
      return out;
    } catch (err) {
      return `❓ Ursula: unable to check status — ${err.message}`;
    }
  }
  return `📡 Ursula: system monitor (Termux node). Try 'status'.`;
}

async function handleHeidi(message) {
  return `🧠 Heidi (Termux node): task received — "${message}". Full orchestration runs on the main deployment; this node covers status and monitoring.`;
}

async function handleCascade(message) {
  const m = message.toLowerCase();
  if (!sbConfigured()) return `⚡ CASCADE: ${NO_DB}`;
  try {
    if (m.includes('status')) {
      const queued = await countRows('cascade_events', '&status=eq.queued');
      const dead = await countRows('dead_letters');
      return `⚡ CASCADE: Queue: ${queued} | Dead letters: ${dead}`;
    }
    if (m.includes('quarantine')) {
      const q = await countRows('quarantine');
      return `⚡ CASCADE: ${q} events quarantined`;
    }
  } catch (err) {
    return `⚡ CASCADE: query failed — ${err.message}`;
  }
  return `⚡ CASCADE: event processing system. Try 'status' or 'quarantine'.`;
}

async function handleKilo(message) {
  const m = message.toLowerCase();
  if (!sbConfigured()) return `🔧 KILO: ${NO_DB}`;
  try {
    if (m.includes('hypothesis') || m.includes('repair')) {
      const data = await sbRpc('analyze_health_trends');
      return `🔧 KILO: Hypothesis: ${data?.trend_reason || 'System stable, no repair needed'}`;
    }
    if (m.includes('validate')) {
      const dash = await getDashboard();
      if (!dash) return '🔧 KILO: validation unavailable';
      const ok = dash.current_status === 'OK';
      return `🔧 KILO: ${ok ? 'Validated' : 'Flagged'} — status: ${dash.current_status}, trend: ${dash.trend_status}`;
    }
  } catch (err) {
    return `🔧 KILO: query failed — ${err.message}`;
  }
  return `🔧 KILO: repair hypothesis engine. Ask about 'hypothesis' or 'validate'.`;
}

async function handleProtoForge(message) {
  const m = message.toLowerCase();
  if (!sbConfigured()) return `🌐 ProtoForge: ${NO_DB}`;
  try {
    const dash = await getDashboard();
    if (!dash) return '🌐 ProtoForge: status unavailable';
    if (m.includes('govern')) {
      return dash.escalation_level === 'OK'
        ? '🌐 ProtoForge: All policies compliant'
        : `🌐 ProtoForge: Escalation ${dash.escalation_level} — ${dash.escalation_reason}`;
    }
    return `🌐 ProtoForge: ${dash.current_status} (trend: ${dash.trend_status}) · Queue: ${dash.jobs_queued} queued / ${dash.jobs_failed} failed`;
  } catch (err) {
    return `🌐 ProtoForge: query failed — ${err.message}`;
  }
}

async function handleHyve(message) {
  if (!sbConfigured()) return `🐝 Hyve: ${NO_DB}`;
  try {
    const leads = await countRows('leads', '&status=eq.new');
    return `🐝 Hyve: ${leads} new lead(s) / optimization opportunities`;
  } catch (err) {
    return `🐝 Hyve: query failed — ${err.message}`;
  }
}

async function handleInfrastructure(message) {
  const m = message.toLowerCase();
  if (!sbConfigured()) return `🏗️ Infrastructure: ${NO_DB}`;
  try {
    const dash = await getDashboard();
    if (!dash) return '🏗️ Infrastructure: no dashboard data';
    if (m.includes('resources') || m.includes('queue')) {
      return `🏗️ Resource Usage:\n• Jobs queued: ${dash.jobs_queued}\n• Jobs failed: ${dash.jobs_failed}\n• Jobs dead: ${dash.jobs_dead}\n• Critical: ${dash.critical_pct}% | Warning: ${dash.warning_pct}%`;
    }
    if (m.includes('alerts') || m.includes('escalation')) {
      return dash.escalation_level === 'OK'
        ? '🏗️ Alerts: No active escalations. System is stable.'
        : `🏗️ ALERT: ${dash.escalation_level}!\nAction: ${dash.escalation_action}\nReason: ${dash.escalation_reason}`;
    }
    const statusEmoji = EMOJI[dash.current_status] ?? '❓';
    return `🏗️ Infrastructure Health: ${statusEmoji} ${dash.current_status}\nTrend: ${dash.trend_status} (${dash.trend_reason})\nQueue: ${dash.jobs_queued} queued, ${dash.jobs_failed} failed, ${dash.jobs_dead} dead\nEvents (1h): ${dash.events_last_hour} | Auto-heals (24h): ${dash.auto_heals_24h}`;
  } catch (err) {
    return `🏗️ Infrastructure: query failed — ${err.message}`;
  }
}

async function handleRezonate(message) {
  const m = message.toLowerCase();
  if (!sbConfigured()) return `🎵 Rezonate: ${NO_DB}`;
  try {
    if (m.includes('revenue') || m.includes('sales')) {
      const cutoff = new Date(Date.now() - 86_400_000).toISOString();
      const rows = await sbGet(`ledger?select=net,created_at&revenue_stream=eq.rezonate&created_at=gte.${encodeURIComponent(cutoff)}`);
      const net = rows.reduce((s, r) => s + (r.net || 0), 0);
      return `🎵 Rezonate: ${rows.length} ledger entrie(s) in the last 24h — net $${net.toFixed(2)}`;
    }
  } catch (err) {
    return `🎵 Rezonate: query failed — ${err.message}`;
  }
  return `🎵 Rezonate: music production system. Try 'revenue'.`;
}

const systemHandlers = {
  ursula: handleUrsula,
  heidi: handleHeidi,
  cascade: handleCascade,
  kilo: handleKilo,
  protoforge: handleProtoForge,
  hyve: handleHyve,
  infrastructure: handleInfrastructure,
  rezonate: handleRezonate,
};

// ── Static chat UI ────────────────────────────────────────────────────────────

const UI_CANDIDATES = [
  path.join(__dirname, 'hydi-chat.html'),
  path.join(__dirname, '..', 'public', 'hydi-chat.html'),
];
function loadUI() {
  for (const p of UI_CANDIDATES) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return Buffer.from(
    '<h1>HYDI Chat Server is running</h1><p>Place <code>hydi-chat.html</code> next to this server file to serve the chat UI.</p>'
  );
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (url.pathname === '/' || url.pathname === '/hydi-chat.html' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loadUI());
    }

    if (url.pathname === '/api/health') {
      if (!sbConfigured()) return json(res, 200, { status: 'offline-mode', supabase: false, node: 'termux' });
      try {
        const dash = await getDashboard();
        return json(res, 200, {
          status: dash && dash.current_status === 'OK' ? 'healthy' : 'degraded',
          hydi_status: dash?.current_status ?? 'unknown',
          node: 'termux',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        return json(res, 503, { status: 'unavailable', error: err.message, node: 'termux' });
      }
    }

    if (url.pathname === '/api/mobile-status') {
      if (!sbConfigured()) return json(res, 200, { ok: true, system: 'OFFLINE', node: 'termux' });
      try {
        const dash = await getDashboard();
        return json(res, 200, {
          ok: dash?.escalation_level !== 'CRITICAL',
          system: dash?.current_status ?? 'unknown',
          drift: dash?.trend_status ?? 'unknown',
          node: 'termux',
          ts: new Date().toISOString(),
        });
      } catch (err) {
        return json(res, 503, { ok: false, alert: err.message, node: 'termux' });
      }
    }

    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

      const { valid, reason } = checkServiceToken(req.headers['x-hydi-service-token']);
      if (!valid) return json(res, 401, { error: 'Unauthorized', reason });

      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) {
        return json(res, 400, { error: 'Invalid JSON body' });
      }
      const { message, system } = parsed;
      if (!message || !system) return json(res, 400, { error: 'Message and system are required' });

      const handler = systemHandlers[system];
      if (!handler) return json(res, 400, { error: `Unknown system: ${system}` });

      const response = await handler(message);
      return json(res, 200, { response, system, node: 'termux', timestamp: new Date().toISOString() });
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ⚡ HYDI Chat Server (Termux node)');
  console.log(`  → Chat UI:  http://localhost:${PORT}/`);
  console.log(`  → API:      http://localhost:${PORT}/api/chat`);
  console.log(`  → Supabase: ${sbConfigured() ? 'connected (' + SUPABASE_URL + ')' : 'NOT configured — offline mode'}`);
  console.log(`  → Auth:     ${SERVICE_SECRET ? 'HMAC service token required' : 'open (no HYDI_SERVICE_SECRET set — keep this node local)'}`);
  console.log('');
});
