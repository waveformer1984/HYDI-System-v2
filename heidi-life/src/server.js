// Heidi Life — runs on Frank. LAN-only HTTP: the phone posts pings here; the dashboard lives at /.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, audit } from './db.js';
import { startScheduler, runInsights, rollupRecent } from './engine.js';
import { execute, reject } from './gate.js';
import { localDay } from './util.js';
import { calibrationStats, latestReflection } from './calibrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(p = process.env.HEIDI_LIFE_CONFIG || path.join(ROOT, 'config.json')) {
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!cfg.token || cfg.token.startsWith('CHANGE-ME')) throw new Error('Set a real "token" in config.json');
  return cfg;
}

const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Tailscale addresses: 100.64.0.0/10 (CGNAT) or fd7a:115c:a1e0::/48. Not reachable from the public internet.
export function isTailnet(addr = '') {
  const v4 = addr.replace(/^::ffff:/, '');
  const m = v4.match(/^100\.(\d+)\.\d+\.\d+$/);
  if (m) return +m[1] >= 64 && +m[1] <= 127;
  return addr.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

// Approvals: always from Frank itself; from your phone only over Tailscale, with the token, and only if enabled.
const canApprove = (req, authed, cfg) => isLocal(req) || (cfg.allowTailnetApprovals === true && authed && isTailnet(req.socket.remoteAddress));

function tokenOk(req, url, cfg) {
  const given = req.headers['x-heidi-token'] || url.searchParams.get('token') || '';
  const a = Buffer.from(String(given)), b = Buffer.from(cfg.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function readJson(req, limit = 2_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function summary(db, cfg) {
  const today = localDay(Date.now(), cfg.timezone);
  const days = db.prepare('SELECT json FROM daily ORDER BY day DESC LIMIT 14').all().map(r => JSON.parse(r.json)).reverse();
  const last = db.prepare('SELECT ts, battery, charging FROM pings ORDER BY ts DESC LIMIT 1').get();
  const digestRow = db.prepare("SELECT detail FROM audit WHERE event = 'digest' ORDER BY id DESC LIMIT 1").get();
  return {
    today, timezone: cfg.timezone,
    status: { lastPing: last?.ts ?? null, battery: last?.battery ?? null, charging: last?.charging ?? null, allowExec: process.env[cfg.gate.allowExecEnvVar || 'HEIDI_ALLOW_EXEC'] === 'true' },
    days,
    insights: db.prepare('SELECT * FROM insights ORDER BY id DESC LIMIT 20').all(),
    actions: db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT 30').all().map(a => ({ ...a, payload: JSON.parse(a.payload) })),
    calibration: calibrationStats(db),
    reflection: latestReflection(db),
    focusBlocks: db.prepare('SELECT * FROM focus_blocks WHERE end > ? ORDER BY start').all(Date.now()),
    digest: digestRow ? JSON.parse(digestRow.detail) : null
  };
}

// RFC 5545 TEXT escaping: backslash first, then ; , and newlines.
const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function ics(db) {
  const f = ts => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const rows = db.prepare('SELECT * FROM focus_blocks ORDER BY start DESC LIMIT 200').all();
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProtoForge//Heidi Life//EN', 'X-WR-CALNAME:Heidi focus blocks',
    ...rows.flatMap(r => ['BEGIN:VEVENT', `UID:heidi-focus-${r.id}@protoforge`, `DTSTAMP:${f(Date.now())}`,
      `DTSTART:${f(r.start)}`, `DTEND:${f(r.end)}`, `SUMMARY:${icsText(r.title)}`, 'END:VEVENT']),
    'END:VCALENDAR'].join('\r\n');
}

export function createServer(db, cfg) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const authed = tokenOk(req, url, cfg);
    try {
      // ---- phone → Frank ----
      if (req.method === 'POST' && url.pathname === '/ingest') {
        if (!authed) return send(res, 401, { error: 'bad token' });
        const { pings = [] } = await readJson(req);
        const ins = db.prepare('INSERT OR IGNORE INTO pings (ts, lat, lon, acc, provider, battery, charging) VALUES (?,?,?,?,?,?,?)');
        let n = 0;
        db.exec('BEGIN');
        for (const p of pings) {
          const ts = Number(p.ts);
          if (!Number.isFinite(ts) || ts > Date.now() + 60_000) continue;
          const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
          n += ins.run(ts, num(p.lat), num(p.lon), num(p.acc), p.provider ?? null, num(p.battery), p.charging ? 1 : 0).changes;
        }
        db.exec('COMMIT');
        return send(res, 200, { ok: true, stored: n });
      }
      if (req.method === 'GET' && url.pathname === '/api/notifications/pending') {
        if (!authed) return send(res, 401, { error: 'bad token' });
        const due = db.prepare('SELECT id, title, body FROM notifications WHERE delivered = 0 AND deliver_at <= ? ORDER BY deliver_at').all(Date.now());
        const mark = db.prepare('UPDATE notifications SET delivered = ? WHERE id = ?');
        for (const n of due) mark.run(Date.now(), n.id);
        return send(res, 200, { notifications: due });
      }
      if (req.method === 'GET' && url.pathname === '/calendar/heidi.ics') {
        if (!authed) return send(res, 401, 'bad token', 'text/plain');
        return send(res, 200, ics(db), 'text/calendar; charset=utf-8');
      }

      // ---- dashboard (localhost, or token on the LAN) ----
      if (!isLocal(req) && !authed) return send(res, 401, { error: 'local or token only' });
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') return send(res, 200, summary(db, cfg));

      // ---- approvals: localhost only, never remotely ----
      const m = url.pathname.match(/^\/api\/actions\/(\d+)\/(approve|reject)$/);
      if (req.method === 'POST' && m) {
        if (!canApprove(req, authed, cfg)) return send(res, 403, { error: 'approve from Frank, or over Tailscale with allowTailnetApprovals' });
        const by = isLocal(req) ? 'jordan@frank' : `jordan@tailnet(${req.socket.remoteAddress})`;
        if (m[2] === 'approve') return send(res, 200, execute(db, cfg, Number(m[1]), by));
        reject(db, Number(m[1]), by); return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/run-insights') {
        if (!isLocal(req)) return send(res, 403, { error: 'local only' });
        const day = rollupRecent(db, cfg);
        return send(res, 200, { day, results: await runInsights(db, cfg, day) });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      audit(db, 'http_error', e.message);
      send(res, 400, { error: e.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  createServer(db, cfg).listen(cfg.port, '0.0.0.0', () => {
    console.log(`Heidi Life on :${cfg.port}  (dashboard http://127.0.0.1:${cfg.port}/)  exec=${process.env.HEIDI_ALLOW_EXEC === 'true'}`);
  });
  startScheduler(db, cfg);
}
