'use strict';

/**
 * Phone-facing Frank host vitals derived from frank-observer evidence
 * (.observatory/current.json via buildFrankSnapshot). Read-only file I/O —
 * no extra collectors or background processes.
 */

const fs = require('fs');
const path = require('path');
const { buildFrankSnapshot, STALE_MS } = require('../observation/frank-snapshot');

const DISK_C_MIN_GB = 5;
const MEM_FREE_MIN_GB = 1;

function readObservatoryTs(root) {
  try {
    const raw = fs.readFileSync(path.join(root, '.observatory', 'current.json'), 'utf8').replace(/^﻿/, '');
    const obs = JSON.parse(raw);
    return typeof obs.ts === 'string' ? obs.ts : null;
  } catch {
    return null;
  }
}

function classifyProbe(probes, key, stale) {
  if (stale) return { state: 'stale', detail: 'observatory sample stale' };
  if (!probes || typeof probes !== 'object') return { state: 'unknown', detail: 'no probe data' };
  const v = probes[key];
  if (v === true) return { state: 'healthy', detail: null };
  if (v === false) return { state: 'unhealthy', detail: 'TCP probe failed' };
  return { state: 'unknown', detail: 'probe not recorded' };
}

/**
 * @param {{ root?: string, now?: number, buildFrankSnapshot?: typeof buildFrankSnapshot }} [opts]
 */
function buildFrankHostHealth(opts = {}) {
  const root = opts.root || process.cwd();
  const now = opts.now ?? Date.now();
  const build = opts.buildFrankSnapshot || buildFrankSnapshot;
  const snapshot = build({ root, now });
  const obs = snapshot.sources.observatory;
  const stale = !obs.present || obs.stale;
  const observedAt = obs.present ? readObservatoryTs(root) : null;

  const kong = classifyProbe(snapshot.probes, 'kong_54321', stale);
  const db = classifyProbe(snapshot.probes, 'db_tcp_54322', stale);

  const metrics = {
    disk_c_free_gb: snapshot.host?.diskC?.freeGb ?? null,
    disk_c_total_gb: snapshot.host?.diskC?.totalGb ?? null,
    mem_free_gb: snapshot.host?.memFreeGb ?? null,
    mem_total_gb: snapshot.host?.memTotalGb ?? null,
    pagefile_alloc_mb: snapshot.host?.pagefile?.allocMb ?? null,
    pagefile_used_mb: snapshot.host?.pagefile?.usedMb ?? null,
    pagefile_peak_mb: snapshot.host?.pagefile?.peakMb ?? null,
    kong: kong.state,
    kong_detail: kong.detail,
    db: db.state,
    db_detail: db.detail,
  };

  const reasons = [];
  let state = 'unknown';

  if (!obs.present) {
    state = 'stale';
    reasons.push('Frank monitor has no sample (is frank-observer running?)');
  } else if (obs.stale) {
    state = 'stale';
    const mins = Math.round((obs.ageSec || 0) / 60);
    reasons.push(`Frank monitor sample is ${mins} min old (stale after ${Math.round(STALE_MS.observatory / 60000)} min)`);
  } else {
    state = 'healthy';
    if (metrics.disk_c_free_gb != null && metrics.disk_c_free_gb < DISK_C_MIN_GB) {
      state = 'degraded';
      reasons.push(`C: ${metrics.disk_c_free_gb} GB free (under ${DISK_C_MIN_GB} GB)`);
    }
    if (metrics.mem_free_gb != null && metrics.mem_free_gb < MEM_FREE_MIN_GB) {
      state = 'degraded';
      reasons.push(`RAM ${metrics.mem_free_gb} GB free (under ${MEM_FREE_MIN_GB} GB)`);
    }
    if (kong.state === 'unhealthy') {
      state = 'degraded';
      reasons.push('Supabase kong :54321 not reachable');
    } else if (kong.state === 'unknown') {
      state = 'degraded';
      reasons.push('kong health unknown (no probe in last sample)');
    }
    if (db.state === 'unhealthy') {
      state = 'degraded';
      reasons.push('Supabase Postgres :54322 not reachable');
    } else if (db.state === 'unknown') {
      state = 'degraded';
      reasons.push('db health unknown (no probe in last sample)');
    }
  }

  return {
    state,
    reasons,
    observed_at: observedAt,
    age_sec: obs.present ? obs.ageSec : null,
    stale,
    frank_level: snapshot.level,
    metrics,
  };
}

/** Degrade the phone connection banner when Frank host vitals are bad (never upgrade offline/auth states). */
function applyFrankHostToConnectionState(connectionState, frankHost) {
  const frozen = new Set(['offline', 'unconfigured', 'unauthorized', 'forbidden', 'pending_approval']);
  if (!frankHost || frozen.has(connectionState)) return connectionState;
  if (frankHost.state === 'degraded' && connectionState === 'online') return 'degraded';
  if (frankHost.state === 'stale' && connectionState === 'online') return 'degraded';
  return connectionState;
}

module.exports = {
  buildFrankHostHealth,
  applyFrankHostToConnectionState,
  DISK_C_MIN_GB,
  MEM_FREE_MIN_GB,
};