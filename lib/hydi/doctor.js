'use strict';

/**
 * Hydi doctor — read-only Frank health proof (one command, no fixes).
 * Each check: PASS | WARN | FAIL + one-line evidence + fix hint; 5s budget.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { probeHeidiAgentLoopHealth } = require('../observation/heidi-agent-loop-probe');
const { scoutDir } = require('../job-scout/decisions');

const TIMEOUT_MS = 5000;
const ROOT = path.resolve(__dirname, '..', '..');
const LATEST_PATH = path.join(ROOT, '.runtime', 'doctor', 'latest.json');
const NOTIFY_STATE_PATH = path.join(ROOT, '.runtime', 'doctor', 'notify-state.json');

const REQUIRED_MODEL = 'qwen2.5:3b-instruct-q4_K_M';

const PORT_EXPECTATIONS = [
  { port: 3456, label: 'Bridge', hint: 'Start heidi bridge / legacy core on :3456' },
  { port: 3006, label: 'Mobile chat', hint: 'pm2 start heidi-mobile-chat (set HEIDI_MOBILE_TOKEN)' },
  { port: 3459, label: 'Forge loop', hint: 'pm2 start heidi-core with HEIDI_PORT=3459' },
  { port: 3462, label: 'Heidi agent', hint: 'pm2 start heidi-agent (Phase 2 loop)' },
];

function redactEvidence(text) {
  return String(text || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(apikey=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(access_token=)[^&\s]+/gi, '$1[REDACTED]');
}

function mk(name, status, evidence, hint) {
  return {
    name,
    status,
    evidence: redactEvidence(evidence),
    hint: hint || '',
  };
}

function withTimeout(promise, ms = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function ageMsFromIso(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

function formatAge(ms) {
  if (ms == null) return 'unknown age';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${(ms / 3_600_000).toFixed(1)}h ago`;
}

function execText(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: opts.timeoutMs || TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) resolve({ ok: false, text: '', err: err.message });
      else resolve({ ok: true, text: (stdout || '').trim(), err: null });
    });
  });
}

async function fetchJson(url, headers, fetchFn) {
  const res = await withTimeout(
    fetchFn(url, { headers: { Accept: 'application/json', ...headers } }),
    TIMEOUT_MS,
  );
  const body = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body };
}

async function checkHeidiAgent(env, fetchFn) {
  const probe = await withTimeout(probeHeidiAgentLoopHealth(env, fetchFn), TIMEOUT_MS).catch(
    () => ({ reachable: false, reason: 'timeout' }),
  );
  if (!probe.reachable) {
    return mk('Heidi agent (:3462)', 'FAIL', `unreachable (${probe.reason || 'unknown'})`, 'pm2 restart heidi-agent; curl http://127.0.0.1:3462/health');
  }
  const parts = [];
  let status = 'PASS';
  if (!probe.lease_held) {
    status = 'FAIL';
    parts.push('lease_held=false');
  } else parts.push('lease_held=true');
  if (probe.allow_exec) {
    status = 'FAIL';
    parts.push('allow_exec=true (must be false)');
  } else parts.push('allow_exec=false');
  const age = ageMsFromIso(probe.last_cycle_at);
  if (age == null) {
    status = status === 'PASS' ? 'WARN' : status;
    parts.push('last_cycle_at missing');
  } else if (age > 120_000) {
    status = 'FAIL';
    parts.push(`last_cycle ${formatAge(age)}`);
  } else {
    parts.push(`last_cycle ${formatAge(age)}`);
  }
  return mk('Heidi agent (:3462)', status, parts.join(', '), status !== 'PASS' ? 'Check heidi-agent logs; verify lease + loop cadence' : '');
}

async function supabaseTableCheck(table, orderCol, maxAgeMs, env, fetchFn) {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return mk(`Supabase ${table}`, 'WARN', 'SUPABASE_URL or service key unset', 'Set local Supabase env (see verify-supabase.sh)');
  }
  const url = `${base}/rest/v1/${table}?select=${orderCol}&order=${orderCol}.desc&limit=1`;
  try {
    const res = await withTimeout(
      fetchFn(url, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: 'count=exact',
        },
      }),
      TIMEOUT_MS,
    );
    const range = res.headers.get('content-range') || '';
    const countMatch = range.match(/\/(\d+|\*)$/);
    const count = countMatch && countMatch[1] !== '*' ? countMatch[1] : '?';
    if (res.status === 404 || res.status === 400) {
      const errBody = await res.text().catch(() => '');
      if (/does not exist|PGRST205/i.test(errBody)) {
        return mk(`Supabase ${table}`, 'WARN', `table missing (HTTP ${res.status})`, 'Apply migrations or ignore if not on this host');
      }
    }
    if (!res.ok) {
      return mk(`Supabase ${table}`, 'FAIL', `HTTP ${res.status}`, 'Fix PostgREST / RLS; ./verify-supabase.sh');
    }
    const rows = await res.json();
    const newest = Array.isArray(rows) && rows[0] ? rows[0][orderCol] : null;
    const age = ageMsFromIso(newest);
    let status = 'PASS';
    if (maxAgeMs != null && count !== '0' && count !== 0) {
      if (age == null) status = 'WARN';
      else if (age > maxAgeMs) status = 'FAIL';
    }
    const ageText = newest ? `newest ${formatAge(age)}` : 'no rows';
    return mk(
      `Supabase ${table}`,
      status,
      `rows=${count} ${ageText}`,
      status === 'FAIL' ? `Data stale — investigate writer for ${table}` : '',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return mk(`Supabase ${table}`, 'FAIL', msg, 'Is Supabase up? docker/supabase start');
  }
}

async function checkOllama(fetchFn) {
  try {
    const res = await withTimeout(fetchFn('http://127.0.0.1:11434/api/tags', { headers: { Accept: 'application/json' } }), TIMEOUT_MS);
    if (!res.ok) return mk('Ollama', 'FAIL', `HTTP ${res.status}`, 'Start Ollama; ollama pull ' + REQUIRED_MODEL);
    const body = await res.json();
    const names = (body.models || []).map((m) => m.name);
    const hit = names.some((n) => n === REQUIRED_MODEL || n.startsWith(`${REQUIRED_MODEL}:`));
    if (!hit) {
      return mk('Ollama', 'FAIL', `model ${REQUIRED_MODEL} not in tags (${names.length} models)`, `ollama pull ${REQUIRED_MODEL}`);
    }
    return mk('Ollama', 'PASS', `${REQUIRED_MODEL} present (${names.length} models)`, '');
  } catch (e) {
    return mk('Ollama', 'FAIL', e instanceof Error ? e.message : String(e), 'ollama serve on :11434');
  }
}

function checkJobScout(env) {
  const dir = env.JOB_SCOUT_DIR ? path.resolve(env.JOB_SCOUT_DIR) : scoutDir(env);
  const status = readJsonSafe(path.join(dir, 'status.json'), null);
  const leads = readJsonSafe(path.join(dir, 'leads.json'), { leads: [] });
  const leadCount = Array.isArray(leads.leads) ? leads.leads.length : 0;
  const lastRun = status && (status.ranAt || status.lastRun || status.ts);
  const age = ageMsFromIso(lastRun);
  const gmailOn = env.JOB_SCOUT_GMAIL === '1' || env.JOB_SCOUT_GMAIL === 'true';
  const tokenPath =
    env.JOB_SCOUT_GMAIL_TOKEN_FILE ||
    path.join(os.homedir(), '.hydi', 'job-scout-gmail-token.json');
  let tokenOk = false;
  try {
    if (fs.existsSync(tokenPath)) tokenOk = fs.statSync(tokenPath).size > 8;
  } catch {
    tokenOk = false;
  }
  const skippedNames = ['skippedLog.json', 'skipped-log.json', 'gmail-skipped.json'];
  let skippedSize = 0;
  for (const name of skippedNames) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) {
        skippedSize = fs.statSync(p).size;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  const parts = [
    `leads=${leadCount}`,
    lastRun ? `last_run ${formatAge(age)}` : 'no status.json',
    `gmail=${gmailOn ? 'on' : 'off'}`,
    gmailOn ? `gmail_token_file=${tokenOk ? 'present' : 'missing'}` : 'gmail_token=n/a',
    `skippedLog_bytes=${skippedSize}`,
  ];
  let statusLevel = 'PASS';
  if (!lastRun) statusLevel = 'WARN';
  if (gmailOn && !tokenOk) statusLevel = 'FAIL';
  return mk('Job Scout', statusLevel, parts.join(', '), statusLevel !== 'PASS' ? 'Run job-scout; fix Gmail token path or JOB_SCOUT_GMAIL' : '');
}

async function checkPm2(env) {
  const platform = env.DOCTOR_PLATFORM || process.platform;
  if (platform === 'win32') {
    const r = await execText('pm2', ['jlist'], { timeoutMs: TIMEOUT_MS });
    if (!r.ok) {
      return [
        mk('PM2 hydi-schedulers', 'WARN', `pm2 unreadable (${r.err || 'error'})`, 'Install PM2 on Frank; pm2 ls'),
        mk('PM2 heidi-job-scout', 'WARN', 'scheduler job unknown', 'See .runtime/hydi-schedulers.json'),
      ];
    }
    let list;
    try {
      list = JSON.parse(r.text);
    } catch {
      return [mk('PM2 hydi-schedulers', 'FAIL', 'pm2 jlist not JSON', 'pm2 kill && pm2 resurrect')];
    }
    const sched = list.find((p) => p.name === 'hydi-schedulers');
    const schedStatus = sched && sched.pm2_env && sched.pm2_env.status;
    const restarts = sched && sched.pm2_env ? sched.pm2_env.restart_time : null;
    const schedCheck = mk(
      'PM2 hydi-schedulers',
      schedStatus === 'online' ? 'PASS' : 'FAIL',
      sched ? `status=${schedStatus} restarts=${restarts ?? '?'}` : 'not in pm2 list',
      'pm2 start ecosystem.config.js --only hydi-schedulers',
    );
    const schedFile = readJsonSafe(path.join(ROOT, '.runtime', 'hydi-schedulers.json'), null);
    const job = schedFile && schedFile.jobs && schedFile.jobs['heidi-job-scout'];
    const jobLine = job
      ? `last=${job.lastRun || 'never'} outcome=${job.lastOutcome || '?'} runs=${job.runs ?? 0}`
      : 'no status file yet';
    const jobCheck = mk(
      'PM2 heidi-job-scout',
      schedStatus === 'online' && job && job.lastOutcome !== 'error' ? 'PASS' : job && job.lastOutcome === 'error' ? 'WARN' : 'WARN',
      jobLine,
      'Check hydi-schedulers logs; node scripts/job-scout.js --once',
    );
    return [schedCheck, jobCheck];
  }
  return [
    mk('PM2 hydi-schedulers', 'WARN', 'non-Windows host — PM2 check skipped', 'Run doctor on Frank (Windows)'),
    mk('PM2 heidi-job-scout', 'WARN', 'non-Windows host — job status skipped', 'See .runtime/hydi-schedulers.json on Frank'),
  ];
}

async function findPidOnPort(port, env) {
  const platform = env.DOCTOR_PLATFORM || process.platform;
  if (platform === 'win32') {
    const r = await execText('netstat', ['-ano'], { timeoutMs: TIMEOUT_MS });
    if (!r.ok) return null;
    for (const line of r.text.split('\n')) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (!Number.isNaN(pid)) return pid;
    }
    return null;
  }
  const r = await execText('bash', ['-lc', `lsof -ti :${port} 2>/dev/null | head -1`], { timeoutMs: TIMEOUT_MS });
  if (!r.ok || !r.text) return null;
  const pid = parseInt(r.text.split('\n')[0], 10);
  return Number.isNaN(pid) ? null : pid;
}

async function processLabel(pid, env) {
  if (!pid) return 'none';
  const platform = env.DOCTOR_PLATFORM || process.platform;
  if (platform === 'win32') {
    const r = await execText('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: TIMEOUT_MS });
    if (r.ok && r.text) {
      const m = r.text.match(/^"([^"]+)"/);
      if (m) return m[1];
    }
    return `pid ${pid}`;
  }
  const r = await execText('ps', ['-p', String(pid), '-o', 'comm='], { timeoutMs: TIMEOUT_MS });
  return r.ok && r.text ? r.text : `pid ${pid}`;
}

async function checkPorts(env) {
  const out = [];
  for (const spec of PORT_EXPECTATIONS) {
    const pid = await findPidOnPort(spec.port, env);
    if (!pid) {
      out.push(mk(`Port :${spec.port} (${spec.label})`, 'FAIL', 'not listening', spec.hint));
      continue;
    }
    const label = await processLabel(pid, env);
    out.push(mk(`Port :${spec.port} (${spec.label})`, 'PASS', `listening pid=${pid} (${label})`, ''));
  }
  return out;
}

async function checkVoice(fetchFn) {
  const checks = [];
  for (const port of [9000, 9001]) {
    try {
      const res = await withTimeout(fetchFn(`http://127.0.0.1:${port}/health`, { headers: { Accept: 'application/json' } }), TIMEOUT_MS);
      if (res.ok) checks.push(mk(`Voice :${port}`, 'PASS', `HTTP ${res.status}`, ''));
      else checks.push(mk(`Voice :${port}`, 'WARN', `HTTP ${res.status}`, 'Optional — see docs/runbooks/HEIDI_VOICE_V1.md'));
    } catch {
      checks.push(mk(`Voice :${port}`, 'WARN', 'not reachable', 'Optional voice stack on Frank'));
    }
  }
  return checks;
}

function envFileHasAllowExec(file) {
  try {
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, 'utf8');
    return /^\s*HEIDI_ALLOW_EXEC\s*=\s*(true|1)\s*$/im.test(text);
  } catch {
    return false;
  }
}

function ecosystemHasAllowExecTrue() {
  const eco = path.join(ROOT, 'ecosystem.config.js');
  try {
    const text = fs.readFileSync(eco, 'utf8');
    if (/HEIDI_ALLOW_EXEC\s*:\s*['"]true['"]/i.test(text)) return true;
    if (/HEIDI_ALLOW_EXEC\s*:\s*true\b/.test(text)) return true;
  } catch {
    return false;
  }
  return false;
}

function checkSafety(env) {
  const offenders = [];
  const v = env.HEIDI_ALLOW_EXEC;
  if (v === 'true' || v === '1') offenders.push('process.env');
  if (envFileHasAllowExec(path.join(ROOT, '.env'))) offenders.push('.env');
  if (envFileHasAllowExec(path.join(ROOT, '.env.local'))) offenders.push('.env.local');
  if (ecosystemHasAllowExecTrue()) offenders.push('ecosystem.config.js');
  if (offenders.length) {
    return mk(
      'Safety HEIDI_ALLOW_EXEC',
      'FAIL',
      `ENABLED in ${offenders.join(', ')} — must stay off`,
      'Unset HEIDI_ALLOW_EXEC; pm2 restart affected apps with exec false',
    );
  }
  return mk('Safety HEIDI_ALLOW_EXEC', 'PASS', 'off in env, .env, ecosystem', '');
}

async function checkJobLeadsFallback(env, fetchFn) {
  const primary = await supabaseTableCheck('job_leads', 'created_at', 6 * 3_600_000, env, fetchFn);
  if (primary.status !== 'WARN' || !/missing/i.test(primary.evidence)) return primary;
  const dir = env.JOB_SCOUT_DIR ? path.resolve(env.JOB_SCOUT_DIR) : scoutDir(env);
  const leadsFile = path.join(dir, 'leads.json');
  let mtime = null;
  try {
    if (fs.existsSync(leadsFile)) mtime = fs.statSync(leadsFile).mtime.toISOString();
  } catch {
    /* ignore */
  }
  const age = ageMsFromIso(mtime);
  let status = 'WARN';
  if (mtime && age != null && age > 6 * 3_600_000) status = 'FAIL';
  const leads = readJsonSafe(leadsFile, { leads: [] });
  const n = Array.isArray(leads.leads) ? leads.leads.length : 0;
  return mk(
    'Supabase job_leads',
    status,
    `table absent; leads.json count=${n} file ${mtime ? formatAge(age) : 'missing'}`,
    status === 'FAIL' ? 'Run heidi-job-scout or sync job leads' : 'Migrate job_leads or rely on file store',
  );
}

