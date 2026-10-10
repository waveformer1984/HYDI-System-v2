'use strict';

/**
 * The subsystem names hydi_subsystem_status accepts (its CHECK constraint)
 * and the subset that counts toward the overall health score.
 *
 * Every KNOWN subsystem can still heartbeat. Only TRACKED ones are averaged
 * into health_score: a subsystem nothing runs or reports for (no Ursula,
 * voice or BotForge process on this host) would otherwise sit at "unknown"
 * = 0 forever and drag the score to 0 while every real service is healthy.
 *
 * Override with HYDI_TRACKED_SUBSYSTEMS="hydi_core,database,memory,ursula".
 * Unknown names are ignored; an empty or all-invalid value falls back to the
 * default.
 */

const KNOWN_SUBSYSTEMS = Object.freeze([
  'hydi_core', 'ursula', 'rave_voice', 'botforge',
  'worker_fleet', 'memory', 'database', 'deployment',
]);

// What scripts/watchdog.js actually observes on the HYDI host.
const DEFAULT_TRACKED = Object.freeze(['hydi_core', 'database', 'memory']);

function trackedSubsystems(env = process.env) {
  const raw = (env.HYDI_TRACKED_SUBSYSTEMS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const valid = [...new Set(raw.filter((s) => KNOWN_SUBSYSTEMS.includes(s)))];
  return valid.length ? valid : [...DEFAULT_TRACKED];
}

module.exports = { KNOWN_SUBSYSTEMS, DEFAULT_TRACKED, trackedSubsystems };
