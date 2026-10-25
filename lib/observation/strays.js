'use strict';

/**
 * Stray-process detection for Frank.
 *
 * PM2 on Windows has lost track of its own children three times in two
 * days (2026-10-24/25): daemon copies kept running and holding the daemon
 * lock, and a Next server held :3000 for 9 hours while PM2's own copy
 * crash-looped 2,000+ times on EADDRINUSE. In every case the stray was
 * still alive and doing harm; PM2 just no longer listed it.
 *
 * A process is a stray when it is one of:
 *   - the owner of port 3000 that is not heidi-web-standalone's PM2 process
 *     or one of its descendants;
 *   - the holder of the hydi-daemon lock that is not hydi-daemon's PM2
 *     process or a descendant;
 *   - a direct child of the PM2 daemon (ProcessContainerFork) whose pid PM2
 *     does not list.
 *
 * Read-only: this reports a pid and the command to stop it. It never stops
 * anything itself.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const WEB_APP = 'heidi-web-standalone';
const DAEMON_APP = 'hydi-daemon';
const WEB_PORT = 3000;

function descendants(rootPid, procs) {
  const out = new Set();
  if (!rootPid) return out;
  out.add(rootPid);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (!out.has(p.pid) && out.has(p.ppid)) {
        out.add(p.pid);
        grew = true;
      }
    }
  }
  return out;
}

function short(cmd) {
  const c = String(cmd || '').replace(/\s+/g, ' ').trim();
  return c.length > 90 ? `…${c.slice(-90)}` : c;
}

/**
 * @param {{
 *   procs: Array<{ pid: number, ppid: number, cmd?: string }>,
 *   pm2: Array<{ name: string, pid: number, status: string }>,
 *   portOwner?: number | null,
 *   lockPid?: number | null,
 * }} input
 * @returns {Array<{ severity: 'crit', source: 'strays', id: string, text: string, pid: number }>}
 */
function findStrays({ procs = [], pm2 = [], portOwner = null, lockPid = null }) {
  const alive = new Set(procs.map((p) => p.pid));
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const app = (name) => pm2.find((a) => a.name === name);
  const issues = [];
  const flagged = new Set();
  const flag = (id, pid, why) => {
    if (flagged.has(pid)) return;
    flagged.add(pid);
    const cmd = byPid.get(pid) ? ` (${short(byPid.get(pid).cmd)})` : '';
    issues.push({
      severity: 'crit',
      source: 'strays',
      id,
      pid,
      text: `stray process ${pid}${cmd}: ${why}. Stop it with: Stop-Process -Id ${pid}`,
    });
  };

  const web = app(WEB_APP);
  if (portOwner && alive.has(portOwner)) {
    const ok = web && web.status === 'online' && descendants(web.pid, procs).has(portOwner);
    if (!ok) flag(`stray-port-${WEB_PORT}`, portOwner, `holds port ${WEB_PORT} but PM2's ${WEB_APP} ${web ? `is ${web.status}` : 'is not listed'}`);
  }

  const daemon = app(DAEMON_APP);
  if (lockPid && alive.has(lockPid)) {
    const ok = daemon && daemon.status === 'online' && descendants(daemon.pid, procs).has(lockPid);
    if (!ok) flag('stray-daemon-lock', lockPid, `holds the hydi-daemon lock but PM2's ${DAEMON_APP} ${daemon ? `is ${daemon.status}` : 'is not listed'}`);
  }

  // The PM2 daemon is the parent most tracked processes share.
  const tracked = new Set(pm2.map((a) => a.pid).filter(Boolean));
  const parents = new Map();
  for (const pid of tracked) {
    const p = byPid.get(pid);
    if (p) parents.set(p.ppid, (parents.get(p.ppid) || 0) + 1);
  }
  const god = [...parents.entries()].sort((a, b) => b[1] - a[1])[0];
  if (god && god[1] >= 2) {
    for (const p of procs) {
      if (p.ppid === god[0] && !tracked.has(p.pid) && /ProcessContainerFork/i.test(String(p.cmd || ''))) {
        flag(`stray-pm2-child-${p.pid}`, p.pid, 'a PM2 child process that PM2 no longer lists');
      }
    }
  }
  return issues;
}

function readLockPid(root, read = (f) => fs.readFileSync(f, 'utf8')) {
  try {
    const pid = Number(JSON.parse(read(path.join(root, '.heidi-daemon.lock'))).pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function execJson(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, ...opts }, (error, stdout) => {
      if (error) return resolve(null);
      const text = String(stdout || '');
      const start = text.search(/[[{]/);
      try { resolve(start >= 0 ? JSON.parse(text.slice(start)) : null); } catch { resolve(null); }
    });
  });
}

const PS_SCRIPT = [
  "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; cmd = [string]$_.CommandLine } }",
  `$o = (Get-NetTCPConnection -LocalPort ${WEB_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
  '[pscustomobject]@{ procs = @($p); portOwner = $o } | ConvertTo-Json -Depth 4 -Compress',
].join('; ');

/** Windows only. Returns the issues, or null when the facts could not be read. */
async function collectStrays(root, { platform = process.platform, exec = execJson } = {}) {
  if (platform !== 'win32') return null;
  const [ps, jlist] = await Promise.all([
    exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { cwd: root }),
    exec('pm2.cmd', ['jlist'], { cwd: root, shell: true }),
  ]);
  if (!ps || !Array.isArray(jlist)) return null;
  const procs = (Array.isArray(ps.procs) ? ps.procs : [ps.procs]).filter(Boolean)
    .map((p) => ({ pid: Number(p.pid), ppid: Number(p.ppid), cmd: p.cmd }));
  const pm2 = jlist.map((a) => ({ name: a.name, pid: Number(a.pid), status: (a.pm2_env || {}).status }));
  return findStrays({ procs, pm2, portOwner: Number(ps.portOwner) || null, lockPid: readLockPid(root) });
}

module.exports = { findStrays, collectStrays, descendants, readLockPid, WEB_APP, DAEMON_APP };
