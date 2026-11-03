'use strict';
/**
 * hydi-schedulers — one PM2-supervised process replacing 8 separate hydi-*
 * tick apps. Per-job cadence timers spawn each job's --once child,
 * sequentially, with a per-job tree-kill timeout. Jobs keep their own
 * scripts unchanged; the supervisor only owns scheduling + isolation.
 *
 * Cadence model (documented):
 *   - First tick: staggered ~1.5-11s after boot (no thundering herd).
 *   - Interval: measured from job COMPLETION, not scheduled time — a slow
 *     job defers its own next tick rather than piling up.
 *   - Missed runs after downtime: skipped, not replayed (the next tick is
 *     the recovery).
 *   - Max pending work: ONE queued instance per job — a tick that fires
 *     while the job is queued or in-flight is coalesced, not duplicated.
 *   - Fairness: each job owns its timer; a slow job delays only itself,
 *     but the sequential pump means one slow job does hold the queue —
 *     bounded by the job's own timeout kill.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { recordProcessProvenance } = require('../lib/runtime/provenance');

function envMs(key, dflt) {
  const v = parseInt(process.env[key] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const JOBS = [
  { name: 'hydi-watchdog',               script: 'scripts/watchdog.js',                         intervalMs: envMs('WATCHDOG_INTERVAL_MS', 120000),    timeoutMs: envMs('WATCHDOG_TIMEOUT_MS', 90000) },
  { name: 'hydi-model-prep-executor',    script: 'scripts/model-prep-executor-scheduler.js',    intervalMs: envMs('MODEL_PREP_INTERVAL_MS', 30000),   timeoutMs: envMs('MODEL_PREP_TIMEOUT_MS', 240000) },
  { name: 'heidi-daily-loop',            script: 'scripts/heidi-daily-loop.js',                 intervalMs: envMs('HEIDI_LOOP_TICK_MS', 900000),      timeoutMs: envMs('HEIDI_LOOP_TIMEOUT_MS', 300000) },
  { name: 'hydi-protoforge-scout',       script: 'scripts/protoforge-opportunity-scheduler.js', intervalMs: envMs('PROTOFORGE_SCOUT_INTERVAL_MS', 86400000), timeoutMs: envMs('PROTOFORGE_SCOUT_TIMEOUT_MS', 60000) },
  { name: 'hydi-stuck-job-scheduler',    script: 'scripts/stuck-job-scheduler.js',              intervalMs: envMs('STUCK_JOB_INTERVAL_MS', 3600000),  timeoutMs: envMs('STUCK_JOB_TIMEOUT_MS', 120000) },
  { name: 'hydi-revenue-reconciliation', script: 'scripts/revenue-reconciliation-scheduler.js', intervalMs: envMs('RECONCILIATION_INTERVAL_MS', 86400000), timeoutMs: envMs('RECONCILIATION_TIMEOUT_MS', 180000) },
  { name: 'hydi-failed-webhook-retry',   script: 'scripts/failed-webhook-scheduler.js',         intervalMs: envMs('WEBHOOK_RETRY_INTERVAL_MS', 1800000), timeoutMs: envMs('WEBHOOK_RETRY_TIMEOUT_MS', 120000) },
  { name: 'hydi-revenue-autopilot-tick', script: 'scripts/revenue-autopilot-tick.ts',           intervalMs: envMs('REVENUE_AUTOPILOT_INTERVAL_MS', 3600000), timeoutMs: envMs('REVENUE_AUTOPILOT_TIMEOUT_MS', 120000), tsx: true },
];

const root = path.join(__dirname, '..');
const statusPath = process.env.HYDI_SCHEDULERS_STATUS || path.join(root, '.runtime', 'hydi-schedulers.json');
const status = {};
for (const j of JOBS) status[j.name] = { lastRun: null, lastOutcome: null, runs: 0, failures: 0, inFlight: false, queued: false };

let activeChild = null;
let running = false;
const queue = [];
const timers = [];

function treeKill(pid) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}

function writeStatus() {
  try {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    const tmp = `${statusPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), jobs: status, queueDepth: queue.length }, null, 2));
    fs.renameSync(tmp, statusPath); // atomic
  } catch {}
}

function spawnOnce(job) {
  return new Promise((resolve) => {
    const cmd = job.tsx ? 'npx' : 'node';
    const args = job.tsx ? ['tsx', job.script, '--once'] : [job.script, '--once'];
    const t0 = Date.now();
    let out = '';
    let settled = false;
    const child = spawn(cmd, args, { cwd: root, stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
    activeChild = child;
    const settle = (outcome, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      activeChild = null;
      resolve({ job: job.name, outcome, ms: Date.now() - t0, tail: (extra || out).slice(-400) });
    };
    child.stdout.on('data', (d) => { out += d; if (out.length > 8192) out = out.slice(-8192) });
    child.stderr.on('data', (d) => { out += d; if (out.length > 8192) out = out.slice(-8192) });
    const killer = setTimeout(() => {
      treeKill(child.pid);
      settle('timeout');
    }, job.timeoutMs);
    // 'close' fires after streams flush — the single settlement point.
    child.on('close', (code) => settle(code === 0 ? 'ok' : `exit_${code}`));
    child.on('error', (e) => settle('spawn_error', String(e)));
  });
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    job.queued = false;
    const s = status[job.name];
    const r = await spawnOnce(job);
    s.inFlight = false; s.lastRun = new Date().toISOString(); s.lastOutcome = r.outcome; s.runs++;
    if (r.outcome !== 'ok') { s.failures++; console.log(`[hydi-schedulers] ${job.name}: ${r.outcome} ${r.ms}ms ${r.tail.trim().split('\n').slice(-2).join(' | ')}`) }
    else console.log(`[hydi-schedulers] ${job.name}: ok ${r.ms}ms`);
    writeStatus();
  }
  running = false;
}

function schedule(job) {
  const tick = () => {
    const s = status[job.name];
    // coalesce: one pending instance per job — a tick while queued or
    // in-flight is skipped, not duplicated.
    if (!s.queued && !s.inFlight) {
      s.queued = true;
      queue.push(job);
      pump();
    }
    timers.push(setTimeout(tick, job.intervalMs)); // from completion — see header
  };
  const jitter = Math.floor(Math.random() * Math.min(job.intervalMs, 10000));
  timers.push(setTimeout(tick, jitter + 1500));
}

let stopping = false;
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`[hydi-schedulers] ${sig} — draining, no new ticks`);
  for (const t of timers) clearTimeout(t);
  queue.length = 0;
  if (activeChild) { treeKill(activeChild.pid); activeChild = null }
  writeStatus();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  recordProcessProvenance('hydi-schedulers').catch(() => {});
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  for (const job of JOBS) schedule(job);
  console.log(`[hydi-schedulers] up — ${JOBS.length} jobs, sequential queue, one pending per job`);
  writeStatus();
}

if (require.main === module) main().catch((e) => { console.error('[hydi-schedulers] fatal', e); process.exit(1) });
module.exports = { JOBS, status };