/**
 * @param {object} [deps]
 * @returns {Promise<{ ts: string, checks: object[], summary: { pass: number, warn: number, fail: number } }>}
 */
async function runHydiDoctor(deps = {}) {
  const env = { ...process.env, ...(deps.env || {}) };
  const fetchFn = deps.fetch || global.fetch;
  const checks = [];
  checks.push(await checkHeidiAgent(env, fetchFn));
  checks.push(await supabaseTableCheck('heidi_state_snapshots', 'captured_at', 15 * 60_000, env, fetchFn));
  checks.push(await supabaseTableCheck('heidi_events', 'created_at', null, env, fetchFn));
  checks.push(await supabaseTableCheck('heidi_reflections', 'created_at', null, env, fetchFn));
  checks.push(await checkJobLeadsFallback(env, fetchFn));
  checks.push(await checkOllama(fetchFn));
  checks.push(checkJobScout(env));
  checks.push(...(await checkPm2(env)));
  checks.push(...(await checkPorts(env)));
  checks.push(...(await checkVoice(fetchFn)));
  checks.push(checkSafety(env));
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) {
    if (c.status === 'PASS') summary.pass += 1;
    else if (c.status === 'WARN') summary.warn += 1;
    else summary.fail += 1;
  }
  return { ts: new Date().toISOString(), checks, summary };
}

