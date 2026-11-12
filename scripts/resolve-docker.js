'use strict';
/**
 * HYDI Docker Resolver — Shared Docker CLI discovery
 *
 * Three components need to invoke Docker:
 *   - scripts/watchdog.js       (container health checks)
 *   - scripts/hydi-doctor.js    (daemon + container checks)
 *   - lib/operational/RecoveryEngine.ts (container restart)
 *
 * Previously each had its own discovery logic:
 *   - doctor: bare `docker info` with 5s timeout, no PATH fallback
 *   - watchdog: `docker version` then fallback to Program Files paths
 *   - RecoveryEngine: bare `docker restart` with no fallback at all
 *
 * This module provides a single `resolveDocker()` function that:
 *   1. Checks if `docker` is in PATH (fast path)
 *   2. Falls back to common Windows install locations
 *   3. Returns { cmd, status } where status is one of:
 *      - 'available'   — Docker CLI found and daemon responding
 *      - 'cli_only'    — CLI found but daemon not responding
 *      - 'unavailable' — CLI not found
 *
 * The daemon check is optional (skipDaemonCheck=true) for callers that
 * only need the CLI path (e.g. RecoveryEngine already has its own timeout).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROBE_LOCK = '.runtime/docker-daemon-probe.lock';
const PROBE_STATUS = '.runtime/docker-daemon-status.json';
const PROBE_STALE_MS = 15000;
const LAST_STATUS_TTL_MS = 30000;

const WINDOWS_DOCKER_PATHS = [
  'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker',
  'C:\\Program Files (x86)\\Docker\\Docker\\resources\\bin\\docker.exe',
];

/**
 * Resolve the Docker CLI command and daemon status.
 *
 * @param {object} opts
 * @param {boolean} opts.skipDaemonCheck — if true, don't probe daemon (just find CLI)
 * @param {number} opts.timeoutMs — timeout for daemon check (default 8000)
 * @returns {{ cmd: string|null, status: 'available'|'cli_only'|'unavailable', path: string|null }}
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Single-flight daemon probe. When the Docker daemon wedges, every PM2 app
 * that probes it used to pile up its own hung `docker info` child (~80
 * accumulated on 2026-11-11). Now: the first caller takes
 * .runtime/docker-daemon-probe.lock; concurrent callers skip the probe and
 * reuse the last recorded status (≤30s old) or report cli_only. A lock held
 * by a dead PID or older than PROBE_STALE_MS is reclaimed.
 */
function probeDaemon(root, cmd, timeoutMs) {
  const runtimeDir = path.join(root, '.runtime');
  const lockFile = path.join(runtimeDir, 'docker-daemon-probe.lock');
  const statusFile = path.join(runtimeDir, 'docker-daemon-status.json');

  let holder = null;
  try { holder = readJson(lockFile); } catch { /* absent/corrupt */ }
  const holderLive = holder && pidAlive(holder.pid);
  const holderFresh = holder && holder.at && (Date.now() - Date.parse(holder.at)) < PROBE_STALE_MS;

  if (holderLive && holderFresh) {
    const last = readJson(statusFile);
    if (last && last.at && (Date.now() - Date.parse(last.at)) < LAST_STATUS_TTL_MS) {
      return last.status === 'available'
        ? { cmd, status: 'available', path: last.path || cmd }
        : { cmd, status: 'cli_only', path: last.path || cmd };
    }
    return { cmd, status: 'cli_only', path: cmd };
  }

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const tmp = `${lockFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.renameSync(tmp, lockFile);
  } catch { /* lock is best-effort; probe anyway */ }

  let status = 'cli_only';
  try {
    execSync(`${cmd} info --format "{{.ServerVersion}}"`, {
      timeout: timeoutMs, stdio: 'pipe', encoding: 'utf8', windowsHide: true,
    });
    status = 'available';
  } catch { /* daemon not responding */ }

  try {
    const tmp = `${statusFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ status, path: cmd === 'docker' ? 'docker (in PATH)' : cmd, at: new Date().toISOString() }));
    fs.renameSync(tmp, statusFile);
    fs.rmSync(lockFile, { force: true });
  } catch { /* best effort */ }

  return { cmd, status, path: status === 'available' ? (cmd === 'docker' ? 'docker (in PATH)' : cmd) : cmd };
}

function resolveDocker(opts = {}) {
  const { skipDaemonCheck = false, timeoutMs = 5000 } = opts;

  // 1. Check if docker is in PATH
  let cmd = null;
  let cliPath = null;
  try {
    execSync('docker --version', { timeout: 3000, stdio: 'pipe', encoding: 'utf8', windowsHide: true });
    cmd = 'docker';
    cliPath = 'docker (in PATH)';
  } catch {
    // Not in PATH, try Windows install locations
    if (process.platform === 'win32') {
      for (const p of WINDOWS_DOCKER_PATHS) {
        if (fs.existsSync(p)) {
          cmd = `"${p}"`;
          cliPath = p;
          break;
        }
      }
    }
  }

  if (!cmd) {
    return { cmd: null, status: 'unavailable', path: null };
  }

  if (skipDaemonCheck) {
    return { cmd, status: 'available', path: cliPath };
  }

  // 2. Check if daemon is responding (single-flight, ≤timeoutMs)
  const root = path.resolve(__dirname, '..');
  return probeDaemon(root, cmd, timeoutMs);
}

/**
 * Get the Docker command for use in exec/execSync.
 * Returns null if Docker is not available.
 * Caches the result for 60 seconds to avoid repeated probes.
 */
let cachedResult = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60000;

function getDockerCmd() {
  const now = Date.now();
  if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }
  const result = resolveDocker({ skipDaemonCheck: false });
  cachedResult = result.status === 'available' ? result.cmd : null;
  cachedAt = now;
  return cachedResult;
}

/** Clear the cache (for tests). */
function clearCache() {
  cachedResult = null;
  cachedAt = 0;
}

module.exports = { resolveDocker, getDockerCmd, clearCache };
