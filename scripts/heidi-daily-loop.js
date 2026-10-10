#!/usr/bin/env node
'use strict';
/**
 * HEIDI DAILY LOOP
 * ----------------------------------------------------------------------------
 * The operator-facing companion to hydi-watchdog: observes the system through
 * the canonical ProtoForge MCP read tools, pushes a morning brief to the
 * paired phone, and raises approval alerts. Runs as its own supervised
 * process (PM2 or a Scheduled Task calling --once).
 *
 * Why this does NOT recover anything itself
 * -----------------------------------------
 * hydi-watchdog already owns the governed recovery path: it probes every core
 * service, classifies observations through hysteresis, and dispatches
 * RecoveryEngine with locks, budgets and escalation. A second process
 * restarting services would be an unauthorized parallel authority — the exact
 * shape HYDI_AUTONOMY_BOUNDARIES.md forbids. So on degraded health this loop
 * only escalates: a persistent outage the watchdog cannot fix becomes a
 * notification for the human, never a pm2/docker call from here.
 *
 * What one tick does:
 *   1. system_health   — canonical per-service probe via MCP. Logged; a run of
 *      >= DEGRADED_ESCALATE_TICKS consecutive not-all-up ticks escalates one
 *      'worker_failure' notification (deduped until recovery).
 *   2. pending_approvals — diffs action ids against the alerted set in the
 *      state file; only NEW pending actions push an 'approval_required'
 *      notification, so the phone isn't re-alerted every 15 minutes.
 *   3. morning brief   — at 08:00 America/Chicago (once per CT date), one
 *      'document_generated' notification with health, per-stream revenue and
 *      pending-approval count, built from mobile_status + pending_approvals.
 *
 * Write authority: this process writes ONLY notifications rows + its own
 * state file. It performs no exec, no restarts, no external sends beyond the
 * existing push_subscriptions/notifications path. HEIDI_ALLOW_EXEC is not
 * read here — nothing in this loop is behind it because nothing here acts.
 *
 * Modes:
 *   node scripts/heidi-daily-loop.js          # long-running, ticks on interval
 *   node scripts/heidi-daily-loop.js --once   # single tick, then exit
 *
 * Environment:
 *   SUPABASE_URL                    (required for notifications)
 *   SUPABASE_SERVICE_ROLE_KEY       (required for notifications)
 *   PROTOFORGE_MCP_TOKEN            (required for MCP reads; missing -> honest failure)
 *   PROTOFORGE_MCP_URL              (optional, default http://127.0.0.1:3470)
 *   HEIDI_LOOP_TICK_MS              (optional) tick interval, default 900000 (15 min)
 *   HEIDI_LOOP_BRIEF_HOUR_CT        (optional) brief hour in Central time, default 8
 *   HEIDI_LOOP_STATE_FILE           (optional) override the state file path
 *
 * State: .hydi-operational/daily-loop-state.json — { lastBriefDateCt,
 *   alertedApprovalIds, degradedTicks, outageAlerted }
 * Log file: logs/heidi-daily-loop.log
 * ---------------------------------------------------------------------------
 */

// TypeScript loader for lib/protoforge-mcp-client.ts (same pattern as
// scripts/watchdog.js for lib/operational/*.ts).
require('./babel-register');

const fs = require('fs');
const path = require('path');

const { callProtoforgeTool } = require('../lib/protoforge-mcp-client');
const { createNotification } = require('../lib/notifications/notify');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'heidi-daily-loop.log');
const STATE_FILE = process.env.HEIDI_LOOP_STATE_FILE
  || path.join(ROOT, '.hydi-operational', 'daily-loop-state.json');

const ONCE = process.argv.includes('--once');
const TICK_MS = parseInt(process.env.HEIDI_LOOP_TICK_MS || String(15 * 60 * 1000), 10);
const BRIEF_HOUR_CT = parseInt(process.env.HEIDI_LOOP_BRIEF_HOUR_CT || '8', 10);
const DEGRADED_ESCALATE_TICKS = parseInt(process.env.HEIDI_LOOP_DEGRADED_TICKS || '2', 10);
const BRIEF_MINUTE_WINDOW = 15; // brief fires if CT time is BRIEF_HOUR_CT:00–:14

const CT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: 'numeric', minute: 'numeric', hour12: false,
});

let shuttingDown = false;

if (!fs.existsSync(path.join(ROOT, 'logs'))) fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* logging must never throw */ }
}

// ─── State file ───────────────────────────────────────────────────────────

function defaultState() {
  return { lastBriefDateCt: null, alertedApprovalIds: [], degradedTicks: 0, outageAlerted: false };
}

