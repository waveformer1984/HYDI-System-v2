'use strict';
/**
 * SPLIT-BRAIN detection for the watchdog.
 *
 * Live incident 2026-11-11: orphaned `next start` (pid 20896) held :3000 and
 * answered HTTP while PM2's heidi-web-standalone sat in "waiting restart"
 * crash-looping on EADDRINUSE. Every health probe saw a responding port and
 * reported green — a false green that hid the orphan for hours.
 *
 * For each endpoint whose HTTP probe succeeded, confirm the PID listening on
 * the port is the PID PM2 manages for that app. Mismatch (or PM2 not online
 * at all) = SPLIT-BRAIN: the endpoint is reported unhealthy with the orphan
 * PID in the report. Orphans are NEVER killed here — the watchdog writes a
 * proposal into heidi-core's mission inbox (`mission-cli create`,
 * informational only) so a human approves any kill through the existing
 * task flow.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.runtime', 'watchdog');
const PROPOSAL_TTL_MS = 60 * 60 * 1000;

// PM2 snapshot lifecycle (fixed 2026-11-16): the original code cached the
// first `pm2 jlist` result for the life of the watchdog process. When that
// first read caught heidi-web-standalone mid-restart ("waiting restart",
// pid=none), every later tick reported SPLIT-BRAIN against a stale snapshot
// even though PM2 had long since recovered — a false positive that also
// masked real orphan detection. The snapshot now refreshes once per
// monitoring cycle (TTL below), is shared by all endpoints in that cycle,
// distinguishes query/parse failure from a legitimately absent process, and
// is only reused stale (bounded) when a refresh fails — never silently.
const PM2_SNAPSHOT_TTL_MS = 20 * 1000;        // ~one watchdog cycle; shared within it
const PM2_SNAPSHOT_MAX_STALE_MS = 120 * 1000; // older than this = unusable, report unknown
const PM2_JLIST_TIMEOUT_MS = 8000;
const NETSTAT_TIMEOUT_MS = 8000;

let pm2Snapshot = null; // { at, apps: array|null, error: string|null }

function queryPm2Apps() {
  let out;
  try {
    out = execSync('pm2 jlist', {
      encoding: 'utf8', timeout: PM2_JLIST_TIMEOUT_MS, stdio: 'pipe', windowsHide: true,
    });
  } catch (e) {
    return { apps: null, error: `pm2 jlist failed: ${e.message}` };
  }
  let list;
  try {
    list = JSON.parse(out);
  } catch (e) {
    return { apps: null, error: `pm2 jlist returned unparseable output: ${e.message}` };
  }
  if (!Array.isArray(list)) {
    // Valid JSON but not a process list — a shape failure, NOT "process absent".
    return { apps: null, error: 'pm2 jlist returned JSON that is not an array' };
  }
  return { apps: list, error: null };
}

/**
 * Returns { status, apps, ageMs, error }:
 *   'fresh'       — snapshot taken within TTL (or just refreshed) this cycle
 *   'stale'       — refresh failed; last-good snapshot reused, age <= MAX_STALE
 *   'unavailable' — no usable snapshot (first query failed, or last-good too old)
 * 'apps' is null unless status is 'fresh' or 'stale'. 'stale'/'unavailable'
 * must never be treated as authoritative current PM2 state.
 */
function getPm2Snapshot(now = Date.now()) {
  if (pm2Snapshot && now - pm2Snapshot.at < PM2_SNAPSHOT_TTL_MS) {
    return { status: 'fresh', apps: pm2Snapshot.apps, ageMs: now - pm2Snapshot.at, error: null };
  }
  const q = queryPm2Apps();
  if (!q.error) {
    pm2Snapshot = { at: now, apps: q.apps, error: null };
    return { status: 'fresh', apps: q.apps, ageMs: 0, error: null };
  }
  if (pm2Snapshot && now - pm2Snapshot.at <= PM2_SNAPSHOT_MAX_STALE_MS) {
    return { status: 'stale', apps: pm2Snapshot.apps, ageMs: now - pm2Snapshot.at, error: q.error };
  }
  return { status: 'unavailable', apps: null, ageMs: pm2Snapshot ? now - pm2Snapshot.at : null, error: q.error };
}

