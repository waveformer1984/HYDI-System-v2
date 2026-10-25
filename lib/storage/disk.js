'use strict';

/**
 * Disk space levels shared by the storage guard, the auto-deploy gate and
 * local CI. One definition, so every caller agrees on what "low" means.
 *
 *   OK        free >= WATCH floor
 *   WATCH     free <  HYDI_DISK_WATCH_GB    (default 20)
 *   LOW       free <  HYDI_DISK_LOW_GB      (default 10)
 *   CRITICAL  free <  HYDI_DISK_CRITICAL_GB (default 5)
 *   UNKNOWN   statfs failed. Never treated as OK.
 */

const fs = require('fs');
const path = require('path');

const GIB = 1024 ** 3;
const LEVELS = Object.freeze(['OK', 'WATCH', 'LOW', 'CRITICAL']);

function numberEnv(env, name, fallback) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Free space disk-hungry work needs before it starts. */
function gateFloors(env = process.env) {
  return {
    deployGb: numberEnv(env, 'HYDI_DEPLOY_MIN_FREE_GB', 5),
    localCiGb: numberEnv(env, 'LOCAL_CI_MIN_FREE_GB', 8),
  };
}

function thresholds(env = process.env) {
  return {
    watchGb: numberEnv(env, 'HYDI_DISK_WATCH_GB', 20),
    lowGb: numberEnv(env, 'HYDI_DISK_LOW_GB', 10),
    criticalGb: numberEnv(env, 'HYDI_DISK_CRITICAL_GB', 5),
  };
}

/** The volume the repo lives on (C:\ on Frank, / elsewhere). */
function defaultVolume(root = path.resolve(__dirname, '..', '..')) {
  return path.parse(path.resolve(root)).root;
}

/** @returns {{ freeBytes: number, totalBytes: number } | null} */
function measure(volume = defaultVolume(), statfs = fs.statfsSync) {
  try {
    const s = statfs(volume);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

function levelFor(freeBytes, env = process.env) {
  if (typeof freeBytes !== 'number' || !Number.isFinite(freeBytes)) return 'UNKNOWN';
  const t = thresholds(env);
  const gb = freeBytes / GIB;
  if (gb < t.criticalGb) return 'CRITICAL';
  if (gb < t.lowGb) return 'LOW';
  if (gb < t.watchGb) return 'WATCH';
  return 'OK';
}

/** Higher is worse. UNKNOWN ranks with LOW: it must not read as healthy. */
function severity(level) {
  if (level === 'UNKNOWN') return 2;
  const i = LEVELS.indexOf(level);
  return i < 0 ? 2 : i;
}

function gb(bytes) {
  return Math.round((bytes / GIB) * 10) / 10;
}

/**
 * Preflight for disk-hungry work (builds, npm ci, test runs).
 * Fails closed: an unreadable disk refuses.
 */
function preflight({ minFreeGb, volume, statfs } = {}) {
  const m = measure(volume || defaultVolume(), statfs);
  if (!m) return { ok: false, freeGb: null, reason: 'free space unreadable' };
  const freeGb = gb(m.freeBytes);
  if (m.freeBytes < minFreeGb * GIB) {
    return { ok: false, freeGb, reason: `only ${freeGb} GB free, needs ${minFreeGb} GB` };
  }
  return { ok: true, freeGb, reason: 'ok' };
}

module.exports = { GIB, LEVELS, thresholds, gateFloors, defaultVolume, measure, levelFor, severity, gb, preflight };
