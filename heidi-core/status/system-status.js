'use strict';

/**
 * One honest picture of HYDI's operational state, for Heidi's chat, the
 * mobile dashboard and GET /system/status.
 *
 * Every component gets one of four states:
 *   HEALTHY      it answered and did what it is for
 *   DEGRADED     it answered, but something about it is wrong
 *   UNAVAILABLE  it could not be reached at all
 *   UNKNOWN      no fresh evidence either way (missing or stale status file)
 *
 * "Answered over HTTP" is never enough on its own: the web app must report
 * its own health, Ollama must list models, memory must accept a write, and
 * status files must be fresh. Every check has a timeout and records where
 * its evidence came from.
 */

const fs = require('fs');
const path = require('path');

const STATES = Object.freeze(['HEALTHY', 'UNKNOWN', 'DEGRADED', 'UNAVAILABLE']);
const RANK = Object.freeze({ HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, UNAVAILABLE: 3 });
const ICON = Object.freeze({ HEALTHY: '✅', DEGRADED: '⚠️', UNAVAILABLE: '❌', UNKNOWN: '❔' });
const FILE_STALE_MS = Object.freeze({ daemon: 180 * 1000, frank: 5 * 60 * 1000 });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function getJson(fetchImpl, url, timeoutMs) {
  const started = Date.now();
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { ok: r.ok, status: r.status, body, ms: Date.now() - started };
  } catch (error) {
    const msg = error && error.name === 'TimeoutError' ? `no answer in ${timeoutMs}ms` : (error instanceof Error ? error.message : 'unreachable');
    return { ok: false, status: 0, error: msg, ms: Date.now() - started };
  }
}

function component(name, state, detail, source) {
  return { name, state, detail, source };
}

function ageMs(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : Infinity;
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: number, root?: string, env?: object,
 *   urls?: object, timeoutMs?: number, memoryRuntime?: any, legacyMemory?: any, uptimeMs?: number }} opts
 */
