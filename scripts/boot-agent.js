#!/usr/bin/env node
'use strict';
/**
 * HYDI BOOT AGENT
 * ----------------------------------------------------------------------------
 * Boots Heidi (Next.js web layer) and all subsequent ProtoForged modules in
 * dependency order, with preflight checks, health gating, live status, and
 * graceful shutdown.
 *
 * The module set is data-driven: see ../boot.config.json. To add a new module
 * to the boot sequence, append an entry to that file -- no code changes needed.
 *
 * Usage:
 *   node scripts/boot-agent.js [flags]
 *   npm run boot                 # dev mode (next dev)
 *   npm run boot:prod            # prod mode (next start, requires a build)
 *
 * Flags:
 *   --prod              Use production commands (argsProd) where defined.
 *   --only=a,b          Boot only these module ids (plus their dependencies).
 *   --skip=a,b          Skip these module ids.
 *   --no-health         Spawn everything without waiting on health checks.
 *   --dry-run           Print the resolved boot plan and exit (starts nothing).
 *   --json              Emit machine-readable status lines (for supervisors).
 *   --config=PATH       Use an alternate boot.config.json.
 *   -h, --help          Show help.
 *
 * Exit codes: 0 = clean shutdown / dry-run; 1 = a required module failed.
 * ----------------------------------------------------------------------------
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Load .env.local first (real config), then .env as fallback — matches the
// load order in src/server.js so boot-agent's preflight sees the same env vars
// the actual services will use.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(ROOT, '.env.local') });
  dotenv.config({ path: path.resolve(ROOT, '.env') });
} catch (_) { /* dotenv optional */ }

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {
  prod: argv.includes('--prod'),
  noHealth: argv.includes('--no-health'),
  dryRun: argv.includes('--dry-run'),
  json: argv.includes('--json'),
  help: argv.includes('-h') || argv.includes('--help'),
};
const getVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const only = (getVal('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const skip = (getVal('skip') || '').split(',').map((s) => s.trim()).filter(Boolean);
const CONFIG_PATH = path.resolve(ROOT, getVal('config') || 'boot.config.json');

if (flags.help) {
  console.log(fs.readFileSync(__filename, 'utf8').split('* Usage:')[1].split('* ---')[0].replace(/^\s*\*/gm, '   '));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const COLORS = ['36', '32', '35', '33', '34', '31', '92', '95'];
const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const colorFor = (() => {
  const map = new Map();
  let i = 0;
  return (id) => {
    if (!map.has(id)) map.set(id, COLORS[i++ % COLORS.length]);
    return map.get(id);
  };
})();
const ts = () => new Date().toISOString().slice(11, 23);
function log(id, line) {
  if (flags.json) {
    process.stdout.write(JSON.stringify({ t: Date.now(), module: id, line: String(line) }) + '\n');
    return;
  }
  const tag = c(colorFor(id), `[${id}]`.padEnd(20));
  String(line).replace(/\s+$/, '').split('\n').forEach((l) => {
    process.stdout.write(`${c('90', ts())} ${tag} ${l}\n`);
  });
}
const banner = (s) => !flags.json && console.log(c('1', `\n=== ${s} ===`));

// ---------------------------------------------------------------------------
// Config load + validation
// ---------------------------------------------------------------------------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Boot config not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`Boot config is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  cfg.settings = cfg.settings || {};
  cfg.modules = Array.isArray(cfg.modules) ? cfg.modules : [];
  return cfg;
}

// Resolve which modules to boot, honoring --only/--skip and pulling in deps.
function selectModules(all) {
  const byId = new Map(all.map((m) => [m.id, m]));
  let chosen = all.filter((m) => m.enabled !== false);
  if (only.length) {
    const want = new Set();
    const pull = (id) => {
      if (want.has(id) || !byId.has(id)) return;
      want.add(id);
      (byId.get(id).dependsOn || []).forEach(pull);
    };
    only.forEach(pull);
    chosen = all.filter((m) => want.has(m.id)); // deps win even if disabled
  }
  if (skip.length) chosen = chosen.filter((m) => !skip.includes(m.id));
  return chosen;
}

// Topological sort by dependsOn (Kahn). Throws on cycle.
function topoSort(modules) {
  const ids = new Set(modules.map((m) => m.id));
  const indeg = new Map(modules.map((m) => [m.id, 0]));
  const edges = new Map(modules.map((m) => [m.id, []]));
  for (const m of modules) {
    for (const dep of m.dependsOn || []) {
      if (!ids.has(dep)) continue; // dep not in this run -> ignore ordering
      edges.get(dep).push(m.id);
      indeg.set(m.id, indeg.get(m.id) + 1);
    }
  }
  const queue = modules.filter((m) => indeg.get(m.id) === 0).map((m) => m.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of edges.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== modules.length) {
    throw new Error('Dependency cycle detected in boot.config.json');
  }
  const byId = new Map(modules.map((m) => [m.id, m]));
  return order.map((id) => byId.get(id));
}

// ---------------------------------------------------------------------------
// Health / liveness
// ---------------------------------------------------------------------------
function httpOk(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500); // 4xx still = listening
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function waitForHealth(mod, settings, child) {
  const h = mod.health;
  const grace = (h && h.graceMs) || settings.defaultGraceMs || 120000;
  const interval = (h && h.intervalMs) || settings.defaultIntervalMs || 2000;
  const deadline = Date.now() + grace;
  while (Date.now() < deadline) {
    if (child && child.exitedEarly) return false;
    if (await httpOk(h.url)) return true;
    await sleep(interval);
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
const running = []; // { mod, child | instance, type }
let shuttingDown = false;
let failed = false;

// Module env values of the form "${VAR_NAME}" are resolved against the
// boot agent's own process.env at spawn time (e.g. "${HEIDI_TLS_CERT}"
// pulls in whatever HEIDI_TLS_CERT is set to in .env) rather than being
// passed through as that literal placeholder string. Resolves to '' when
// the referenced var is unset, matching how an absent env var already
// behaves.
function resolveEnvValue(val) {
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(val);
  return m ? (process.env[m[1]] || '') : val;
}

function spawnProcess(mod) {
  const args = (flags.prod && mod.argsProd) ? mod.argsProd : mod.args || [];
  const resolvedEnv = Object.fromEntries(
    Object.entries(mod.env || {}).map(([k, v]) => [k, resolveEnvValue(v)])
  );
  const child = spawn(mod.command, args, {
    cwd: ROOT,
    env: { ...process.env, ...resolvedEnv },
    shell: true, // resolves npm/python on Windows + PATH lookups everywhere
  });
  child.exitedEarly = false;
  child.stdout.on('data', (d) => log(mod.id, d.toString()));
  child.stderr.on('data', (d) => log(mod.id, d.toString()));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    child.exitedEarly = true;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    log(mod.id, c('31', `process exited unexpectedly (${how})`));
    if (mod.required) {
      failed = true;
      log(mod.id, c('31', 'required module down -> initiating shutdown'));
      shutdown(1);
    }
  });
  return child;
}

async function startModule(mod, settings) {
  const cmd = mod.type === 'process'
    ? `${mod.command} ${((flags.prod && mod.argsProd) || mod.args || []).join(' ')}`
    : mod.module;
  log(mod.id, `starting ${c('1', mod.label)}  ${c('90', '(' + cmd + ')')}`);

  if (mod.type === 'process') {
    const child = spawnProcess(mod);
    running.push({ mod, child, type: 'process' });
    if (mod.port) log(mod.id, `pid ${child.pid} -> port ${mod.port}`);

    if (flags.noHealth) return true;
    if (mod.health) {
      const ok = await waitForHealth(mod, settings, child);
      if (ok) { log(mod.id, c('32', `healthy (${mod.health.url})`)); return true; }
      log(mod.id, c('31', `did not become healthy within grace window`));
      return !mod.required;
    }
    // No HTTP health -> liveness check: stay alive for livenessMs.
    const live = mod.livenessMs || 4000;
    await sleep(live);
    if (child.exitedEarly) { log(mod.id, c('31', 'exited during liveness window')); return !mod.required; }
    log(mod.id, c('32', `alive (${live}ms liveness ok)`));
    return true;
  }

  if (mod.type === 'module') {
    try {
      const abs = path.resolve(ROOT, mod.module);
      const loaded = require(abs);
      const target = (mod.export && mod.export !== 'default') ? loaded[mod.export] : (loaded.default || loaded);
      let instance = target;
      if (mod.construct && typeof target === 'function') {
        instance = new target(mod.config || {});
      }
      if (mod.method && typeof instance[mod.method] === 'function') {
        await instance[mod.method]();
      }
      running.push({ mod, instance, type: 'module' });
      log(mod.id, c('32', 'in-process module started'));
      return true;
    } catch (e) {
      log(mod.id, c('31', `failed to start: ${e.message}`));
      if (mod.required) failed = true;
      return !mod.required;
    }
  }

  log(mod.id, c('31', `unknown module type "${mod.type}"`));
  return !mod.required;
}

// ---------------------------------------------------------------------------
// External preflight — runs scripts/preflight.js which handles port zombies,
// Docker, Supabase CLI version, env source verification, and the live Stripe
// key guardrail.  Exits non-zero on blocking issues, which we check here.
// ---------------------------------------------------------------------------
function runExternalPreflight() {
  return new Promise((resolve) => {
    const child = spawn('node', [path.resolve(ROOT, 'scripts/preflight.js')], {
      cwd: ROOT,
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', (e) => {
      log('preflight', c('31', `failed to run scripts/preflight.js: ${e.message}`));
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Preflight (internal — node version + env presence)
// ---------------------------------------------------------------------------
function preflight(settings) {
  banner('Preflight (internal)');
  let blocking = false;

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) log('preflight', c('32', `node ${process.version} (>=20 ok)`));
  else { log('preflight', c('31', `node ${process.version} -- requires >=20`)); blocking = true; }

  const envFile = ['.env', '.env.local'].map((f) => path.join(ROOT, f)).find(fs.existsSync);
  log('preflight', envFile ? c('32', `env file: ${path.basename(envFile)}`) : c('33', 'no .env/.env.local found'));

  for (const key of settings.requiredEnv || []) {
    if (process.env[key]) log('preflight', c('32', `${key} present`));
    else { log('preflight', c('31', `${key} MISSING (required)`)); blocking = true; }
  }
  for (const key of settings.warnEnv || []) {
    if (!process.env[key]) log('preflight', c('33', `${key} not set (warn)`));
  }
  return !blocking;
}

// Check if a port is occupied AND healthy.  "Port in use" alone is NOT
// enough — a zombie process holding the port without answering health
// checks must not be treated as "already running".  This was the root cause
// of the boot hangs in the prior session.
async function portInUseAndHealthy(mod) {
  if (!mod.port) return false;
  // If the module has a health endpoint, require it to answer.
  if (mod.health && mod.health.url) {
    return httpOk(mod.health.url, 2000);
  }
  // No health endpoint — fall back to TCP connect.
  return httpOk(`http://127.0.0.1:${mod.port}/`, 1200);
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  banner('Shutdown');
  const timeout = (CONFIG.settings.shutdownTimeoutMs) || 8000;

  // Stop in reverse boot order.
  for (const entry of [...running].reverse()) {
    const { mod } = entry;
    try {
      if (entry.type === 'module' && entry.instance && mod.stopMethod && typeof entry.instance[mod.stopMethod] === 'function') {
        log(mod.id, 'stopping in-process module...');
        await entry.instance[mod.stopMethod]();
      } else if (entry.type === 'process' && entry.child && entry.child.exitCode === null) {
        log(mod.id, 'sending SIGTERM...');
        entry.child.kill('SIGTERM');
        const killed = await Promise.race([
          new Promise((r) => entry.child.once('exit', () => r(true))),
          sleep(timeout).then(() => false),
        ]);
        if (!killed) { log(mod.id, c('33', 'SIGTERM timed out -> SIGKILL')); entry.child.kill('SIGKILL'); }
      }
    } catch (e) {
      log(mod.id, c('31', `error during stop: ${e.message}`));
    }
  }
  log('boot-agent', code === 0 ? c('32', 'all modules stopped. bye.') : c('31', 'shutdown after failure.'));
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e); shutdown(1); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const CONFIG = loadConfig();

async function main() {
  banner('HYDI Boot Agent');
  const settings = CONFIG.settings;
  const selected = selectModules(CONFIG.modules);
  let order;
  try {
    order = topoSort(selected);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (!flags.json) {
    console.log(`Mode: ${flags.prod ? 'production' : 'development'}   Modules: ${order.length}`);
    order.forEach((m, i) => {
      const dep = (m.dependsOn || []).length ? c('90', ` after [${m.dependsOn.join(', ')}]`) : '';
      console.log(`  ${i + 1}. ${c('1', m.id)} -- ${m.label}${dep}`);
    });
  }

  if (flags.dryRun) {
    banner('Dry run -- nothing started');
    process.exit(0);
  }

  // External preflight: port zombies, Docker, Supabase CLI, env source,
  // Stripe live-key guardrail.  This is the heavy lifter.
  banner('Preflight (external)');
  const extOk = await runExternalPreflight();
  if (!extOk) {
    console.error(c('31', '\nExternal preflight failed. Aborting.'));
    process.exit(1);
  }

  // Internal preflight: node version + env presence (fast, redundant safety).
  if (!preflight(settings)) {
    console.error(c('31', '\nPreflight failed (missing required env or node version). Aborting.'));
    process.exit(1);
  }

  banner('Booting');
  for (const mod of order) {
    if (mod.type === 'process' && mod.port && await portInUseAndHealthy(mod)) {
      log(mod.id, c('33', `port ${mod.port} occupied by a healthy process -- assuming already running, skipping spawn`));
      running.push({ mod, child: null, type: 'process', external: true });
      continue;
    }
    const ok = await startModule(mod, settings);
    if (!ok && mod.required) {
      log(mod.id, c('31', 'required module failed to start.'));
      await shutdown(1);
      return;
    }
  }

  banner('Boot complete');
  const lines = running.map((r) => {
    const port = r.mod.port ? `:${r.mod.port}` : '';
    const state = r.external ? 'external' : 'up';
    return `  ${c('32', '●')} ${r.mod.id.padEnd(20)} ${state}${port}`;
  });
  console.log(lines.join('\n'));
  console.log(c('90', '\nHeidi web:        http://127.0.0.1:3000'));
  console.log(c('90', 'ProtoForge core:  http://127.0.0.1:3005/health'));
  console.log(c('90', 'Tailnet (HTTPS):  https://heidi-pc.tailc50af2.ts.net/'));
  console.log(c('1', '\nBoot agent supervising. Press Ctrl+C to shut everything down.\n'));
}

main().catch((e) => { console.error(e); shutdown(1); });
