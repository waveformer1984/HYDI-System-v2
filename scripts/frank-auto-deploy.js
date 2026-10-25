'use strict';

/**
 * Fast-forward-only deploy loop for Frank.
 *
 * Long-lived PM2 process (autorestart on): an internal loop runs one
 * deployment pass every five minutes — never via PM2 cron scheduling, which
 * would kill a run mid-build. It never writes environment files, never runs
 * tests, and never prints secrets. All operator-visible outcomes are posted
 * to Forge Board.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const board = require('../lib/forge-board/sdk');
const disk = require('../lib/storage/disk');

const APP_NAME = 'frank-auto-deploy';
const INTERVAL_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 45 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_INTERVAL_MS = 5 * 1000;
// The Next build goes to STAGING_DIR and is swapped in only once complete;
// the build it replaced stays in PREV_DIR so a rollback is a rename, not a
// rebuild (rebuilding under memory pressure is what failed on 2026-10-25).
const LIVE_DIR = '.next';
const STAGING_DIR = '.next-staging';
const PREV_DIR = '.next-prev';
const FAILED_DIR = '.next-failed';
const WEB_APP = 'heidi-web-standalone';
const BUILD_MARKERS = Object.freeze(['BUILD_ID', path.join('server', 'pages-manifest.json')]);
const GIB = 1024 ** 3;
const HEALTH_CHECKS = Object.freeze([
  { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health' },
  { name: 'heidi-mobile', url: 'http://127.0.0.1:3006/api/health' },
  { name: 'heidi-core', url: 'http://127.0.0.1:3459/health' },
]);

function executable(name, platform = process.platform) {
  return platform === 'win32' && (name === 'npm' || name === 'pm2') ? `${name}.cmd` : name;
}

// Node >= 20.12 refuses to spawn .cmd/.bat without a shell
// (CVE-2024-27980) — execFile('npm.cmd') throws EINVAL. Route batch files
// through cmd.exe; real executables keep shell:false.
function cmdNeedsShell(file, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}

function execResult(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: options.cwd,
      shell: cmdNeedsShell(file, options.platform),
      timeout: options.timeout || 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: options.env || process.env,
    }, (error, stdout, stderr) => {
      resolve({
        code: error && Number.isInteger(error.code) ? error.code : (error ? 1 : 0),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

async function mustRun(run, file, args, options) {
  const result = await run(file, args, options);
  if (!result || result.code !== 0) {
    const tail = String((result && (result.stderr || result.stdout)) || '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(-300);
    const error = new Error(`${path.basename(file)} ${args.slice(0, 2).join(' ')} failed${tail ? `: ${tail}` : ''}`);
    error.result = result;
    throw error;
  }
  return result;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function lockIsStale(lockPath, { now = Date.now, alive = pidAlive } = {}) {
  let record = null;
  try {
    record = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch { /* unreadable lock counts as stale by age only */ }
  if (record && Number.isInteger(record.pid) && !alive(record.pid)) return true;
  let startedAt = record && record.started_at ? Date.parse(record.started_at) : NaN;
  if (!Number.isFinite(startedAt)) {
    try { startedAt = fs.statSync(lockPath).mtimeMs; } catch { return false; }
  }
  return now() - startedAt > LOCK_STALE_MS;
}

function acquireLock(lockPath, opts = {}) {
  const log = opts.log || ((msg) => console.log(msg));
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
      };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (attempt === 0 && lockIsStale(lockPath, { now: opts.now, alive: opts.alive || opts.pidAlive })) {
        log(`[${APP_NAME}] removing stale lock ${lockPath}`);
        try { fs.unlinkSync(lockPath); } catch { /* raced */ }
        continue;
      }
      return null;
    }
  }
  return null;
}

function readAlertState(alertStatePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(alertStatePath, 'utf8'));
    return typeof parsed.last_reason === 'string' ? parsed.last_reason : null;
  } catch {
    return null;
  }
}

function writeAlertState(alertStatePath, reason) {
  fs.mkdirSync(path.dirname(alertStatePath), { recursive: true });
  fs.writeFileSync(alertStatePath, JSON.stringify({ last_reason: reason, at: new Date().toISOString() }));
}

function clearAlertState(alertStatePath) {
  try { fs.unlinkSync(alertStatePath); } catch { /* already absent */ }
}

function postSucceeded(result) {
  return Boolean(result && result.ok !== false && result.status !== 429 && !result.error);
}