async function checkSystem(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now();
  const env = opts.env || process.env;
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const t = opts.timeoutMs || 4000;
  const urls = {
    ollama: (env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    web: env.HEIDI_WEB_URL || 'http://127.0.0.1:3000',
    mobile: env.HEIDI_MOBILE_URL || 'http://127.0.0.1:3006',
    protoforge: env.PROTOFORGE_CORE_URL || 'http://127.0.0.1:3005',
    ...(opts.urls || {}),
  };

  const tasks = [];

  // Heidi Core itself: if this runs, it is answering.
  tasks.push(Promise.resolve(component('heidi-core', 'HEALTHY',
    `answering${Number.isFinite(opts.uptimeMs) ? `, up ${Math.round(opts.uptimeMs / 60000)} min` : ''}`, 'this process')));

  // Memory: the store must open AND accept a (rolled-back) write.
  tasks.push((async () => {
    const rt = opts.memoryRuntime;
    if (!rt || !rt.store) return component('memory', 'UNAVAILABLE', `persistent memory is off: ${(rt && rt.storeError) || 'not configured'}`, 'heidi-core memory runtime');
    try {
      rt.store.probeWrite();
      const lm = opts.legacyMemory;
      const legacyRam = lm && !lm.db && lm.inMemoryData;
      return component('memory', legacyRam ? 'DEGRADED' : 'HEALTHY',
        legacyRam ? 'conversations + memories persist; legacy store (agents, missions) is in RAM only — sqlite3 failed to load' : 'conversations and memories read + write OK',
        'write probe on heidi_memory.db');
    } catch (error) {
      return component('memory', 'DEGRADED', `database opened but refused a write: ${error instanceof Error ? error.message : 'error'}`, 'write probe on heidi_memory.db');
    }
  })());

  // Ollama: must list at least one model.
  tasks.push((async () => {
    const r = await getJson(fetchImpl, `${urls.ollama}/api/tags`, t);
    if (!r.ok && r.status === 0) return component('local-model', 'UNAVAILABLE', `Ollama ${r.error}`, `${urls.ollama}/api/tags`);
    const models = r.body && Array.isArray(r.body.models) ? r.body.models.map((m) => m.name) : null;
    if (!r.ok || !models) return component('local-model', 'DEGRADED', `Ollama answered HTTP ${r.status} without a model list`, `${urls.ollama}/api/tags`);
    if (!models.length) return component('local-model', 'DEGRADED', 'Ollama is up but has no models installed', `${urls.ollama}/api/tags`);
    return component('local-model', 'HEALTHY', `${models.length} model(s): ${models.slice(0, 4).join(', ')}${models.length > 4 ? '…' : ''}`, `${urls.ollama}/api/tags`);
  })());

  // Heidi web: alive (ping) AND reports itself healthy (/api/health).
  tasks.push((async () => {
    const ping = await getJson(fetchImpl, `${urls.web}/api/ping`, t);
    if (!ping.ok) return component('heidi-web', 'UNAVAILABLE', `not answering (${ping.error || `HTTP ${ping.status}`})`, `${urls.web}/api/ping`);
    const health = await getJson(fetchImpl, `${urls.web}/api/health`, t + 4000);
    const s = health.body && String(health.body.status || '').toLowerCase();
    if (s === 'healthy' || s === 'ok') return component('heidi-web', 'HEALTHY', 'alive and reports healthy', `${urls.web}/api/health`);
    return component('heidi-web', 'DEGRADED', `alive, but its health check says ${s || (health.error || `HTTP ${health.status}`)}`, `${urls.web}/api/health`);
  })());

  // Mobile chat relay (:3006).
  tasks.push((async () => {
    const r = await getJson(fetchImpl, `${urls.mobile}/api/health`, t);
    if (!r.ok) return component('mobile-chat', r.status === 0 ? 'UNAVAILABLE' : 'DEGRADED', `mobile chat ${r.error || `answered HTTP ${r.status}`}`, `${urls.mobile}/api/health`);
    return component('mobile-chat', 'HEALTHY', 'answering', `${urls.mobile}/api/health`);
  })());

  // ProtoForge core (:3005): CASCADE/KILO/ProtoForge pipeline + agent bus.
  tasks.push((async () => {
    const r = await getJson(fetchImpl, `${urls.protoforge}/health`, t);
    if (r.status === 0) return component('protoforge-core', 'UNAVAILABLE', `not answering (${r.error})`, `${urls.protoforge}/health`);
    const s = r.body && String(r.body.status || '').toLowerCase();
    if (r.ok && (s === 'ok' || s === 'healthy')) return component('protoforge-core', 'HEALTHY', 'pipeline service reports ok', `${urls.protoforge}/health`);
    return component('protoforge-core', 'DEGRADED', `answered HTTP ${r.status}${s ? `, status ${s}` : ''}`, `${urls.protoforge}/health`);
  })());

  // Database + execution worker: from hydi-daemon's own status file, which
  // carries an independent Postgres + Supabase REST probe.
  tasks.push((async () => {
    const d = readJson(path.join(root, '.heidi-daemon-status.json'));
    const src = '.heidi-daemon-status.json';
    if (!d || !d.updatedAt) {
      return [component('database', 'UNKNOWN', 'no daemon status file, so no recent database probe', src),
        component('execution-daemon', 'UNKNOWN', 'hydi-daemon has not written a status file', src)];
    }
    const age = ageMs(d.updatedAt, now);
    if (age > FILE_STALE_MS.daemon) {
      const mins = Math.round(age / 60000);
      return [component('database', 'UNKNOWN', `last probe ${mins} min ago (stale)`, src),
        component('execution-daemon', 'UNKNOWN', `status file ${mins} min old — daemon may be stopped`, src)];
    }
    // PersistenceTruth (lib/heidi/DaemonStatusSurface.ts): pg/rest are 'ok' | 'down' | 'unknown'.
    const p = d.persistence || {};
    const pg = p.pg || 'unknown';
    const rest = p.rest || 'unknown';
    let db;
    if (pg === 'ok' && rest === 'ok') db = component('database', 'HEALTHY', 'Postgres and Supabase REST answered the daemon\'s probe', src);
    else if (pg === 'down' && rest === 'down') db = component('database', 'UNAVAILABLE', 'Postgres and Supabase REST both failed the daemon\'s probe', src);
    else if (pg === 'unknown' && rest === 'unknown') db = component('database', 'UNKNOWN', 'the daemon has not probed the database yet', src);
    else db = component('database', 'DEGRADED', `Postgres ${pg}, Supabase REST ${rest}`, src);
    const fails = Number(d.consecutiveFailures) || 0;
    const exec = fails >= 3 ? component('execution-daemon', 'DEGRADED', `${fails} failed cycles in a row; last error: ${String(d.lastError || 'none').slice(0, 120)}`, src)
      : component('execution-daemon', 'HEALTHY', `${d.state || 'running'}, last cycle ${d.lastCycleOutcome || 'unknown'}`, src);
    return [db, exec];
  })());

  // Frank host: frank-observer's combined snapshot (PM2, Docker, disk, strays).
  tasks.push((async () => {
    const f = readJson(path.join(root, '.runtime', 'observation', 'frank.json'));
    const src = '.runtime/observation/frank.json';
    if (!f || !f.at) return component('frank-host', 'UNKNOWN', 'no observation snapshot (is frank-observer running?)', src);
    const age = ageMs(f.at, now);
    if (age > FILE_STALE_MS.frank) return component('frank-host', 'UNKNOWN', `snapshot ${Math.round(age / 60000)} min old (stale)`, src);
    const issues = Array.isArray(f.issues) ? f.issues : [];
    const top = issues.slice(0, 3).map((i) => i.text).join('; ');
    if (f.level === 'OK') return component('frank-host', 'HEALTHY', 'no issues', src);
    return component('frank-host', 'DEGRADED', `${f.level}: ${issues.length} issue(s)${top ? ` — ${top}` : ''}`, src);
  })());

  // Auth posture: what protects these surfaces.
  tasks.push(Promise.resolve(component('auth',
    env.HEIDI_MOBILE_TOKEN ? 'HEALTHY' : 'DEGRADED',
    `heidi-core: ${env.HEIDI_SECRET ? 'remote callers need x-heidi-secret' : 'loopback callers only'}; mobile chat: ${env.HEIDI_MOBILE_TOKEN ? 'device token required off-box' : 'NO login — anyone on the LAN/tailnet can use it'}`,
    'environment')));

  // Recent task failures from Heidi's mission queue.
  tasks.push((async () => {
    const lm = opts.legacyMemory;
    if (!lm || typeof lm.getMissions !== 'function') return component('recent-failures', 'UNKNOWN', 'mission queue not readable', 'missions');
    try {
      const failed = await lm.getMissions('failed', 50);
      const recent = (failed || []).filter((m) => ageMs(String(m.updated_at || m.created_at || '').replace(' ', 'T') + (String(m.updated_at || m.created_at || '').includes('Z') ? '' : 'Z'), now) < 24 * 3600 * 1000);
      if (!recent.length) return component('recent-failures', 'HEALTHY', 'no failed missions in 24h', 'missions');
      return component('recent-failures', 'DEGRADED', `${recent.length} failed mission(s) in 24h, latest: ${String(recent[0].goal || '').slice(0, 80)}`, 'missions');
    } catch (error) {
      return component('recent-failures', 'UNKNOWN', `could not read missions: ${error instanceof Error ? error.message : 'error'}`, 'missions');
    }
  })());

  // Task queue (missions/lifecycle.js): what waits on the person, and
  // anything stuck mid-run (the action executor times out after 30s).
  tasks.push((async () => {
    const lm = opts.legacyMemory;
    if (!lm || typeof lm.countMissionsByStatus !== 'function') return component('task-queue', 'UNKNOWN', 'task queue not readable', 'missions');
    try {
      const n = await lm.countMissionsByStatus();
      const c = (k) => n[k] || 0;
      const inFlight = await lm.getMissions(['planning', 'running', 'verifying'], 50);
      const stuck = (inFlight || []).filter((m) => ageMs(String(m.updated_at || m.created_at || '').replace(' ', 'T') + (String(m.updated_at || m.created_at || '').includes('Z') ? '' : 'Z'), now) > 10 * 60 * 1000);
      const summary = `${c('awaiting_approval')} awaiting approval, ${c('queued') + c('pending')} queued, ${c('running') + c('active') + c('verifying') + c('planning')} in progress, ${c('blocked')} blocked`;
      if (stuck.length) return component('task-queue', 'DEGRADED', `${summary}; task #${stuck[0].id} has been ${stuck[0].status} for over 10 min`, 'missions');
      return component('task-queue', 'HEALTHY', summary, 'missions');
    } catch (error) {
      return component('task-queue', 'UNKNOWN', `could not read tasks: ${error instanceof Error ? error.message : 'error'}`, 'missions');
    }
  })());

  const components = (await Promise.all(tasks)).flat();
  // Overall: the core needs memory and a model; anything else wrong is DEGRADED.
  const core = components.filter((c) => c.name === 'memory' || c.name === 'local-model');
  const coreDown = core.some((c) => c.state === 'UNAVAILABLE');
  const worst = components.reduce((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), 'HEALTHY');
  const overall = coreDown ? 'UNAVAILABLE' : worst === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
  return { overall, checkedAt: new Date(now).toISOString(), components };
}

function formatSystemStatus(report) {
  const lines = [`${ICON[report.overall]} HYDI system: ${report.overall} (checked ${report.checkedAt.slice(11, 19)} UTC)`];
  for (const c of report.components) lines.push(`${ICON[c.state]} ${c.name}: ${c.state} — ${c.detail}`);
  return lines.join('\n');
}

/** Chat phrases that ask for the full report (deterministic, no model call). */
function isSystemReportQuery(input) {
  const t = String(input || '').trim().toLowerCase();
  return t === 'system report' || t === 'status report' || t === 'health report' || t === '/status' || t === 'full status';
}

module.exports = { checkSystem, formatSystemStatus, isSystemReportQuery, STATES };
