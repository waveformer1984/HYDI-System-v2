'use strict';

/**
 * HEIDI Ops Agent — observe / diagnose / act(authorized) / verify / maintain.
 *
 * One persistent loop inside heidi-core (PM2-supervised). It does NOT carry
 * its own execution path: every repair is a mission created through
 * memory.createMission() — the same path the create_mission chat tool and
 * health-observer use — so the existing approval gate, isSafe(), command
 * table, deadline/cleanup and terminal persistence all apply unmodified.
 *
 * Modes (ops_control.mode, default 'observe'):
 *   observe          — detect, record, report. Never proposes a repair.
 *   approval_required — diagnoses, then proposes the runbook mission and
 *                        leaves it awaiting_approval for a human.
 *
 * Repairs are missions, not direct calls — a prior mission approval never
 * authorizes a new repair: each incident gets its own proposal.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const OpsStore = require('./ops-store');

const RESTART_MODULE_SCRIPT = path.join(__dirname, '../../scripts/restart-module.js');
const FIXTURE_SERVER_SCRIPT = path.join(__dirname, '../../scripts/fixtures/ops-fixture-server.js');
const FIXTURE_RESTART_SCRIPT = path.join(__dirname, '../../scripts/fixtures/ops-fixture-restart.js');

// --- Policy table (the ACT contract) -------------------------------------
// observe_only  : always allowed — probes, mission reads, status files.
// approval      : create a mission for the runbook — lands awaiting_approval.
// prohibited    : never — image-name kills, reboot, config/secret/env edits,
//                 deploys, self-permission edits, bypassing approvals.
const RUNBOOKS = {
  restart_module: {
    authClass: 'approval',
    action: (inc) => ({ type: 'run_script', target: RESTART_MODULE_SCRIPT, args: [inc.component] }),
    // A restart mission this module already has in-flight (any producer —
    // health-observer, a human, an earlier pass) owns the repair.
    inFlight: (missions, inc) => missions.find((m) => {
      const ctx = safeJson(m.context);
      return ctx && ctx.action && ctx.action.type === 'run_script' &&
        ctx.action.args && ctx.action.args[0] === inc.component &&
        ['queued', 'planning', 'awaiting_approval', 'running', 'verifying'].includes(m.status);
    }),
  },
  fixture_restart: {
    authClass: 'approval',
    action: () => ({ type: 'run_script', target: FIXTURE_RESTART_SCRIPT, args: [] }),
    inFlight: (missions) => missions.find((m) => {
      const ctx = safeJson(m.context);
      return ctx && ctx.action && ctx.action.target === FIXTURE_RESTART_SCRIPT &&
        ['queued', 'planning', 'awaiting_approval', 'running', 'verifying'].includes(m.status);
    }),
  },
};

function safeJson(s) { try { return s && typeof s === 'string' ? JSON.parse(s) : s || null; } catch { return null; } }

function httpProbe(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500 ? 'up' : 'down');
    });
    req.on('timeout', () => { req.destroy(); resolve('down'); });
    req.on('error', () => resolve('down'));
  });
}

function loadWatchedModules(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return (config.modules || []).filter(
      (m) => m.type === 'process' && m.enabled !== false && m.health && m.health.url
    ).map((m) => ({ id: m.id, healthUrl: m.health.url }));
  } catch { return []; }
}

class OpsAgent {
  /**
   * @param {HeidiMemory} memory
   * @param {ActionExecutor} actions  — read-only use: isSafe() checks only.
   * @param {object} opts { intervalMs, probeTimeoutMs, debounceFailures, leaseTtlMs,
   *                        repairBudgetPerHour, circuitThreshold, configPath,
   *                        extraModules, mode, log }
   */
  constructor(memory, actions, opts = {}) {
    this.memory = memory;
    this.actions = actions;
    this.intervalMs = opts.intervalMs || 30000;
    this.probeTimeoutMs = opts.probeTimeoutMs || 4000;
    this.debounceFailures = opts.debounceFailures || 3;
    this.leaseTtlMs = opts.leaseTtlMs || 60000;
    this.repairBudgetPerHour = opts.repairBudgetPerHour || 3;
    this.circuitThreshold = opts.circuitThreshold || 3;
    this.log = opts.log || console.log;
    this.instanceId = `ops-agent@${process.pid}`;
    this.mode = opts.mode || process.env.HEIDI_OPS_MODE || 'observe';

    const configPath = opts.configPath || path.join(__dirname, '../../boot.config.json');
    this.modules = loadWatchedModules(configPath).concat(opts.extraModules || []);
    this.probeFn = opts.probeFn || httpProbe;

    this.failStreak = new Map();       // component -> consecutive down probes
    this.consecutiveRepairFails = 0;
    this.timer = null;
    this.recovered = false;
    this.store = new OpsStore(memory);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log(`[OPS AGENT] tick error: ${e.message}`));
    }, this.intervalMs);
    this.log(`[OPS AGENT] started (interval ${this.intervalMs}ms, mode: ${this.mode}, watching: ${this.modules.map((m) => m.id).join(', ') || 'none'})`);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async paused() { return (await this.store.getControl('paused')) === '1'; }

  /** Boot recovery: reconcile incidents left mid-action — never blind-replay. */
  async recover() {
    this.recovered = true;
    const open = await this.store.incidents(['proposed', 'repairing', 'verifying'], 100);
    for (const inc of open) {
      const m = inc.mission_id ? await this.memory.getMission(inc.mission_id) : null;
      if (!m) {
        await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: 'repair mission missing after restart — outcome unknown, not replaying' },
          { kind: 'reconciled', reason: 'restart: mission not found, escalated rather than replayed' });
        continue;
      }
      if (['queued', 'planning', 'awaiting_approval'].includes(m.status)) {
        await this.store.updateIncident(inc.id, { state: 'proposed' },
          { kind: 'reconciled', reason: `restart: repair mission ${m.id} still ${m.status}` });
      } else if (m.status === 'completed') {
        await this.store.updateIncident(inc.id, { state: 'verifying' },
          { kind: 'reconciled', reason: `restart: repair mission ${m.id} completed, verification pending` });
      } else if (['failed', 'cancelled', 'blocked'].includes(m.status)) {
        await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: `repair mission ${m.id} ${m.status} — not retrying without a fresh diagnosis` },
          { kind: 'reconciled', reason: `restart: repair mission ${m.id} ${m.status}` });
      } else {
        // running/verifying — still in flight, just keep tracking it.
        await this.store.updateIncident(inc.id, { state: 'repairing' },
          { kind: 'reconciled', reason: `restart: repair mission ${m.id} still ${m.status}` });
      }
    }
    this.log(`[OPS AGENT] recover() reconciled ${open.length} open incident(s)`);
  }

  async tick() {
    const observations = await this.observe();
    await this.reconcile(observations);
    await this.trackRepairs();
    if (!(await this.paused())) await this.act();
    else this.log('[OPS AGENT] paused — observing only');
  }

  async observe() {
    const out = [];
    for (const mod of this.modules) {
      const up = await this.probeFn(mod.healthUrl, this.probeTimeoutMs);
      out.push({ component: mod.id, kind: 'module_down', up: up === 'up', url: mod.healthUrl });
    }
    // Stalled missions: 'running' far past their deadline (post-#508 these
    // should not exist — flagging one is honest observation, not repair).
    const running = await this.memory.getMissions('running', 100);
    for (const m of running || []) {
      const ctx = safeJson(m.context) || {};
      const deadline = ctx.action && ctx.action.timeout_ms;
      if (deadline && m.started_at && Date.now() - new Date(m.started_at).getTime() > deadline + 120000) {
        out.push({ component: `mission:${m.id}`, kind: 'stalled_mission', up: false, mission: m.id });
      }
    }
    return out;
  }

  async reconcile(observations) {
    for (const o of observations) {
      if (o.up) {
        this.failStreak.set(o.component, 0);
        // healthy again -> resolve any open incident for this signature.
        const inc = await this.store.openIncidentFor(`${o.component}:${o.kind}`);
        // A healthy probe ends the incident no matter how it got there —
        // escalated included: "self-recovered" is the honest resolution.
        if (inc && ['open', 'diagnosed', 'escalated'].includes(inc.state)) {
          await this.store.updateIncident(inc.id, { state: 'resolved', resolved_at: new Date().toISOString(), result: { recovery: 'self-recovered before any repair', verified: true } },
            { kind: 'resolved', reason: 'component healthy again without repair' });
        }
        continue;
      }
      const n = (this.failStreak.get(o.component) || 0) + 1;
      this.failStreak.set(o.component, n);
      if (n < this.debounceFailures) continue;
      const signature = `${o.component}:${o.kind}`;
      const existing = await this.store.openIncidentFor(signature);
      if (existing) continue; // duplicate event — same incident, counted by its events.
      const id = randomUUID().slice(0, 12);
      await this.store.openIncident({
        id, signature, component: o.component, kind: o.kind, mode: this.mode,
        observation: { url: o.url || null, consecutiveFailures: n, mission: o.mission || null, at: new Date().toISOString() },
      });
      this.log(`[OPS AGENT] incident ${id}: ${o.component} ${o.kind} (${n} consecutive failures)`);
      await this.diagnose(id, o);
    }
  }

  async diagnose(id, observation) {
    const inc = await this.store.getIncident(id);
    if (!inc || inc.state !== 'open') return;
    // Confirmed facts vs hypothesis — the observation is fact; the cause is hypothesis.
    const runbook = observation.kind === 'module_down' ? 'restart_module'
      : observation.kind === 'stalled_mission' ? null : null;
    await this.store.updateIncident(id, {
      state: 'diagnosed',
      confirmed: 1,
      diagnosis: { fact: `${observation.component} unreachable ${observation.consecutiveFailures || this.debounceFailures}+ consecutive probes`, impact: `${observation.component} unavailable to users` },
      hypothesis: observation.kind === 'module_down' ? 'process may have exited or wedged; a bounded restart is the first runbook' : 'mission exceeded deadline + sweep grace; settlement may have failed',
      runbook,
    }, { kind: 'diagnosed', reason: 'observation confirmed; cause remains hypothesis' });
  }

  async act() {
    const needs = await this.store.incidents(['diagnosed'], 50);
    for (const inc of needs) {
      if (!inc.runbook) {
        // No repair path — escalate honestly rather than acting blind.
        await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: inc.hypothesis },
          { kind: 'escalated', reason: 'no runbook for this kind — needs a human' });
        continue;
      }
      if (this.mode === 'observe') {
        await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: `mode=observe: runbook ${inc.runbook} identified but not proposed` },
          { kind: 'escalated', reason: 'observe-only mode — repair identified, not proposed' });
        continue;
      }
      await this.proposeRepair(inc);
    }
  }

  async proposeRepair(inc) {
    const rb = RUNBOOKS[inc.runbook];
    if (!rb) {
      await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: `runbook '${inc.runbook}' not registered` },
        { kind: 'escalated', reason: 'unknown runbook' });
      return;
    }

    // Circuit breaker — a run of failed repairs means stop and escalate.
    if (this.consecutiveRepairFails >= this.circuitThreshold) {
      await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: 'circuit breaker open: repeated repair failures' },
        { kind: 'escalated', reason: `circuit breaker open (${this.consecutiveRepairFails} consecutive repair failures)` });
      return;
    }

    // Per-hour repair budget — durable count from events, survives restart.
    const anHourAgo = Date.now() - 3600000;
    const recent = await this.store.recentEvents(500);
    const proposed = recent.filter((e) => e.kind === 'repair_proposed' && new Date(e.at).getTime() > anHourAgo).length;
    if (proposed >= this.repairBudgetPerHour) {
      await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: `repair budget exhausted (${proposed}/${this.repairBudgetPerHour} this hour)` },
        { kind: 'escalated', reason: 'repair budget exhausted for this hour' });
      return;
    }

    // Lease — one owner per incident, fenced by generation.
    const lease = await this.store.claimLease(`incident:${inc.id}`, this.instanceId, this.leaseTtlMs);
    if (!lease) {
      await this.store.updateIncident(inc.id, { state: 'escalated', hypothesis: 'another ops-agent owner holds the lease' },
        { kind: 'escalated', reason: 'lease held by another live owner' });
      return;
    }

    // Another producer may already own the repair — check in-flight missions.
    const missions = await this.memory.getMissions(['queued', 'planning', 'awaiting_approval', 'running', 'verifying'], 200);
    const inFlight = rb.inFlight(missions || [], inc);
    if (inFlight) {
      await this.store.updateIncident(inc.id, { state: 'repairing', mission_id: inFlight.id, owner: this.instanceId,
        authorization: { basis: 'existing_mission', mission_id: inFlight.id, note: 'another producer already owns this repair — tracking, not duplicating' } },
        { kind: 'repair_delegated', reason: `existing mission ${inFlight.id} already owns the repair` });
      await this.store.releaseLease(lease.resource, this.instanceId, lease.generation);
      return;
    }

    if (!(await this.store.verifyLease(lease.resource, this.instanceId, lease.generation))) return; // fenced

    const action = rb.action(inc);
    const missionId = await this.memory.createMission(
      `ops-agent: ${inc.component} ${inc.kind} — ${inc.runbook} (incident ${inc.id})`,
      2,
      { action, ops_incident: inc.id },
      'Heidi',
      { actor: 'ops-agent', reason: `incident ${inc.id}: ${inc.component} ${inc.kind}` }
    );
    await this.store.updateIncident(inc.id, {
      state: 'proposed', mission_id: missionId, owner: this.instanceId, attempts: (inc.attempts || 0) + 1,
      authorization: { basis: 'approval_required', runbook: inc.runbook, mission_id: missionId, note: 'awaits human task approve — a prior approval never applies to a new incident' },
    }, { kind: 'repair_proposed', reason: `proposed mission ${missionId} (${inc.runbook}) — awaiting human approval` });
    await this.store.releaseLease(lease.resource, this.instanceId, lease.generation);
    this.log(`[OPS AGENT] incident ${inc.id}: proposed mission ${missionId} (${inc.runbook})`);
  }

  async trackRepairs() {
    const tracked = await this.store.incidents(['proposed', 'repairing', 'verifying'], 50);
    for (const inc of tracked) {
      const m = inc.mission_id ? await this.memory.getMission(inc.mission_id) : null;
      if (!m) continue;
      if (m.status === 'running' && inc.state !== 'repairing') {
        await this.store.updateIncident(inc.id, { state: 'repairing' }, { kind: 'repair_started', reason: `mission ${m.id} running` });
      } else if (m.status === 'completed') {
        // The mission's own verification passed — re-probe the component for
        // the agent's independent check before resolving.
        const healthy = await this.verifyRecovered(inc);
        if (healthy) {
          this.consecutiveRepairFails = 0;
          await this.store.updateIncident(inc.id, { state: 'resolved', resolved_at: new Date().toISOString(),
            result: { mission_id: m.id, mission_verified: true, agent_verified: true } },
            { kind: 'resolved', reason: `repair mission ${m.id} completed and component re-probed healthy` });
        } else {
          this.consecutiveRepairFails += 1;
          await this.store.updateIncident(inc.id, { state: 'escalated',
            hypothesis: `mission ${m.id} completed but the component still fails its health probe — repair did not recover it` },
            { kind: 'escalated', reason: 'repair completed but recovery verification failed' });
        }
      } else if (['failed', 'cancelled', 'blocked'].includes(m.status)) {
        this.consecutiveRepairFails += 1;
        await this.store.updateIncident(inc.id, { state: 'escalated',
          hypothesis: `repair mission ${m.id} ${m.status} — not retrying without a fresh diagnosis` },
          { kind: 'escalated', reason: `repair mission ${m.id} ${m.status}` });
      }
      // queued/awaiting_approval → still waiting on a human — not an error.
    }
  }

  /** Independent recovery check — re-probe, never take the mission's word. */
  async verifyRecovered(inc) {
    const mod = this.modules.find((x) => x.id === inc.component);
    if (!mod) return null; // unknown — can't verify a component we don't watch
    return (await this.probeFn(mod.healthUrl, this.probeTimeoutMs)) === 'up';
  }

  async status() {
    const open = await this.store.incidents(['open', 'diagnosed', 'proposed', 'repairing', 'verifying', 'escalated'], 100);
    return {
      mode: await this.store.getControl('mode') || this.mode,
      paused: await this.paused(),
      watching: this.modules.map((m) => m.id),
      openIncidents: open.length,
      incidents: open,
      consecutiveRepairFails: this.consecutiveRepairFails,
      circuitOpen: this.consecutiveRepairFails >= this.circuitThreshold,
    };
  }
}

module.exports = OpsAgent;