function parseMergedPrTitles(raw) {
  return String(raw || '').split('\x1e').map((record) => record.trim()).filter(Boolean)
    .map((record) => {
      const lines = record.split('\n').map((line) => line.trim()).filter(Boolean);
      const merge = lines[0] && /^Merge pull request #(\d+)\b/.exec(lines[0]);
      if (!merge) return null;
      return `#${merge[1]} ${lines[1] || '(title unavailable)'}`;
    }).filter(Boolean);
}

// Apps a deploy must never restart even when online. The ngrok tunnel is
// external (no repo code to reload) and a restart rotates its free-tier
// public URL, which breaks the Stripe webhook and BILLING_APP_URL.
const NEVER_RESTART = Object.freeze(['hydi-public-tunnel']);

function loadEcosystemFresh(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

/**
 * Names of apps declared `external: true` in ecosystem.config.js (binaries
 * outside this repo — a deploy has nothing to reload in them). Read fresh
 * after the pull so a newly declared external app is honoured. A config
 * that can't be read yields only the built-in NEVER_RESTART list.
 */
function externalAppNames(root, loader = loadEcosystemFresh) {
  try {
    const config = loader(path.join(root, 'ecosystem.config.js'));
    const apps = (config && Array.isArray(config.apps)) ? config.apps : [];
    return apps.filter((app) => app && app.external === true && app.name).map((app) => app.name);
  } catch {
    return [];
  }
}

function skippedApps(root, loader) {
  return new Set([APP_NAME, ...NEVER_RESTART, ...externalAppNames(root, loader)]);
}

async function pm2AppNames(run, root, platform, skip = skippedApps(root)) {
  const pm2 = executable('pm2', platform);
  const result = await mustRun(run, pm2, ['jlist'], { cwd: root, timeout: 30_000 });
  let apps;
  try { apps = JSON.parse(result.stdout); } catch { throw new Error('pm2 jlist returned invalid JSON'); }
  // Restart only apps that are actually online: stopped one-shots (e.g. the
  // cron-fired assessment crew) must not be resurrected, this process must
  // never restart itself, and external apps (the ngrok tunnel) are left
  // alone.
  return [...new Set((apps || [])
    .filter((app) => app && app.name && !skip.has(app.name) && app.pm2_env && app.pm2_env.status === 'online')
    .map((app) => app.name))];
}

async function restartApps(run, root, platform, extra = []) {
  const names = [...new Set([...(await pm2AppNames(run, root, platform)), ...extra])];
  if (!names.length) throw new Error('no PM2 applications available to restart');
  await mustRun(run, executable('pm2', platform), ['restart', ...names, '--update-env'], {
    cwd: root,
    timeout: 10 * 60 * 1000,
  });
  return names;
}

async function defaultProbe(check) {
  const started = Date.now();
  try {
    const response = await fetch(check.url, {
      method: 'GET',
      signal: AbortSignal.timeout(4_000),
    });
    return { name: check.name, ok: response.ok, status: response.status, ms: Date.now() - started };
  } catch {
    return { name: check.name, ok: false, status: 0, ms: Date.now() - started };
  }
}

async function waitForHealth({
  checks = HEALTH_CHECKS,
  probe = defaultProbe,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = HEALTH_TIMEOUT_MS,
  intervalMs = HEALTH_INTERVAL_MS,
} = {}) {
  const deadline = now() + timeoutMs;
  let results = [];
  do {
    results = await Promise.all(checks.map((check) => probe(check)));
    if (results.every((result) => result.ok)) return { ok: true, results };
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  return { ok: false, results };
}

function healthText(health) {
  return (health.results || []).map((result) =>
    `${result.name}:${result.ok ? `ok(${result.status})` : `FAIL(${result.status || 'unreachable'})`}`).join(', ');
}

async function restoreGenerated(run, root) {
  // Build outputs like next-env.d.ts are regenerated every build and must
  // never count as dirty — restore them after each build and before checks.
  await run('git', ['checkout', '--', 'next-env.d.ts'], { cwd: root });
}

const realFs = Object.freeze({
  exists: (p) => fs.existsSync(p),
  rm: (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 }),
  rename: (a, b) => fs.renameSync(a, b),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
});

/** Free RAM gate. A build below this fails partway; better to wait. */
function memoryPreflight(env = process.env, freemem = os.freemem) {
  const n = Number(env.HYDI_DEPLOY_MIN_FREE_RAM_GB);
  const minGb = Number.isFinite(n) && n > 0 ? n : 0.75;
  const freeGb = Math.round((freemem() / GIB) * 100) / 100;
  return freeGb >= minGb
    ? { ok: true, freeGb, reason: 'ok' }
    : { ok: false, freeGb, reason: `only ${freeGb} GB RAM free, needs ${minGb} GB` };
}

/**
 * Build into STAGING_DIR while the live site keeps serving LIVE_DIR.
 * Throws if the build fails or leaves an incomplete output.
 */
async function stagedBuild({ run, root, platform, fsx = realFs, env = process.env }) {
  const staging = path.join(root, STAGING_DIR);
  fsx.rm(staging);
  fsx.rm(path.join(root, FAILED_DIR));
  // Carry the webpack cache over so staged builds stay incremental.
  const liveCache = path.join(root, LIVE_DIR, 'cache');
  if (fsx.exists(liveCache)) {
    fsx.mkdir(staging);
    try { fsx.rename(liveCache, path.join(staging, 'cache')); } catch { /* in use; build without it */ }
  }
  await mustRun(run, executable('npm', platform), ['run', 'build'], {
    cwd: root,
    timeout: 20 * 60 * 1000,
    env: { ...env, HYDI_NEXT_DIST_DIR: STAGING_DIR },
  });
  const missing = BUILD_MARKERS.filter((f) => !fsx.exists(path.join(staging, f)));
  if (missing.length) throw new Error(`build incomplete: ${missing.join(', ')} missing`);
}

/**
 * Rename `from` over LIVE_DIR, keeping what was live at `keepAs`. Windows
 * can refuse to rename a directory the running server holds open; then stop
 * the web app, retry, and report it so the caller starts it again.
 */
async function swapLive({ run, root, platform, from, keepAs, fsx = realFs }) {
  const live = path.join(root, LIVE_DIR);
  const source = path.join(root, from);
  const keep = path.join(root, keepAs);
  const attempt = () => {
    fsx.rm(keep);
    if (fsx.exists(live)) fsx.rename(live, keep);
    try {
      fsx.rename(source, live);
    } catch (error) {
      if (!fsx.exists(live) && fsx.exists(keep)) fsx.rename(keep, live);
      throw error;
    }
  };
  try {
    attempt();
    return { stoppedWeb: false };
  } catch {
    await run(executable('pm2', platform), ['stop', WEB_APP], { cwd: root, timeout: 60 * 1000 });
    attempt();
    return { stoppedWeb: true };
  }
}

async function rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped = false, fsx = realFs }) {
  await mustRun(run, 'git', ['reset', '--hard', oldCommit], { cwd: root });
  if (lockChanged) {
    await mustRun(run, executable('npm', platform), ['ci'], { cwd: root, timeout: 15 * 60 * 1000 });
  }
  // The build never went live: the running apps still have the old code and
  // the old .next, so there is nothing to rebuild or restart.
  if (!swapped) {
    fsx.rm(path.join(root, STAGING_DIR));
    return waitForHealth(healthOptions);
  }
  let extra = [];
  if (fsx.exists(path.join(root, PREV_DIR))) {
    const swap = await swapLive({ run, root, platform, from: PREV_DIR, keepAs: FAILED_DIR, fsx });
    if (swap.stoppedWeb) extra = [WEB_APP];
  } else {
    // No previous build kept (first staged deploy): fall back to rebuilding.
    await mustRun(run, executable('npm', platform), ['run', 'build'], { cwd: root, timeout: 20 * 60 * 1000 });
  }
  await restoreGenerated(run, root);
  await restartApps(run, root, platform, extra);
  return waitForHealth(healthOptions);
}