function loadState(file = STATE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaultState(), ...parsed, alertedApprovalIds: Array.isArray(parsed.alertedApprovalIds) ? parsed.alertedApprovalIds : [] };
  } catch (_) {
    return defaultState(); // missing or corrupt file starts clean — never throws
  }
}

function saveState(state, file = STATE_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    log(`STATE write failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Pure decision helpers (exported for tests) ───────────────────────────

/**
 * { dateCt: 'YYYY-MM-DD', hour, minute } in America/Chicago, for a given
 * instant (defaults to now). Extracted so tests can pin the clock.
 */
function centralNow(now = new Date()) {
  const parts = CT_FORMAT.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    dateCt: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

/** True when the brief should fire this tick: inside the CT window and not yet sent today. */
function shouldSendBrief(state, ct = centralNow()) {
  return ct.hour === BRIEF_HOUR_CT && ct.minute < BRIEF_MINUTE_WINDOW && state.lastBriefDateCt !== ct.dateCt;
}

/** Action ids pending now that have not been alerted before. */
function newApprovalIds(pendingActions, alertedIds) {
  const alerted = new Set(alertedIds);
  return pendingActions
    .map((a) => a && a.id)
    .filter((id) => id && !alerted.has(id));
}

// ─── Notification senders ─────────────────────────────────────────────────

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key);
}

function streamLine(stream) {
  if (!stream || typeof stream !== 'object') return null;
  const name = stream.stream || stream.name || 'stream';
  const cents = stream.revenue_cents ?? stream.verified_revenue_cents ?? stream.total_cents;
  if (cents === undefined || cents === null) return null;
  return `${name} $${(Number(cents) / 100).toFixed(2)}`;
}

/** The 8am CT brief: health, revenue per stream, pending approvals. */
function formatBrief(health, mobile, pending) {
  const lines = [];
  if (health && health.all_up === true) {
    lines.push('Health: all core services up.');
  } else if (health && Array.isArray(health.checks)) {
    const down = health.checks.filter((c) => !c.up).map((c) => c.service);
    lines.push(`Health: DEGRADED — ${down.join(', ') || 'unknown'} down.`);
  } else {
    lines.push('Health: unknown — MCP read failed.');
  }

  const streams = mobile && (mobile.streams || (mobile.data && mobile.data.streams));
  if (Array.isArray(streams) && streams.length > 0) {
    const formatted = streams.map(streamLine).filter(Boolean);
    lines.push(formatted.length > 0 ? `Revenue: ${formatted.join(' · ')}` : 'Revenue: streams present, no totals reported.');
  } else {
    lines.push('Revenue: no stream data.');
  }

  const count = pending && typeof pending.count === 'number' ? pending.count : 0;
  lines.push(count === 0 ? 'Approvals: none pending.' : `Approvals: ${count} waiting on you.`);

  const alerts = mobile && (mobile.alert || (mobile.data && mobile.data.alert));
  if (alerts && typeof alerts === 'string' && alerts.toLowerCase() !== 'none') {
    lines.push(`Alert: ${alerts}`);
  }
  return lines.join('\n');
}

// ─── The tick ─────────────────────────────────────────────────────────────

async function tick(deps = {}) {
  const call = deps.callTool || callProtoforgeTool;
  const notify = deps.notify || createNotification;
  const stateFile = deps.stateFile || STATE_FILE;
  const state = deps.state || loadState(stateFile);
  const ct = deps.ct || centralNow();
  const summary = { health: null, approvals: null, brief: null, alerts: [] };

  let supabase = null;
  try {
    supabase = deps.supabase === undefined ? getSupabase() : deps.supabase;
  } catch (err) {
    log(`NOTIFY unavailable: ${err.message} — observations still logged, nothing pushed`);
  }

  // 1. Canonical health read. Delegated recovery lives in hydi-watchdog; a
  // persistent degradation the watchdog cannot resolve is escalated to the
  // human — it is never restarted from here.
  const healthRes = await call('system_health');
  if (healthRes.ok && healthRes.data) {
    const health = healthRes.data;
    summary.health = health.all_up ? 'all_up' : 'degraded';
    if (health.all_up) {
      if (state.degradedTicks > 0) log(`RECOVERED system_health all_up after ${state.degradedTicks} degraded tick(s)`);
      state.degradedTicks = 0;
      state.outageAlerted = false;
    } else {
      state.degradedTicks += 1;
      const down = (health.checks || []).filter((c) => !c.up).map((c) => c.service).join(', ');
      log(`DEGRADED tick ${state.degradedTicks}: ${down || 'unknown service'} down (recovery owned by hydi-watchdog)`);
      if (state.degradedTicks >= DEGRADED_ESCALATE_TICKS && !state.outageAlerted) {
        if (supabase) {
          try {
            await notify(supabase, {
              category: 'worker_failure',
              title: 'HYDI persistent outage',
              body: `${down || 'A core service'} has been down across ${state.degradedTicks} consecutive checks and the watchdog has not restored it. Review recovery from the phone.`,
              metadata: { source: 'heidi-daily-loop', downServices: down, ticks: state.degradedTicks },
            });
            summary.alerts.push('outage');
          } catch (err) { log(`outage alert failed: ${err.message}`); }
        }
        state.outageAlerted = true;
      }
    }
  } else {
    // An MCP read failure is observer-side, not evidence the system is down.
    summary.health = 'read_failed';
    state.degradedTicks += 1;
    log(`MCP system_health read failed: ${healthRes.error} (observer-side; not counted as a service outage)`);
  }

  // 2. Pending approvals — alert on NEW ids only.
  const pendingRes = await call('pending_approvals');
  if (pendingRes.ok && pendingRes.data) {
    const pending = pendingRes.data;
    const actions = Array.isArray(pending.actions) ? pending.actions : [];
    const fresh = newApprovalIds(actions, state.alertedApprovalIds);
    summary.approvals = { count: pending.count ?? actions.length, newIds: fresh };
    if (fresh.length > 0) {
      log(`APPROVALS ${fresh.length} new pending action(s)`);
      if (supabase) {
        try {
          const kinds = actions.filter((a) => fresh.includes(a.id))
            .map((a) => a.action_type || a.task_name || a.type || 'action').slice(0, 5).join(', ');
          await notify(supabase, {
            category: 'approval_required',
            title: `${fresh.length} action${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} your approval`,
            body: `Escalated and waiting: ${kinds}. Open Heidi Mobile → Approvals to decide.`,
            metadata: { source: 'heidi-daily-loop', actionIds: fresh },
          });
          summary.alerts.push('approvals');
        } catch (err) { log(`approval alert failed: ${err.message}`); }
      }
      state.alertedApprovalIds = [...state.alertedApprovalIds, ...fresh].slice(-500);
    }
    // Prune ids that resolved (no longer pending) so a re-escalation re-alerts.
    const stillPending = new Set(actions.map((a) => a && a.id).filter(Boolean));
    state.alertedApprovalIds = state.alertedApprovalIds.filter((id) => stillPending.has(id));
  } else {
    summary.approvals = 'read_failed';
    log(`MCP pending_approvals read failed: ${pendingRes.error}`);
  }

  // 3. Morning brief at the CT window, once per CT date.
  if (shouldSendBrief(state, ct)) {
    const mobileRes = await call('mobile_status');
    const body = formatBrief(healthRes.ok ? healthRes.data : null, mobileRes.ok ? mobileRes.data : null, pendingRes.ok ? pendingRes.data : null);
    log('BRIEF sending morning brief');
    if (supabase) {
      try {
        await notify(supabase, {
          category: 'document_generated',
          title: 'Heidi morning brief',
          body,
          metadata: { source: 'heidi-daily-loop', briefDateCt: ct.dateCt },
        });
        summary.brief = 'sent';
      } catch (err) {
        summary.brief = 'notify_failed';
        log(`brief notification failed: ${err.message}`);
      }
    } else {
      summary.brief = 'notify_unavailable';
    }
    state.lastBriefDateCt = ct.dateCt; // mark sent even on failure — a retried brief is a duplicate, not evidence
  }

  saveState(state, stateFile);
  return summary;
}

// ─── Runner ───────────────────────────────────────────────────────────────

async function main() {
  log(`heidi-daily-loop starting (tick=${TICK_MS}ms, brief=${BRIEF_HOUR_CT}:00 CT, escalate after ${DEGRADED_ESCALATE_TICKS} degraded ticks)`);
  if (ONCE) {
    const s = await tick();
    log(`once complete: ${JSON.stringify(s)}`);
    return;
  }
  await tick();
  const timer = setInterval(() => { tick().catch((err) => log(`tick error: ${err instanceof Error ? err.message : err}`)); }, TICK_MS);
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    log('shutdown');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => {
    log(`fatal: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = {
  tick, loadState, saveState, centralNow, shouldSendBrief, newApprovalIds, formatBrief, defaultState,
  _internals: { TICK_MS, BRIEF_HOUR_CT, BRIEF_MINUTE_WINDOW, DEGRADED_ESCALATE_TICKS, STATE_FILE },
};
