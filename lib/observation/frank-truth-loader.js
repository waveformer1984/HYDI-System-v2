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
const MAX_COLLECTED_AT_SKEW_MS = 5 * 60 * 1000;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

/** Strip fields that must not leave the host (env key names, raw pm2 env). */
function redactFrankTruthPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  if (out.pm2 && typeof out.pm2 === 'object') {
    const { env_keys_sample, env_key_count, ...rest } = out.pm2;
    out.pm2 = { ...rest, env_key_count: env_key_count ?? null };
  }
  delete out.notes;
  return out;
}

function parseCollectedAtMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function validateTimestamps({ collected_at, fileMtimeMs, now, staleMs = DEFAULT_STALE_MS }) {
  const collectedMs = parseCollectedAtMs(collected_at);
  const issues = [];
  if (collectedMs == null) issues.push('missing_or_invalid_collected_at');
  if (fileMtimeMs != null && collectedMs != null) {
    const skew = Math.abs(fileMtimeMs - collectedMs);
    if (skew > MAX_COLLECTED_AT_SKEW_MS) issues.push('collected_at_file_mtime_skew');
  }
  const age = fileMtimeMs != null ? now - fileMtimeMs : null;
  if (age != null && age > staleMs) issues.push('stale_file');
  return { collectedMs, age_ms: age, issues };
}

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

  const ts = validateTimestamps({
    collected_at: data.collected_at,
    fileMtimeMs: newest.mtimeMs,
    now,
    staleMs,
  });
  const age = ts.age_ms ?? now - newest.mtimeMs;
  const availability = age > staleMs ? 'CACHED' : 'LIVE';
  const probeMode = availability;
  const probes = Array.isArray(data.probes) ? data.probes : [];
  const probeSummary = probes.map((p) => ({
    name: p.name,
    ok: Boolean(p.ok),
    status: p.status,
    mode: probeMode,
  }));

  return {
    availability,
    evidence_state: availability === 'LIVE' ? 'fresh' : 'stale',
    timestamp_issues: ts.issues,
    stale_data_warning: availability === 'CACHED',
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
    data: redactFrankTruthPayload(data),
  };
}

module.exports = {
  loadLatestFrankProductionTruth,
  redactFrankTruthPayload,
  validateTimestamps,
  DEFAULT_STALE_MS,
  MAX_COLLECTED_AT_SKEW_MS,
  SUPPORTED_SCHEMA_VERSIONS,
};