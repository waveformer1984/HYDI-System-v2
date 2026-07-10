'use strict';

/**
 * HEIDI Health Observer
 * -----------------------------------------------------------------------
 * The "watch agents, restart failures" half of the original supervisor
 * vision that nothing else in this repo actually does. The existing
 * monitoring stack (complete-monitoring.ps1 -> verify-system-health-fixed.ps1
 * / tripwire-detector.ps1 / critical-alert.ps1) only observes and alerts --
 * none of those scripts contain any restart/process-management logic
 * (confirmed by grep before writing this). Someone still has to read the
 * alert and act on it by hand.
 *
 * This closes that loop by PROPOSING, never executing directly: on a
 * debounced down-detection it writes a restart_service mission via
 * memory.createMission(), the exact same path the create_mission chat tool
 * already uses. It never calls ActionExecutor itself. Everything the
 * mission worker already enforces -- the assigned agent's permission_level,
 * isSafe(), the HEIDI_AUTONOMOUS_ACTIONS arming gate -- applies to these
 * missions exactly as it does to any other, for free. This file adds a new
 * PRODUCER of missions, not a new execution path.
 *
 * Watched modules are discovered from boot.config.json itself (type
 * "process", enabled, has a health.url) rather than hardcoded, so adding a
 * module to the boot registry automatically brings it under observation --
 * no code change needed here, matching boot.config.json's own stated design
 * principle.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DEFAULT_ASSIGNED_AGENT = 'Heidi'; // already permission_level 3 in agent_registry

function loadWatchedModules(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return (config.modules || []).filter(
    (m) => m.type === 'process' && m.enabled !== false && m.health && m.health.url
  );
}

function httpOk(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

class HealthObserver {
  /**
   * @param {HeidiMemory} memory
   * @param {object} opts { intervalMs, probeTimeoutMs, debounceFailures, cooldownMs,
   *                        assignedAgent, configPath, log }
   */
  constructor(memory, opts = {}) {
    this.memory = memory;
    this.intervalMs = opts.intervalMs || Number(process.env.HEALTH_OBSERVER_INTERVAL_MS) || 30000;
    this.probeTimeoutMs = opts.probeTimeoutMs || 4000;
    // Require this many CONSECUTIVE failed probes before declaring a module
    // down -- a single slow response must not trigger a restart (the same
    // lesson tool-registry.js's system_status already learned: an 8s
    // timeout was needed because the bridge/local Supabase can legitimately
    // take 3-5s under load).
    this.debounceFailures = opts.debounceFailures || 2;
    // Don't propose a second restart mission for the same module within
    // this window -- if the restart itself isn't fixing things, spamming
    // more missions won't help and only pollutes the queue.
    this.cooldownMs = opts.cooldownMs || 10 * 60 * 1000;
    this.assignedAgent = opts.assignedAgent || DEFAULT_ASSIGNED_AGENT;
    this.log = opts.log || console.log;

    const configPath = opts.configPath || path.join(__dirname, '../../boot.config.json');
    this.modules = loadWatchedModules(configPath);

    this.consecutiveFailures = new Map(); // id -> count
    this.lastProposedAt = new Map(); // id -> timestamp
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log(`[HEALTH OBSERVER] tick error: ${e.message}`));
    }, this.intervalMs);
    this.log(`[HEALTH OBSERVER] started (interval ${this.intervalMs}ms, watching: ${this.modules.map((m) => m.id).join(', ') || 'none'})`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    await Promise.all(this.modules.map((mod) => this.checkModule(mod)));
  }

  async checkModule(mod) {
    const up = await httpOk(mod.health.url, this.probeTimeoutMs);

    if (up) {
      this.consecutiveFailures.set(mod.id, 0);
      return;
    }

    const failures = (this.consecutiveFailures.get(mod.id) || 0) + 1;
    this.consecutiveFailures.set(mod.id, failures);

    if (failures < this.debounceFailures) {
      this.log(`[HEALTH OBSERVER] ${mod.id} probe failed (${failures}/${this.debounceFailures}, not yet acting)`);
      return;
    }

    const lastProposed = this.lastProposedAt.get(mod.id) || 0;
    if (Date.now() - lastProposed < this.cooldownMs) {
      this.log(`[HEALTH OBSERVER] ${mod.id} still down but a restart was already proposed within the cooldown window -- not proposing another`);
      return;
    }

    // The mission worker executes raw ActionExecutor action shapes, not the
    // higher-level tool names tool-registry.js's chat tools expose --
    // "restart_service" is a tool name there, translated internally to this
    // exact run_script call (see tool-registry.js's restart_service
    // handler). Mission actions must already be in ActionExecutor's shape.
    const missionId = await this.memory.createMission(
      `Auto-detected: ${mod.id} failed ${failures} consecutive health checks -- restart it`,
      2,
      { action: { type: 'run_script', target: 'scripts/restart-module.js', args: [mod.id] } },
      this.assignedAgent
    );
    this.lastProposedAt.set(mod.id, Date.now());
    this.log(`[HEALTH OBSERVER] ${mod.id} down (${failures} consecutive failures) -- proposed mission ${missionId} assigned to ${this.assignedAgent}`);
  }
}

module.exports = HealthObserver;
