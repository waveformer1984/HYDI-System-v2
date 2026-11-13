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
// 10-minute cache for the GitHub CI probe inside checkSystem (module-level so
// every caller shares it).
let _ciCache = { at: 0, report: null };

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

  // C: drive free space — direct probe. scripts/local-ci.js refuses to run
  // below 12 GB free; surfacing it here means "status" answers the question
  // that actually breaks CI, not just service liveness.
  tasks.push(Promise.resolve().then(() => {
    // opts.diskInfo lets tests (and callers with their own probe) inject
    // { freeGB, totalGB } instead of hitting the filesystem.
    const di = opts.diskInfo;
    try {
      const s = di || (() => { const x = fs.statfsSync(process.env.SystemDrive || 'C:\\'); return { freeGB: (x.bavail * x.bsize) / 1073741824, totalGB: (x.blocks * x.bsize) / 1073741824 }; })();
      const freeGB = s.freeGB, totalGB = s.totalGB;
      const pct = totalGB > 0 ? Math.round((freeGB / totalGB) * 100) : 0;
      const low = freeGB < 12;
      return component('disk-c', low ? 'DEGRADED' : 'HEALTHY',
        `${freeGB.toFixed(1)} GB free of ${totalGB.toFixed(0)} GB (${pct}% free)${low ? ' — below the 12 GB CI floor' : ''}`,
        'fs.statfs C:\\');
    } catch (e) {
      return component('disk-c', 'UNKNOWN', `could not stat C:: ${e instanceof Error ? e.message : 'error'}`, 'fs.statfs');
    }
  }));

  // Last CI signal: newest state per local-ci context on the clean-main head.
  // The repo is public, so no token is needed; result is cached 10 min so a
  // chatty "status" cannot hammer the API.
  tasks.push((async () => {
    // opts.ciStatuses injects a statuses array (newest-first not required);
    // otherwise the GitHub commit-status API is queried and cached.
    if (Array.isArray(opts.ciStatuses)) {
      const latest = {};
      for (const s of opts.ciStatuses) {
        if (!latest[s.context] || String(s.created_at) > String(latest[s.context].created_at)) latest[s.context] = s;
      }
      const parts = Object.keys(latest).sort().map((k) => `${k}=${latest[k].state}`).join(', ');
      const vals = Object.values(latest);
      const bad = vals.some((s) => s.state === 'failure' || s.state === 'error');
      const pend = vals.some((s) => s.state === 'pending');
      return component('ci', bad ? 'DEGRADED' : pend ? 'UNKNOWN' : 'HEALTHY',
        parts || 'no commit statuses on clean-main yet', 'opts.ciStatuses');
    }
    const nowMs = Date.now();
    if (_ciCache.report && nowMs - _ciCache.at < 10 * 60 * 1000) return _ciCache.report;
    const repo = env.HYDI_GITHUB_REPO || 'waveformer1984/HYDI-System-v2';
    const r = await getJson(fetchImpl, `https://api.github.com/repos/${repo}/commits/clean-main/status`, t);
    let report;
    if (!r.ok || !r.body) {
      report = component('ci', 'UNKNOWN', `GitHub status API: ${r.error || `HTTP ${r.status}`}`, 'api.github.com commits/clean-main/status');
    } else {
      const statuses = Array.isArray(r.body.statuses) ? r.body.statuses : [];
      const latest = {};
      for (const s of statuses) {
        if (!latest[s.context] || String(s.created_at) > String(latest[s.context].created_at)) latest[s.context] = s;
      }
      const parts = Object.keys(latest).sort().map((k) => `${k}=${latest[k].state}`).join(', ');
      const vals = Object.values(latest);
      const bad = vals.some((s) => s.state === 'failure' || s.state === 'error');
      const pend = vals.some((s) => s.state === 'pending');
      report = component('ci', bad ? 'DEGRADED' : pend ? 'UNKNOWN' : 'HEALTHY',
        parts || 'no commit statuses on clean-main yet', 'api.github.com commits/clean-main/status');
    }
    _ciCache = { at: nowMs, report };
    return report;
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
  // Short everyday phrasings — "status" is what people actually type.
  if (['status', 'status?', 'system status', 'how are you', "how's it going", "how's the system", 'what\'s up', 'whats up'].includes(t)) return true;
  return t === 'system report' || t === 'status report' || t === 'health report' || t === '/status' || t === 'full status';
}

/** Max normalized utterance length for paraphrase routing (whole-command only). */
const PARAPHRASE_INPUT_MAX = 80;
/** Scan cap — bounds work on pathological trailing punctuation (ReDoS-safe). */
const PARAPHRASE_RAW_SCAN_MAX = 200;

/**
 * Normalize user chat input for paraphrase matching — linear time, no trailing-punct regex
 * (CodeQL js/redos: polynomial `/[.!?,;]+$/` on uncontrolled input).
 * @param {unknown} input
 * @returns {string|null}
 */
function normalizeParaphraseUtterance(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const bounded = raw.length > PARAPHRASE_RAW_SCAN_MAX ? raw.slice(0, PARAPHRASE_RAW_SCAN_MAX) : raw;
  let t = bounded.toLowerCase();
  let out = '';
  let prevSpace = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (!prevSpace && out.length > 0) {
        out += ' ';
        prevSpace = true;
      }
    } else {
      out += ch;
      prevSpace = false;
    }
  }
  const TRAIL = '.!?,;';
  while (out.length > 0 && TRAIL.includes(out[out.length - 1])) {
    out = out.slice(0, -1);
  }
  if (!out.length || out.length > PARAPHRASE_INPUT_MAX) return null;
  return out;
}

