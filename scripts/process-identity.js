'use strict';
/**
 * Process identity primitives — read-only, cross-platform PID/ancestry
 * inspection shared by anything that needs to answer "who actually owns this
 * port?" rather than just "does something answer on it?".
 * ---------------------------------------------------------------------------
 * The defect this exists to close (found by the 2026-09-10 runtime truth
 * sweep, root-caused in the follow-up investigation):
 *
 *   boot-agent.js classified protoforge-core:3005 as `external: true` (safe,
 *   already running, leave it alone) purely because the port was occupied
 *   and its /health endpoint returned 200. It never checked WHICH process
 *   was answering, never captured a PID, and therefore could never detect
 *   that the original supervised process (PID 4568) had exited and been
 *   silently replaced by an unrelated orphan (a `node src/server.js` child
 *   spawned by a since-exited Jest process, PID 25324) that happens to
 *   implement the identical service and so answers the identical health
 *   check. "Healthy" and "owned by HYDI's own supervisor" are different
 *   facts; this module lets a caller check both.
 *
 * Every function here is read-only: it inspects processes, it never spawns,
 * kills, or signals one. That is a deliberate boundary — this module answers
 * "what is true right now", the decision about what to DO with that answer
 * belongs to the caller (boot-agent.js, HealthProvenanceChecker.ts, ...).
 *
 * Windows uses `netstat -ano` (port -> PID) and a single Get-CimInstance
 * query (PID -> name/commandline/parent PID) — one process-info call instead
 * of the two separate `Get-Process` + `Get-CimInstance` calls some earlier
 * copies of this logic used, since Win32_Process alone carries everything
 * needed (Name, CommandLine, ParentProcessId). POSIX uses `lsof`/`ps`.
 * ---------------------------------------------------------------------------
 */

const { execSync } = require('child_process');

/** PIDs currently LISTENING on `port`. Empty array if none (never throws). */
function findPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Identity + lineage of a single PID.
 * Returns `{ pid, name, cmdline, ppid }`. `ppid` is a string PID or null when
 * it could not be determined (process already exited, permission denied, or
 * platform doesn't expose it cheaply). Never throws — an unresolvable PID
 * comes back as `{ pid, name: null, cmdline: null, ppid: null }`, which
 * callers must treat as "unknown", not as a pass or a fail.
 */
function getProcessInfo(pid) {
  try {
    if (process.platform === 'win32') {
      // One Win32_Process query carries Name, CommandLine and ParentProcessId
      // together, so identity and lineage come from a single consistent
      // snapshot instead of two calls that could straddle a process exit.
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessName,CommandLine,ParentProcessId | ConvertTo-Json -Compress"`,
        { encoding: 'utf8', timeout: 5000 },
      ).trim();
      if (!out) return { pid, name: null, cmdline: null, ppid: null };
      const parsed = JSON.parse(out);
      const row = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!row) return { pid, name: null, cmdline: null, ppid: null };
      return {
        pid,
        name: row.ProcessName || null,
        cmdline: row.CommandLine || row.ProcessName || null,
        ppid: row.ParentProcessId != null ? String(row.ParentProcessId) : null,
      };
    }
    const out = execSync(`ps -p ${pid} -o comm=,ppid=,args=`, { encoding: 'utf8', timeout: 5000 }).trim();
    if (!out) return { pid, name: null, cmdline: null, ppid: null };
    const m = /^(\S+)\s+(\d+)\s+(.*)$/.exec(out);
    if (!m) return { pid, name: out, cmdline: out, ppid: null };
    return { pid, name: m[1], cmdline: m[3] || m[1], ppid: m[2] };
  } catch {
    return { pid, name: null, cmdline: null, ppid: null };
  }
}

/**
 * Walk `pid`'s parent chain looking for `ancestorPid`. Returns true only on
 * an unbroken chain that actually reaches it. `maxHops` bounds the walk
 * (shell-wrapped spawns are typically 1-2 hops; 8 is generous headroom).
 *
 * A `false` result means "not confirmed", not "confirmed absent" — a broken
 * link (a hop whose PID has already exited, or a permission failure) stops
 * the walk and returns false the same as a chain that genuinely never
 * reaches the ancestor. Callers must not read false as proof of a different
 * owner; it only proves this owner could not be established from what is
 * observable right now.
 */
function isDescendantOf(pid, ancestorPid, maxHops = 8) {
  if (String(pid) === String(ancestorPid)) return true;
  let current = String(pid);
  const seen = new Set();
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (seen.has(current)) return false; // cycle guard (should not happen, but never loop forever)
    seen.add(current);
    const info = getProcessInfo(current);
    if (!info.ppid) return false; // chain ended without reaching the ancestor
    if (info.ppid === String(ancestorPid)) return true;
    current = info.ppid;
  }
  return false;
}

module.exports = { findPidsOnPort, getProcessInfo, isDescendantOf };
