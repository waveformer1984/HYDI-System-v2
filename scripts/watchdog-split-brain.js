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

let pm2AppsCache = null;
function pm2Apps() {
  if (pm2AppsCache) return pm2AppsCache;
  try {
    const out = execSync('pm2 jlist', {
      encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
    });
    const list = JSON.parse(out);
    pm2AppsCache = Array.isArray(list) ? list : [];
  } catch {
    pm2AppsCache = [];
  }
  return pm2AppsCache;
}

function appForEndpoint(epName) {
  return pm2Apps().find((a) =>
    a && a.name && (a.name === epName || a.name.startsWith(`${epName}-`) || epName.startsWith(`${a.name}-`))
  ) || null;
}

const listenerCache = new Map();
function listenerPids(port) {
  if (listenerCache.has(port)) return listenerCache.get(port);
  const pids = new Set();
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true });
    const re = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) pids.add(Number(m[1]));
    }
  } catch { /* netstat unavailable — no evidence either way */ }
  listenerCache.set(port, pids);
  return pids;
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
  let apps;
  try { apps = pm2Apps(); } catch { return; }
  if (!apps.length) return;

  for (const r of results) {
    if (!r || r.ok !== true || r.splitBrainChecked) continue;
    const port = portOf(r.url);
    if (!port) continue;
    r.splitBrainChecked = true;

    const app = appForEndpoint(r.name);
    if (!app) continue; // not PM2-managed (or no mapping) — nothing to compare

    const listeners = listenerPids(port);
    const pm2Pid = Number(app.pid) || null;
    const pm2Status = (app.pm2_env && app.pm2_env.status) || 'unknown';
    const pm2Online = pm2Status === 'online' && pm2Pid;

    let orphanPids = [];
    let splitBrain = false;
    if (listeners.size) {
      const managedListening = pm2Online && listeners.has(pm2Pid);
      if (!managedListening) {
        orphanPids = pm2Online
          ? [...listeners].filter((p) => p !== pm2Pid)
          : [...listeners];
        splitBrain = orphanPids.length > 0;
      }
    } else {
      // Listener table unavailable (sandboxed shell, permissions, non-Windows
      // netstat differences): the endpoint answered but PM2 does not consider
      // its app online — that alone is split-brain evidence. Orphan PID is
      // unknown; report and proposal degrade gracefully.
      splitBrain = !pm2Online;
    }
    if (!splitBrain) continue; // PM2's own instance owns the port (or unverifiable + PM2 online)

    const report = {
      component: r.name,
      port,
      url: r.url,
      pm2Name: app.name,
      pm2Status,
      pm2Pid,
      orphanPids,
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
        : '; listener table unavailable so orphan pid unknown (not killed).');
  }
}

module.exports = { annotateSplitBrain, _reset: () => { pm2AppsCache = null; listenerCache.clear(); } };