/**
 * Bounded paraphrase matcher (docs/DETERMINISTIC_ROUTING_PROPOSAL.md).
 * Whole-utterance match only — returns a stable pattern id or null.
 * Negated, quoted, meta, and mixed-intent utterances are NEVER matched.
 */
function matchSystemReportParaphrase(input) {
  const t = normalizeParaphraseUtterance(input);
  if (!t) return null;
  if (/["'`“”]/.test(t)) return null;                             // quoted/meta use
  if (/\b(don't|do not|dont|never|cannot|can't|wont|won't)\b/.test(t)) return null; // negated
  if (/^(explain|what|why|how|who|when|where|describe|tell me (what|why|how|about))/.test(t)) return null; // meta question
  if (/\b(and|then|also|after|before|plus|restart|stop|start|kill|delete|remove|update|create|write)\b/.test(t)) return null; // mixed/mutating intent
  // run|get|show|give me|generate|make|do [the] system|status|health report|status|check [tool|please|now]
  if (/^(?:run|get|show|give me|generate|make|do)(?: the)? (?:system|status|health|full) (?:report|status|check)(?: tool)?(?: please)?(?: now)?$/.test(t)) {
    return 'system_report_paraphrase';
  }
  // bare forms: "health check", "status check", "system check" (+ please/now)
  if (/^(?:system|status|health) check(?: please| now)?$/.test(t)) return 'health_check';
  return null;
}

/** Chat phrases that ask for the ranked fix list (read-only; lib/observation/fix-list.js). */
function isFixListQuery(input) {
  const t = String(input || '').trim().toLowerCase();
  return t === 'fix list' || t === 'fixlist' || t === 'fix-list' || t === '/fixlist';
}

/** Render .runtime/fixlist/current.json — evidence only, never commands. */
function formatFixList(list) {
  if (!list || !Array.isArray(list.items)) {
    return 'fix list: not produced yet — frank-observer writes .runtime/fixlist/current.json each pass.';
  }
  const c = list.counts || {};
  const head = `fix list: ${list.items.length} item(s) — CRIT=${c.CRIT || 0} WARN=${c.WARN || 0} UNKNOWN=${c.UNKNOWN || 0} INFO=${c.INFO || 0} (generated ${String(list.generatedAt || '').slice(11, 19)} UTC)`;
  const lines = list.items.slice(0, 10).map((i) => `  ${i.level} ${i.kind} ${i.subject} — ${i.detail || ''}${i.proposedFix && i.proposedFix.command ? ` [${i.proposedFix.command}]` : ''}`);
  return [head, ...lines].join('\n');
}

module.exports = { checkSystem, formatSystemStatus, isSystemReportQuery, isFixListQuery, formatFixList, matchSystemReportParaphrase, STATES };
