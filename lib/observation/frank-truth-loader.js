'use strict';

/**
 * Read-only loader for Frank production truth artifacts written by
 * scripts/frank-production-truth-collect.ps1 under .runtime/production-truth/.
 *
 * Labels: LIVE (fresh file), CACHED (stale), UNAVAILABLE (missing/error).
 * Never reads secrets — only structured JSON fields.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STALE_MS = 15 * 60 * 1000;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

function listTruthFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^frank-production-truth-.+\.json$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function newestFile(files) {
  let best = null;
  let bestMtime = 0;
  for (const file of files) {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m > bestMtime) {
        bestMtime = m;
        best = file;
      }
    } catch {
      /* skip */
    }
  }
  return best ? { file: best, mtimeMs: bestMtime } : null;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {number} [opts.now]
 * @param {number} [opts.staleMs]
 */
function loadLatestFrankProductionTruth(opts = {}) {
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const dir = path.join(root, '.runtime', 'production-truth');
  const now = opts.now || Date.now();
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;

  const newest = newestFile(listTruthFiles(dir));
  if (!newest) {
    return {
      availability: 'UNAVAILABLE',
      evidence_state: 'missing',
      error: 'no frank-production-truth-*.json in .runtime/production-truth',
      path: dir,
      collected_at: null,
      data: null,
    };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(newest.file, 'utf8'));
  } catch (error) {
    return {
      availability: 'UNAVAILABLE',
      evidence_state: 'failed',
      error: error instanceof Error ? error.message : 'parse_failed',
      path: newest.file,
      collected_at: null,
      data: null,
    };
  }

  const schema = data.schema_version;
  if (schema != null && !SUPPORTED_SCHEMA_VERSIONS.has(schema)) {
    return {
      availability: 'UNAVAILABLE',
      evidence_state: 'failed',
      error: `unsupported schema_version ${schema}`,
      path: newest.file,
      collected_at: data.collected_at || null,
      data: { schema_version: schema },
    };
  }

  const age = now - newest.mtimeMs;
  const availability = age > staleMs ? 'CACHED' : 'LIVE';
  const probes = Array.isArray(data.probes) ? data.probes : [];
  const probeSummary = probes.map((p) => ({
    name: p.name,
    ok: Boolean(p.ok),
    status: p.status,
    mode: 'LIVE',
  }));

  return {
    availability,
    evidence_state: availability === 'LIVE' ? 'fresh' : 'stale',
    path: newest.file,
    file_mtime_ms: newest.mtimeMs,
    age_ms: age,
    collected_at: data.collected_at || null,
    host: data.host || null,
    git_head: data.git_head || null,
    git_branch: data.git_branch || null,
    pm2_ok: data.pm2 && data.pm2.ok,
    resources: data.resources || null,
    tailscale: data.tailscale || null,
    auth_flags: data.auth_flags || null,
    local_ci_hint: data.local_ci_hint || null,
    probe_summary: probeSummary,
    data,
  };
}

module.exports = {
  loadLatestFrankProductionTruth,
  DEFAULT_STALE_MS,
  SUPPORTED_SCHEMA_VERSIONS,
};