function appForEndpoint(apps, epName) {
  return (apps || []).find((a) =>
    a && a.name && (a.name === epName || a.name.startsWith(`${epName}-`) || epName.startsWith(`${a.name}-`))
  ) || null;
}

// Listener table is refreshed once per annotateSplitBrain() call (i.e. per
// monitoring cycle) — the old process-lifetime cache froze port→PID mappings
// exactly like the PM2 cache did. { available:false } is distinct from an
// available-but-empty table: exec failure/timeout vs. genuinely no LISTENING
// row. On Windows a port that just answered HTTP always has a row, so an
// empty result after a *successful* netstat means the parse found nothing —
// still reported as available with zero PIDs (no evidence of an orphan).
const listenerCache = new Map();
function listenerPids(port) {
  if (listenerCache.has(port)) return listenerCache.get(port);
  const result = { available: false, pids: new Set(), error: null };
  let out;
  try {
    out = execSync('netstat -ano', { encoding: 'utf8', timeout: NETSTAT_TIMEOUT_MS, stdio: 'pipe', windowsHide: true });
  } catch (e) {
    result.error = `netstat -ano failed: ${e.message}`;
    listenerCache.set(port, result);
    return result;
  }
  result.available = true;
  const re = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) result.pids.add(Number(m[1]));
  }
  listenerCache.set(port, result);
  return result;
}

function writeSnapshotReport(snap) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const file = path.join(REPORT_DIR, 'pm2-snapshot.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({
      status: snap.status, ageMs: snap.ageMs, appCount: snap.apps ? snap.apps.length : null,
      error: snap.error, at: new Date().toISOString(),
    }, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* best-effort observability */ }
}

function portOf(url) {
  try {
    const u = new URL(url);
    return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  } catch { return null; }
}

