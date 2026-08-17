#!/usr/bin/env node
'use strict';
/**
 * HYDI PREFLIGHT
 * ----------------------------------------------------------------------------
 * Runs before boot-agent spawns any module. Catches and (where safe) fixes the
 * common failure modes that previously required manual intervention:
 *
 *   1. Zombie processes holding boot ports without answering health checks.
 *   2. Docker Desktop not running (Supabase local stack depends on it).
 *   3. Supabase CLI version mismatch (caused migration re-apply loops).
 *   4. Missing or wrong SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *   5. A live Stripe key (sk_live_*) silently inherited from the environment.
 *
 * Exits 0 if all checks pass (or were auto-fixed), 1 if a blocking issue
 * remains.  Boot-agent calls this automatically; it can also be run directly:
 *
 *   node scripts/preflight.js
 *   npm run preflight
 *
 * ----------------------------------------------------------------------------
 */

const net = require('net');
const http = require('http');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load .env.local first, then .env — same order as boot-agent.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(ROOT, '.env.local') });
  dotenv.config({ path: path.resolve(ROOT, '.env') });
} catch (_) { /* dotenv optional */ }

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Ports the boot config uses, mapped to their health endpoint.
// If a port is occupied but the health endpoint doesn't answer, the occupying
// process is killed.
const PORT_CHECKS = [
  { port: 3000, healthUrl: 'http://127.0.0.1:3000/api/health', label: 'heidi-web' },
  { port: 3005, healthUrl: 'http://127.0.0.1:3005/health',      label: 'protoforge-core' },
  { port: 3006, healthUrl: 'http://127.0.0.1:3006/api/health',  label: 'heidi-mobile-chat' },
  { port: 3459, healthUrl: null,                                 label: 'reserved-3459' },
  { port: 3461, healthUrl: null,                                 label: 'reserved-3461' },
  { port: 5050, healthUrl: null,                                 label: 'reserved-5050' },
];

// The Supabase CLI version the repo's migrations are currently validated
// against.  Preflight verifies `npx supabase --version` matches exactly.
// Update this when intentionally upgrading the CLI.
const REQUIRED_SUPABASE_CLI_VERSION = '2.107.0';

const DOCKER_START_TIMEOUT_MS = 90_000;
const DOCKER_POLL_INTERVAL_MS = 3_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const CLR = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', grey: '\x1b[90m',
};
const color = (code, s) => `${code}${s}${CLR.reset}`;
const tag = `${CLR.bold}[preflight]${CLR.reset}`;
function ok(msg)   { console.log(`${tag} ${color(CLR.green, '✓')} ${msg}`); }
function warn(msg) { console.log(`${tag} ${color(CLR.yellow, '⚠')} ${msg}`); }
function fail(msg) { console.error(`${tag} ${color(CLR.red, '✗')} ${msg}`); }
function info(msg) { console.log(`${tag} ${color(CLR.cyan, 'ℹ')} ${msg}`); }
function section(s) { console.log(`\n${tag} ${CLR.bold}${color(CLR.cyan, '── ' + s + ' ──')}${CLR.reset}`); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quick TCP connect check — true if something is listening. */
function canConnect(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
    socket.connect(port, host);
  });
}

/** HTTP GET that resolves { ok, statusCode } within a timeout. */
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0 }); });
    req.on('error', () => resolve({ ok: false, statusCode: 0 }));
  });
}

/** Sleep helper. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Find PIDs listening on a port.  Works on Windows (netstat) and Linux/macOS
 * (lsof or ss).  Returns an array of { pid, cmdline }.
 */
function findPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      // netstat -ano | findstr :PORT  ->  lines like
      //  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
      const out = execSync(`netstat -ano`, { encoding: 'utf8', timeout: 5000 });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      return [...pids].map((pid) => {
        let cmdline = '';
        try {
          cmdline = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
            encoding: 'utf8', timeout: 5000,
          }).trim().replace(/^"|"$/g, '');
        } catch (_) { /* ignore */ }
        return { pid, cmdline };
      });
    }
    // Linux / macOS
    try {
      const out = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      return out.trim().split('\n').filter(Boolean).map((pid) => ({ pid, cmdline: '' }));
    } catch (_) {
      const out = execSync(`ss -tlnp 'sport = :${port}' 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const m = line.match(/pid=(\d+)/);
        if (m) pids.add(m[1]);
      }
      return [...pids].map((pid) => ({ pid, cmdline: '' }));
    }
  } catch (_) {
    return [];
  }
}

/** Kill a PID.  Uses taskkill /F on Windows, kill -9 elsewhere. */
function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      process.kill(parseInt(pid, 10), 'SIGKILL');
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** Read .env.local into a key/value object (does not use dotenv, so we can
 *  verify the *file* source, not whatever ended up in process.env). */
function readEnvFile(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  if (!fs.existsSync(resolved)) return null;
  const vars = {};
  for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** 1. Port / zombie-process check */
async function checkPorts() {
  section('Port & zombie-process check');
  let killed = 0;
  for (const { port, healthUrl, label } of PORT_CHECKS) {
    const occupied = await canConnect(port);
    if (!occupied) {
      ok(`port ${port} free — ${label}`);
      continue;
    }
    // Port is occupied — is it healthy?
    if (healthUrl) {
      const { ok: healthy } = await httpGet(healthUrl);
      if (healthy) {
        info(`port ${port} occupied by a healthy process — ${label} (leaving it)`);
        continue;
      }
    }
    // Occupied but not healthy (or no health URL to verify) — kill it.
    const pids = findPidsOnPort(port);
    if (pids.length === 0) {
      warn(`port ${port} occupied but no PID found (may be a stale TIME_WAIT or portproxy) — ${label}`);
      continue;
    }
    for (const { pid, cmdline } of pids) {
      const killedOk = killPid(pid);
      if (killedOk) {
        warn(`killed zombie PID ${pid} on port ${port} (${cmdline || 'unknown'}) — ${label}`);
        killed++;
      } else {
        fail(`could not kill PID ${pid} on port ${port} — ${label}`);
      }
    }
    // Brief wait for the port to release.
    await sleep(500);
    if (await canConnect(port)) {
      fail(`port ${port} still occupied after kill — ${label}`);
    }
  }
  if (killed > 0) info(`${killed} zombie process(es) cleared`);
}

/** 2. Docker Desktop check */
async function checkDocker() {
  section('Docker Desktop check');
  // Quick: is the docker daemon answering?
  const dockerAlive = await checkDockerDaemon();
  if (dockerAlive) {
    ok('Docker daemon is running');
    return true;
  }
  // Try to start Docker Desktop (Windows) or dockerd (Linux).
  info('Docker daemon not responding — attempting to start it...');
  try {
    if (process.platform === 'win32') {
      // Common install locations for Docker Desktop on Windows.
      const candidates = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Docker', 'Docker', 'Docker Desktop.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker', 'Docker Desktop.exe'),
      ];
      let started = false;
      for (const exe of candidates) {
        if (fs.existsSync(exe)) {
          info(`launching: ${exe}`);
          exec(`"${exe}"`, { timeout: 5000 }, () => {});
          started = true;
          break;
        }
      }
      if (!started) {
        // Fall back to `start docker` which works if Docker is on PATH.
        exec('start "" "Docker Desktop"', { timeout: 5000 }, () => {});
      }
    } else {
      // Linux: try sudo systemctl start docker (may fail without sudo)
      exec('sudo systemctl start docker 2>/dev/null || systemctl start docker 2>/dev/null', { timeout: 10000 }, () => {});
    }
  } catch (e) {
    // Non-fatal — we'll poll and report a clear message if it doesn't come up.
  }
  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(DOCKER_POLL_INTERVAL_MS);
    if (await checkDockerDaemon()) {
      ok('Docker daemon started');
      return true;
    }
    const elapsed = Math.round((Date.now() - (deadline - DOCKER_START_TIMEOUT_MS)) / 1000);
    info(`waiting for Docker... ${elapsed}s`);
  }
  fail(`Docker Desktop did not start within ${DOCKER_START_TIMEOUT_MS / 1000}s — start it manually and re-run`);
  return false;
}

function checkDockerDaemon() {
  return new Promise((resolve) => {
    exec('docker info --format "{{.ServerVersion}}"', { timeout: 8000 }, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

/** 3. Supabase CLI version check */
async function checkSupabaseCli() {
  section('Supabase CLI version check');
  let version = '';
  try {
    version = execSync('npx supabase --version', { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    fail('could not run `npx supabase --version` — is the Supabase CLI installed?');
    return false;
  }
  if (version === REQUIRED_SUPABASE_CLI_VERSION) {
    ok(`supabase CLI v${version} (matches pinned version)`);
    return true;
  }
  fail(`supabase CLI version mismatch: found ${version}, expected ${REQUIRED_SUPABASE_CLI_VERSION}`);
  info(`install the pinned version:  npm install -D supabase@${REQUIRED_SUPABASE_CLI_VERSION}`);
  info(`or update REQUIRED_SUPABASE_CLI_VERSION in scripts/preflight.js if this is an intentional upgrade`);
  return false;
}

/** 4. Env var source verification */
async function checkEnvVars() {
  section('Environment variable check (.env.local source)');
  const envLocal = readEnvFile('.env.local');
  const envFile = readEnvFile('.env');
  const source = envLocal || envFile;
  if (!source) {
    fail('neither .env.local nor .env found — create .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return false;
  }
  const sourceName = envLocal ? '.env.local' : '.env';
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  let allOk = true;
  for (const key of required) {
    if (!source[key]) {
      fail(`${key} not found in ${sourceName}`);
      allOk = false;
    } else {
      ok(`${key} present in ${sourceName}`);
    }
  }
  // Also confirm process.env matches the file (not silently overridden).
  if (allOk && process.env.SUPABASE_URL && process.env.SUPABASE_URL !== source.SUPABASE_URL) {
    warn(`SUPABASE_URL in process.env differs from ${sourceName} — an external env var may be overriding it`);
  }
  return allOk;
}

/** 5. Live Stripe key guardrail */
async function checkStripeGuardrail() {
  section('Stripe live-key guardrail');
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    ok('STRIPE_SECRET_KEY not set — Stripe disabled (safe)');
    return true;
  }
  if (key.startsWith('sk_live_')) {
    if (process.env.ALLOW_LIVE_STRIPE === 'true') {
      warn('STRIPE_SECRET_KEY is a live key but ALLOW_LIVE_STRIPE=true — proceeding (this should only be set in production)');
      return true;
    }
    fail('STRIPE_SECRET_KEY starts with sk_live_ — ABORTING to prevent accidental live charges');
    fail('set ALLOW_LIVE_STRIPE=true only if you intentionally want live mode, or remove STRIPE_SECRET_KEY from your environment');
    // Identify which source it came from without printing the value.
    const envLocal = readEnvFile('.env.local');
    const envFile = readEnvFile('.env');
    if (envLocal && envLocal.STRIPE_SECRET_KEY) {
      fail(`source: .env.local (remove or replace the STRIPE_SECRET_KEY line there)`);
    } else if (envFile && envFile.STRIPE_SECRET_KEY) {
      fail(`source: .env (remove or replace the STRIPE_SECRET_KEY line there)`);
    } else {
      fail('source: external environment variable (check your shell / Windows user env vars: `setx STRIPE_SECRET_KEY ""` or remove it via System Properties)');
    }
    return false;
  }
  if (key.startsWith('sk_test_')) {
    ok('STRIPE_SECRET_KEY is a test key (sk_test_) — safe');
    return true;
  }
  warn(`STRIPE_SECRET_KEY is set but does not start with sk_live_ or sk_test_ — unexpected format, proceeding cautiously`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`${tag} ${CLR.bold}HYDI Preflight${CLR.reset} — ${new Date().toISOString()}`);
  let blocking = false;

  // 0. Canonical identity gate — abort if we're in the wrong repository.
  section('Canonical identity gate');
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/verify-canonical.js', { cwd: ROOT, stdio: 'inherit', timeout: 10000 });
  } catch (_) {
    fail('canonical identity gate failed — aborting preflight');
    process.exit(1);
  }

  // 5. Stripe guardrail — never proceed if a live key is present.
  if (!(await checkStripeGuardrail())) blocking = true;

  // 1. Ports / zombies
  await checkPorts();

  // 2. Docker
  if (!(await checkDocker())) blocking = true;

  // 3. Supabase CLI
  if (!(await checkSupabaseCli())) blocking = true;

  // 4. Env vars
  if (!(await checkEnvVars())) blocking = true;

  // Summary
  section('Summary');
  if (blocking) {
    fail('preflight found blocking issues — boot aborted. Fix the errors above and re-run.');
    process.exit(1);
  }
  ok('all preflight checks passed — ready to boot');
  process.exit(0);
}

main().catch((e) => {
  fail(`uncaught error: ${e.message}`);
  process.exit(1);
});
