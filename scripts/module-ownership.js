'use strict';
/**
 * Canonical ownership model for boot-managed services.
 * ---------------------------------------------------------------------------
 * A module can be supervised by exactly one authority:
 *
 *   supervisor: 'boot-agent'  (default) -- boot-agent spawns it and owns
 *     the exit handler. protoforge-core, heidi-mobile-chat, etc.
 *
 *   supervisor: 'pm2'  -- PM2 owns the process under a possibly different
 *     app name (mod.supervisedAs). boot-agent NEVER spawns it: the process
 *     is provisioned outside the boot tree (pm2 start + pm2 save), and a
 *     boot-agent spawn would either EADDRINUSE or silently double the
 *     service. Boot still verifies the port is healthy so 'up' remains
 *     evidence-based.
 *
 * Live motivation (measured 2026-09-27): port 3000 is owned by PM2 app
 * 'heidi-web-standalone'. boot.config's 'heidi-web' module hit "port
 * occupied by UNSUPERVISED process" on every boot -- correctly detected,
 * but phrased as an anomaly because nothing declared the ownership.
 * Meanwhile RecoveryEngine's fallback path taskkilled the PM2 child on
 * port-kill, and PM2 autorestarted it: kill+resurrect was the observed
 * SIGINT churn. Declaring supervisor:'pm2' in boot.config closes the
 * spawn attempt and names the real owner.
 */

/** Returns 'pm2' | 'boot-agent'. Unspecified = boot-agent (historic default). */
function moduleSupervisor(mod) {
  return mod && mod.supervisor === 'pm2' ? 'pm2' : 'boot-agent';
}

/** Whether boot-agent is forbidden from spawning this module. */
function isExternallySupervised(mod) {
  return moduleSupervisor(mod) !== 'boot-agent';
}

/** PM2 app name for an externally-supervised module, or null. */
function supervisedAs(mod) {
  return mod && mod.supervisor === 'pm2' ? (mod.supervisedAs || mod.id) : null;
}

module.exports = { moduleSupervisor, isExternallySupervised, supervisedAs };