function writeReport(epName, report) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const file = path.join(REPORT_DIR, `split-brain-${epName}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* report is best-effort; the FAIL log line still carries it */ }
}

function recentProposal(epName) {
  try {
    const file = path.join(REPORT_DIR, `split-brain-${epName}.json`);
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cur.proposedAt && (Date.now() - Date.parse(cur.proposedAt)) < PROPOSAL_TTL_MS;
  } catch { return false; }
}

function proposeKill(epName, report) {
  // Dedupe: one inbox proposal per component per hour.
  if (recentProposal(epName)) return false;
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const file = path.join(REPORT_DIR, `split-brain-${epName}.json`);
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first proposal */ }
    cur.proposedAt = new Date().toISOString();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(cur, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* continue to proposal anyway */ }

  const pids = [...report.orphanPids].join(', ');
  const goal = `SPLIT-BRAIN on ${epName}: port ${report.port} is answered by orphan pid(s) ${pids} while PM2 ` +
    `${report.pm2Name || 'app'} is ${report.pm2Status}. Orphan was NOT killed automatically. ` +
    `If confirmed orphaned, approve killing it manually: Stop-Process -Id ${pids} (run on Frank, then pm2 restart ${report.pm2Name || epName}).`;
  try {
    execSync(`node scripts/mission-cli.js create "${goal.replace(/"/g, "'")}" --priority 2`, {
      cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe', windowsHide: true,
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Mutates endpoint results: a responding port whose listener is not PM2's
 * managed PID (or whose PM2 app isn't online) becomes a SPLIT-BRAIN failure.
 * Safe to call when PM2 is unreachable — it just finds no apps and skips.
 */
function annotateSplitBrain(results) {
  listenerCache.clear(); // fresh listener table once per monitoring cycle
  const snap = getPm2Snapshot();
  writeSnapshotReport(snap);

  if (snap.status === 'unavailable') {
    // No usable PM2 snapshot: ownership is unverifiable this cycle. Surface
    // the uncertainty on each healthy result instead of silently skipping
    // (a permanently unreadable jlist must not become invisible) and instead
    // of flipping health on zero evidence. Split-brain detection resumes on
    // the next cycle with a fresh snapshot.
    for (const r of results) {
      if (!r || r.ok !== true || r.splitBrainChecked) continue;
      const port = portOf(r.url);
      if (!port) continue;
      r.splitBrainChecked = true;
      r.splitBrainUnknown = true;
      r.splitBrainNote = `PM2 snapshot unavailable (${snap.error}); split-brain check skipped this cycle`;
    }
    return snap;
  }

  for (const r of results) {
    if (!r || r.ok !== true || r.splitBrainChecked) continue;
    const port = portOf(r.url);
    if (!port) continue;
    r.splitBrainChecked = true;

    const app = appForEndpoint(snap.apps, r.name);
    if (!app) continue; // not PM2-managed (or no mapping) — nothing to compare

    const listeners = listenerPids(port);
    const pm2Pid = Number(app.pid) || null;
    const pm2Status = (app.pm2_env && app.pm2_env.status) || 'unknown';
    const pm2Online = pm2Status === 'online' && pm2Pid;

    let orphanPids = [];
    let splitBrain = false;
    if (listeners.available && listeners.pids.size) {
      const managedListening = pm2Online && listeners.pids.has(pm2Pid);
      if (!managedListening) {
        orphanPids = pm2Online
          ? [...listeners.pids].filter((p) => p !== pm2Pid)
          : [...listeners.pids];
        splitBrain = orphanPids.length > 0;
      }
    } else {
      // Listener table unusable: either netstat failed/timed out
      // (available=false) or it succeeded but showed no LISTENING row for a
      // port that just answered HTTP (available=true, empty — e.g. a
      // permission-limited or IPv6-only view). In both cases we cannot name
      // the listener PID. If PM2 (fresh snapshot) says its app is not online,
      // the answered port is provably not PM2-owned — flag SPLIT-BRAIN with
      // unknown orphan PID (the 2026-11-11 blind spot this module exists for).
      // If PM2 says online, ownership is plausible but unverified — surface
      // uncertainty, do not flip health.
      if (!pm2Online) {
        splitBrain = true;
      } else {
        r.splitBrainUnknown = true;
        r.splitBrainNote = `listener table ${listeners.available ? 'has no row' : `unavailable (${listeners.error})`}; ` +
          `PM2 ${app.name} online pid=${pm2Pid} — ownership unverified`;
      }
    }
    if (!splitBrain) continue; // PM2's own instance owns the port (or unverifiable + PM2 online)

    const staleNote = snap.status === 'stale'
      ? `; pm2 snapshot stale (age ${Math.round(snap.ageMs / 1000)}s, refresh error: ${snap.error})`
      : '';
    const report = {
      component: r.name,
      port,
      url: r.url,
      pm2Name: app.name,
      pm2Status,
      pm2Pid,
      orphanPids,
      listenerAvailable: listeners.available,
      listenerError: listeners.error,
      pm2SnapshotStatus: snap.status,
      pm2SnapshotAgeMs: snap.ageMs,
      proposedAt: null,
    };
    writeReport(r.name, report);
    // Only propose a kill when we actually know an orphan PID to kill.
    report.proposed = orphanPids.length ? proposeKill(r.name, report) : false;
    writeReport(r.name, report);

    r.ok = false;
    r.state = 'SPLIT-BRAIN';
    r.splitBrain = true;
    r.noAutoRecover = true; // restarting PM2 can't evict the orphan — human decides
    r.orphanPids = orphanPids;
    r.reason = `SPLIT-BRAIN: port ${port} answered while PM2 ${app.name} status=${pm2Status} pid=${pm2Pid || 'none'}` +
      (orphanPids.length
        ? `; orphan pid(s) ${orphanPids.join(', ')} (not killed; kill proposed via mission inbox).`
        : '; listener table unavailable so orphan pid unknown (not killed).') +
      staleNote;
  }
  return snap;
}

module.exports = {
  annotateSplitBrain,
  _reset: () => { pm2Snapshot = null; listenerCache.clear(); },
  _getPm2Snapshot: getPm2Snapshot,
};