function formatDoctorTable(report) {
  const lines = ['', '=== HYDI DOCTOR ===', ''];
  const col = 34;
  for (const c of report.checks) {
    const name = c.name.padEnd(col);
    lines.push(`  ${c.status.padEnd(5)} ${name} ${c.evidence}`);
    if (c.hint && c.status !== 'PASS') lines.push(`         → ${c.hint}`);
  }
  const s = report.summary;
  lines.push('');
  lines.push(`  Hydi: ${s.pass} PASS / ${s.warn} WARN / ${s.fail} FAIL`);
  lines.push('');
  return lines.join('\n');
}

function formatDoctorJson(report) {
  return JSON.stringify(report, null, 2);
}

function formatNotifyBody(report) {
  const s = report.summary;
  const head = `Hydi: ${s.pass} PASS / ${s.warn} WARN / ${s.fail} FAIL`;
  const fails = report.checks.filter((c) => c.status === 'FAIL').map((c) => `FAIL ${c.name}: ${c.evidence}`);
  return fails.length ? `${head}\n${fails.join('\n')}` : head;
}

function notifySignature(report) {
  const fails = report.checks.filter((c) => c.status === 'FAIL').map((c) => c.name).sort().join(',');
  return `${report.summary.pass}|${report.summary.warn}|${report.summary.fail}|${fails}`;
}