async function runAutoDeploy(overrides = {}) {
  const root = overrides.root || path.resolve(__dirname, '..');
  const platform = overrides.platform || process.platform;
  const run = overrides.run || execResult;
  const now = overrides.now || (() => Date.now());
  const post = overrides.post || ((channel, body) => board.post(channel, body, null, { sender: 'hydi-daemon' }));
  const lockPath = overrides.lockPath || path.join(root, '.runtime', 'frank-auto-deploy.lock');
  const lock = (overrides.acquireLock || acquireLock)(lockPath);
  if (!lock) return { status: 'lock_held' };

  const started = now();
  let oldCommit = null;
  let newCommit = null;
  let updated = false;
  let lockChanged = false;
  let swapped = false;
  let prTitles = [];
  const fsx = overrides.fsx || realFs;

  // Alert once per distinct blocked/failed reason. The last reason persists
  // in .runtime so the long-lived loop does not spam #alerts every interval.
  const alertStatePath = overrides.alertStatePath || path.join(root, '.runtime', 'frank-auto-deploy-alert.json');
  const alert = async (reason, text) => {
    if (readAlertState(alertStatePath) === reason) return;
    const sent = await post('alerts', text);
    if (postSucceeded(sent)) writeAlertState(alertStatePath, reason);
  };
  const healthOptions = {
    probe: overrides.probe,
    now,
    sleep: overrides.sleep,
    timeoutMs: overrides.healthTimeoutMs,
    intervalMs: overrides.healthIntervalMs,
  };
  Object.keys(healthOptions).forEach((key) => healthOptions[key] === undefined && delete healthOptions[key]);

  let result;
  try {
    await mustRun(run, 'git', ['fetch', 'origin', 'clean-main'], { cwd: root });
    const branch = (await mustRun(run, 'git', ['branch', '--show-current'], { cwd: root })).stdout.trim();
    await restoreGenerated(run, root);
    const dirty = (await mustRun(run, 'git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root })).stdout.trim();
    if (branch !== 'clean-main' || dirty) {
      const reason = branch !== 'clean-main' ? `branch is ${branch || 'detached'}, expected clean-main` : 'working tree is dirty';
      await alert(reason, `Frank auto-deploy stopped: ${reason}. Nothing changed.`);
      result = { status: 'blocked', reason };
    } else {
      oldCommit = (await mustRun(run, 'git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
      newCommit = (await mustRun(run, 'git', ['rev-parse', 'origin/clean-main'], { cwd: root })).stdout.trim();
      if (oldCommit === newCommit) {
        result = { status: 'noop' };
      } else {
        const ancestor = await run('git', ['merge-base', '--is-ancestor', oldCommit, newCommit], { cwd: root });
        if (!ancestor || ancestor.code !== 0) {
          const reason = 'local clean-main cannot fast-forward to origin/clean-main';
          await alert(reason, `Frank auto-deploy stopped: ${reason}. Nothing changed.`);
          result = { status: 'blocked', reason };
        }
      }
    }

    if (!result) {
      // A build on a nearly full disk fails halfway and forces a rollback;
      // refuse up front instead. Fails closed when free space is unreadable.
      const minFreeGb = disk.gateFloors(overrides.env || process.env).deployGb;
      const space = (overrides.diskPreflight || disk.preflight)({ minFreeGb, volume: disk.defaultVolume(root) });
      if (!space.ok) {
        const reason = `low disk: ${space.reason}`;
        await alert('low_disk', `Frank auto-deploy paused: ${space.reason}. Nothing changed. It resumes on its own once space is freed (docs/STORAGE_PROGRAM.md).`);
        result = { status: 'blocked', reason };
      }
    }

    if (!result) {
      const mem = (overrides.memoryPreflight || memoryPreflight)(overrides.env || process.env);
      if (!mem.ok) {
        const reason = `low memory: ${mem.reason}`;
        await alert('low_memory', `Frank auto-deploy waiting: ${mem.reason}. Nothing changed. Close apps you aren't using on Frank; it retries every 5 minutes.`);
        result = { status: 'blocked', reason };
      }
    }

    if (!result) {
      const log = await mustRun(run, 'git', ['log', '--format=%B%x1e', `${oldCommit}..${newCommit}`], { cwd: root });
      prTitles = parseMergedPrTitles(log.stdout);
      const lockDiff = await mustRun(run, 'git', ['diff', '--name-only', oldCommit, newCommit, '--', 'package-lock.json'], { cwd: root });
      lockChanged = lockDiff.stdout.split(/\r?\n/).some((line) => line.trim() === 'package-lock.json');

      await mustRun(run, 'git', ['merge', '--ff-only', 'origin/clean-main'], { cwd: root });
      updated = true;
      if (lockChanged) {
        await mustRun(run, executable('npm', platform), ['ci'], { cwd: root, timeout: 15 * 60 * 1000 });
      }
      await stagedBuild({ run, root, platform, fsx, env: overrides.env || process.env });
      await restoreGenerated(run, root);
      const swap = await swapLive({ run, root, platform, from: STAGING_DIR, keepAs: PREV_DIR, fsx });
      swapped = true;
      await restartApps(run, root, platform, swap.stoppedWeb ? [WEB_APP] : []);

      const health = await waitForHealth(healthOptions);
      if (!health.ok) {
        const failing = health.results.filter((check) => !check.ok).map((check) => check.name).join(', ');
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped, fsx });
        await alert(
          `rollback:${newCommit}`,
          `Frank auto-deploy rolled back ${newCommit.slice(0, 8)} to ${oldCommit.slice(0, 8)}; failing check: ${failing}. Rollback health: ${healthText(rollbackHealth)}.`,
        );
        await post('ops', [
          `Frank deploy rolled back: ${oldCommit.slice(0, 8)}→${newCommit.slice(0, 8)}→${oldCommit.slice(0, 8)}`,
          `Merged PRs: ${prTitles.join('; ') || 'none detected'}`,
          `Failed health: ${healthText(health)}`,
          `Rollback health: ${healthText(rollbackHealth)}`,
          `Duration: ${Math.round((now() - started) / 1000)}s`,
        ].join('\n'));
        result = { status: 'rolled_back', oldCommit, newCommit, health, rollbackHealth };
      } else {
        await post('ops', [
          `Frank deployed: ${oldCommit.slice(0, 8)}→${newCommit.slice(0, 8)}`,
          `Merged PRs: ${prTitles.join('; ') || 'none detected'}`,
          `Health: ${healthText(health)}`,
          `Duration: ${Math.round((now() - started) / 1000)}s`,
        ].join('\n'));
        result = { status: 'deployed', oldCommit, newCommit, health };
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown deployment failure';
    if (updated && oldCommit) {
      try {
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped, fsx });
        const where = swapped ? 'restored the previous build' : 'the live site was never touched';
        await alert(`rollback_error:${reason}`, `Frank auto-deploy rolled back after deployment error (${where}): ${reason}. Health: ${healthText(rollbackHealth)}.`);
        result = { status: 'rolled_back', oldCommit, newCommit, reason, rollbackHealth };
      } catch {
        await alert(`rollback_failed:${reason}`, `Frank auto-deploy ROLLBACK FAILED after: ${reason}. Human intervention required.`);
        result = { status: 'rollback_failed', oldCommit, newCommit, reason };
      }
    } else {
      await alert(`failed:${reason}`, `Frank auto-deploy failed before update: ${reason}. Nothing changed.`);
      result = { status: 'failed', reason };
    }
  } finally {
    lock();
  }

  // A successful pass clears any standing blocked/failed alert — post once.
  if ((result.status === 'noop' || result.status === 'deployed') && readAlertState(alertStatePath) !== null) {
    const sent = await post('alerts', 'Frank auto-deploy unblocked — deploys resumed.');
    if (postSucceeded(sent)) clearAlertState(alertStatePath);
  }
  return result;
}

function startDeployLoop({
  deploy = runAutoDeploy,
  intervalMs = INTERVAL_MS,
  setIntervalFn = setInterval,
  log = (message) => console.error(message),
} = {}) {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await deploy();
      if (result.status === 'failed' || result.status === 'rollback_failed') {
        log(`[${APP_NAME}] ${result.status}: ${result.reason || ''}`);
      }
    } catch (error) {
      log(`[${APP_NAME}] unhandled error: ${error instanceof Error ? error.message : error}`);
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const timer = setIntervalFn(tick, intervalMs);
  return { tick, timer };
}

if (require.main === module) {
  require('../lib/runtime/board-env').loadBoardEnv(path.resolve(__dirname, '..'));
  require('../lib/runtime/provenance').recordProcessProvenance(APP_NAME).then(() => startDeployLoop());
}

module.exports = {
  APP_NAME,
  INTERVAL_MS,
  LOCK_STALE_MS,
  HEALTH_CHECKS,
  NEVER_RESTART,
  externalAppNames,
  pm2AppNames,
  executable,
  cmdNeedsShell,
  pidAlive,
  lockIsStale,
  acquireLock,
  readAlertState,
  writeAlertState,
  clearAlertState,
  postSucceeded,
  parseMergedPrTitles,
  waitForHealth,
  memoryPreflight,
  stagedBuild,
  swapLive,
  rollback,
  LIVE_DIR,
  STAGING_DIR,
  PREV_DIR,
  WEB_APP,
  runAutoDeploy,
  startDeployLoop,
};
