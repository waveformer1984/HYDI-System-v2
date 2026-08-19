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
function resolveDocker(opts = {}) {
  const { skipDaemonCheck = false, timeoutMs = 8000 } = opts;

  // 1. Check if docker is in PATH
  let cmd = null;
  let cliPath = null;
  try {
    execSync('docker --version', { timeout: 3000, stdio: 'pipe', encoding: 'utf8' });
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

  // 2. Check if daemon is responding
  try {
    execSync(`${cmd} info --format "{{.ServerVersion}}"`, {
      timeout: timeoutMs, stdio: 'pipe', encoding: 'utf8',
    });
    return { cmd, status: 'available', path: cliPath };
  } catch {
    return { cmd, status: 'cli_only', path: cliPath };
  }
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
