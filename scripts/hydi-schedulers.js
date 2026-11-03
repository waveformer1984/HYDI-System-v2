'use strict';
/**
 * hydi-schedulers — one PM2-supervised process replacing 9 separate hydi-*
 * scheduler apps. Per-job cadence timers spawn each job's --once child,
 * sequentially, with a per-job timeout kill. Jobs keep their own scripts
 * unchanged; the supervisor only owns scheduling + isolation.
 *
 * B3: ~0.7 GB of PM2/node process overhead consolidated to one process.
 * stripe-webhook-listener stays separate (long-running listener, not a tick).
 */
const { spawn } = require('child_process');
const path = require('path');
const { recordProcessProvenance } = require('../lib/runtime/provenance');

const JOBS = [
  { name: 'hydi-watchdog',                script: 'scripts/watchdog.js',                        intervalMs: envMs('WATCHDOG_INTERVAL_MS', 120000),      timeoutMs: envMs('WATCHDOG_TIMEOUT_MS', 90000) },
  { name: 'hydi-model-prep-executor',     script: 'scripts/model-prep-executor-scheduler.js',   intervalMs: envMs('MODEL_PREP_INTERVAL_MS', 30000),    timeoutMs: envMs('MODEL_PREP_TIMEOUT_MS', 240000) },
  { name: 'heidi-daily-loop',             script: 'scripts/heidi-daily-loop.js',                intervalMs: envMs('HEIDI_LOOP_TICK_MS', 900000),       timeoutMs: envMs('HEIDI_LOOP_TIMEOUT_MS', 300000) },
  { name: 'hydi-protoforge-scout',        script: 'scripts/protoforge-opportunity-scheduler.js',intervalMs: envMs('PROTOFORGE_SCOUT_INTERVAL_MS', 86400000), timeoutMs: envMs('PROTOFORGE_SCOUT_TIMEOUT_MS', 60000) },
  { name: 'hydi-stuck-job-scheduler',     script: 'scripts/stuck-job-scheduler.js',             intervalMs: envMs('STUCK_JOB_INTERVAL_MS', 3600000),   timeoutMs: envMs('STUCK_JOB_TIMEOUT_MS', 120000) },
  { name: 'hydi-revenue-reconciliation',  script: 'scripts/revenue-reconciliation-scheduler.js',intervalMs: envMs('RECONCILIATION_INTERVAL_MS', 86400000), timeoutMs: envMs('RECONCILIATION_TIMEOUT_MS', 180000) },
  { name: 'hydi-failed-webhook-retry',    script: 'scripts/failed-webhook-scheduler.js',        intervalMs: envMs('WEBHOOK_RETRY_INTERVAL_MS', 1800000),  timeoutMs: envMs('WEBHOOK_RETRY_TIMEOUT_MS', 120000) },
  { name: 'hydi-revenue-autopilot-tick',  script: 'scripts/revenue-autopilot-tick.ts',          intervalMs: envMs('REVENUE_AUTOPILOT_INTERVAL_MS', 3600000), timeoutMs: envMs('REVENUE_AUTOPILOT_TIMEOUT_MS', 120000), tsx: true },
];

function envMs(key, dflt) {
  const v = parseInt(process.env[key] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const status = {};
for (const j of JOBS) status[j.name] = { lastRun: null, lastOutcome: null, runs: 0, failures: 0 };

let running = false;
const queue = [];
const root = path.join(__dirname, '..');

function spawnOnce(job) {
  return new Promise((resolve) => {
    const cmd = job.tsx ? 'npx' : 'node';
    const args = job.tsx ? ['tsx', job.script, '--once'] : [job.script, '--once'];
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: root, stdio: 'pipe', windowsHide: true, shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 8192) out = out.slice(-8192) });
    child.stderr.on('data', (d) => { out += d; if (out.length > 8192) out = out.slice(-8192) });
    const killer = setTimeout(() => { child.kill('SIGKILL'); resolve({ job: job.name, outcome: 'timeout', ms: Date.now() - t0, tail: out.slice(-400) }) }, job.timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(killer);
      resolve({ job: job.name, outcome: code === 0 ? 'ok' : `exit_${code}`, ms: Date.now() - t0, tail: out.slice(-400) });
    });
    child.on('error', (e) => { clearTimeout(killer); resolve({ job: job.name, outcome: 'spawn_error', ms: Date.now() - t0, tail: String(e).slice(-200) }) });
  });
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    if (status[job.name].inFlight) continue;
    status[job.name].inFlight = true;
    const r = await spawnOnce(job);
    const s = status[job.name];
    s.inFlight = false; s.lastRun = new Date().toISOString(); s.lastOutcome = r.outcome; s.runs++;
    if (r.outcome !== 'ok') { s.failures++; console.log(`[hydi-schedulers] ${job.name}: ${r.outcome} ${r.ms}ms ${r.tail.trim().split('\n').slice(-2).join(' | ')}`) }
    else console.log(`[hydi-schedulers] ${job.name}: ok ${r.ms}ms`);
    if (statusPath) writeStatus();
  }
  running = false;
}

const statusPath = process.env.HYDI_SCHEDULERS_STATUS || path.join(root, '.runtime', 'hydi-schedulers.json');
function writeStatus() {
  try { require('fs').writeFileSync(statusPath, JSON.stringify({ ts: new Date().toISOString(), jobs: status }, null, 2)) } catch {}
}

function schedule(job) {
  const tick = () => { queue.push(job); pump(); setTimeout(tick, job.intervalMs) };
  const jitter = Math.floor(Math.random() * Math.min(job.intervalMs, 10000));
  setTimeout(tick, jitter + 1500); // stagger starts to avoid boot thundering herd
}

process.on('SIGTERM', () => { console.log('[hydi-schedulers] SIGTERM — finishing current job then exit'); queue.length = 0 });
process.on('SIGINT', () => process.exit(0));

async function main() {
  recordProcessProvenance('hydi-schedulers').catch(() => {});
  require('fs').mkdirSync(path.dirname(statusPath), { recursive: true });
  for (const job of JOBS) schedule(job);
  console.log(`[hydi-schedulers] up — ${JOBS.length} jobs, sequential queue`);
  writeStatus();
}

if (require.main === module) main().catch((e) => { console.error('[hydi-schedulers] fatal', e); process.exit(1) });
module.exports = { JOBS, status };