function saveDoctorLatest(report, root = ROOT) {
  const dir = path.join(root, '.runtime', 'doctor');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'latest.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2));
  fs.renameSync(tmp, target);
  return target;
}

function shouldNotify(report, root = ROOT) {
  if (report.summary.fail > 0) return true;
  const state = readJsonSafe(path.join(root, '.runtime', 'doctor', 'notify-state.json'), {});
  const sig = notifySignature(report);
  return state.lastSignature !== sig;
}

function writeNotifyState(report, root = ROOT) {
  const dir = path.join(root, '.runtime', 'doctor');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'notify-state.json');
  fs.writeFileSync(file, JSON.stringify({ lastSignature: notifySignature(report), at: report.ts }, null, 2));
}

async function notifyDoctor(report, deps = {}) {
  const { createNotification } = require('../notifications/notify');
  const createSupabase = deps.createSupabase || (() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key);
  });
  const supabase = typeof createSupabase === 'function' ? createSupabase() : null;
  if (!supabase) {
    return { ok: false, reason: 'no_supabase' };
  }
  const body = formatNotifyBody(report);
  const category = report.summary.fail > 0 ? 'security_event' : 'build_completed';
  await createNotification(supabase, {
    category,
    title: 'Hydi doctor',
    body,
    metadata: { source: 'hydi-doctor', summary: report.summary },
  });
  return { ok: true };
}

function isDoctorQuery(input) {
  const t = String(input || '').trim().toLowerCase();
  return t === 'doctor' || t === '/doctor' || t === 'hydi doctor' || t === 'hydi-doctor';
}

function formatDoctorChat(root = ROOT) {
  const report = readJsonSafe(path.join(root, '.runtime', 'doctor', 'latest.json'), null);
  if (!report) {
    return 'doctor: no run yet — on Frank run `npm run doctor` (or wait for hydi-schedulers).';
  }
  const s = report.summary;
  const lines = [
    `doctor: ${s.pass} PASS / ${s.warn} WARN / ${s.fail} FAIL (at ${String(report.ts).slice(11, 19)} UTC)`,
    ...report.checks.filter((c) => c.status !== 'PASS').slice(0, 8).map((c) => `  ${c.status} ${c.name}: ${c.evidence}`),
  ];
  return lines.join('\n');
}

module.exports = {
  runHydiDoctor,
  formatDoctorTable,
  formatDoctorJson,
  formatNotifyBody,
  saveDoctorLatest,
  shouldNotify,
  writeNotifyState,
  notifyDoctor,
  isDoctorQuery,
  formatDoctorChat,
  LATEST_PATH,
  NOTIFY_STATE_PATH,
};