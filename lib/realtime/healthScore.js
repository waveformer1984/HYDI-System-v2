'use strict';

/**
 * Pure health-score computation shared by api/status/system.js (snapshot)
 * and api/heartbeat.js (per-write recompute before persisting). Kept
 * dependency-free so it's trivial to unit test without a database.
 */

const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // no heartbeat in 2 min -> offline (matches WorkerOrchestrator's existing stale-worker threshold)
const DEGRADED_THRESHOLD_MS = 60 * 1000; // no heartbeat in 60s -> degraded, even if last-reported status was healthy

const STATUS_SCORE = { healthy: 100, degraded: 60, critical: 20, offline: 0, unknown: 0 };

/**
 * @param {{status?: string, last_heartbeat?: string|number|Date}} row  a hydi_subsystem_status row, or null if the subsystem has never reported
 * @param {number} [now]  injectable for tests
 */
function computeSubsystemHealth(row, now = Date.now()) {
  if (!row || !row.last_heartbeat) {
    return { status: 'unknown', health_score: 0 };
  }

  const age = now - new Date(row.last_heartbeat).getTime();

  if (age > OFFLINE_THRESHOLD_MS) {
    return { status: 'offline', health_score: 0 };
  }
  if (row.status === 'critical') {
    return { status: 'critical', health_score: STATUS_SCORE.critical };
  }
  if (row.status === 'degraded' || age > DEGRADED_THRESHOLD_MS) {
    return { status: 'degraded', health_score: STATUS_SCORE.degraded };
  }
  if (row.status === 'healthy') {
    return { status: 'healthy', health_score: STATUS_SCORE.healthy };
  }
  return { status: row.status || 'unknown', health_score: STATUS_SCORE[row.status] ?? 0 };
}

/** Overall HYDI health score: unweighted mean across every tracked subsystem. */
function computeOverallHealth(subsystemHealthMap) {
  const scores = Object.values(subsystemHealthMap).map((s) => s.health_score);
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

module.exports = { computeSubsystemHealth, computeOverallHealth, OFFLINE_THRESHOLD_MS, DEGRADED_THRESHOLD_MS };
