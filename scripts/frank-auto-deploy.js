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
const path = require('path');
const { execFile } = require('child_process');
const board = require('../lib/forge-board/sdk');

const APP_NAME = 'frank-auto-deploy';
const INTERVAL_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 45 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 2 * 60 * 1000;
const HEALTH_INTERVAL_MS = 5 * 1000;
const HEALTH_CHECKS = Object.freeze([
  { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health' },
  { name: 'heidi-mobile', url: 'http://127.0.0.1:3006/api/health' },
  { name: 'heidi-core', url: 'http://127.0.0.1:3459/health' },
]);

function executable(name, platform = process.platform) {
  return platform === 'win32' && (name === 'npm' || name === 'pm2') ? `${name}.cmd` : name;
}

function execResult(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: options.cwd,
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
    const error = new Error(`${path.basename(file)} ${args[0] || ''} failed`);
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

function parseMergedPrTitles(raw) {
  return String(raw || '').split('\x1e').map((record) => record.trim()).filter(Boolean)
    .map((record) => {
      const lines = record.split('\n').map((line) => line.trim()).filter(Boolean);
      const merge = lines[0] && /^Merge pull request #(\d+)\b/.exec(lines[0]);
      if (!merge) return null;
      return `#${merge[1]} ${lines[1] || '(title unavailable)'}`;
    }).filter(Boolean);
}

async function pm2AppNames(run, root, platform) {
  const pm2 = executable('pm2', platform);
  const result = await mustRun(run, pm2, ['jlist'], { cwd: root, timeout: 30_000 });
  let apps;
  try { apps = JSON.parse(result.stdout); } catch { throw new Error('pm2 jlist returned invalid JSON'); }
  // Restart only apps that are actually online: stopped one-shots (e.g. the
  // cron-fired assessment crew) must not be resurrected, and this process
  // must never restart itself.
  return [...new Set((apps || [])
    .filter((app) => app && app.name && app.name !== APP_NAME && app.pm2_env && app.pm2_env.status === 'online')
    .map((app) => app.name))];
}

async function restartApps(run, root, platform) {
  const names = await pm2AppNames(run, root, platform);
  if (!names.length) throw new Error('no PM2 applications available to restart');
  await mustRun(run, executable('pm2', platform), ['restart', ...names, '--update-env'], {
    cwd: root,
    timeout: 2 * 60 * 1000,
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

async function rollback({ run, root, platform, oldCommit, lockChanged, healthOptions }) {
  await mustRun(run, 'git', ['reset', '--hard', oldCommit], { cwd: root });
  if (lockChanged) {
    await mustRun(run, executable('npm', platform), ['ci'], { cwd: root, timeout: 15 * 60 * 1000 });
  }
  await mustRun(run, executable('npm', platform), ['run', 'build'], { cwd: root, timeout: 20 * 60 * 1000 });
  await restoreGenerated(run, root);
  await restartApps(run, root, platform);
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
  let prTitles = [];

  // Alert once per distinct blocked/failed reason. The last reason persists
  // in .runtime so the long-lived loop does not spam #alerts every interval.
  const alertStatePath = overrides.alertStatePath || path.join(root, '.runtime', 'frank-auto-deploy-alert.json');
  const alert = async (reason, text) => {
    if (readAlertState(alertStatePath) === reason) return;
    await post('alerts', text);
    writeAlertState(alertStatePath, reason);
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
      const log = await mustRun(run, 'git', ['log', '--format=%B%x1e', `${oldCommit}..${newCommit}`], { cwd: root });
      prTitles = parseMergedPrTitles(log.stdout);
      const lockDiff = await mustRun(run, 'git', ['diff', '--name-only', oldCommit, newCommit, '--', 'package-lock.json'], { cwd: root });
      lockChanged = lockDiff.stdout.split(/\r?\n/).some((line) => line.trim() === 'package-lock.json');

      await mustRun(run, 'git', ['merge', '--ff-only', 'origin/clean-main'], { cwd: root });
      updated = true;
      if (lockChanged) {
        await mustRun(run, executable('npm', platform), ['ci'], { cwd: root, timeout: 15 * 60 * 1000 });
      }
      await mustRun(run, executable('npm', platform), ['run', 'build'], { cwd: root, timeout: 20 * 60 * 1000 });
      await restoreGenerated(run, root);
      await restartApps(run, root, platform);

      const health = await waitForHealth(healthOptions);
      if (!health.ok) {
        const failing = health.results.filter((check) => !check.ok).map((check) => check.name).join(', ');
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions });
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
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions });
        await alert(`rollback_error:${reason}`, `Frank auto-deploy rolled back after deployment error: ${reason}. Rollback health: ${healthText(rollbackHealth)}.`);
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
    clearAlertState(alertStatePath);
    await post('alerts', 'Frank auto-deploy unblocked — deploys resumed.');
  }
  return result;
}

if (require.main === module) {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await runAutoDeploy();
      if (result.status === 'failed' || result.status === 'rollback_failed') {
        console.error(`[${APP_NAME}] ${result.status}: ${result.reason || ''}`);
      }
    } catch (error) {
      console.error(`[${APP_NAME}] unhandled error:`, error instanceof Error ? error.message : error);
    } finally {
      inFlight = false;
    }
  };
  void tick();
  setInterval(tick, INTERVAL_MS);
}

module.exports = {
  APP_NAME,
  INTERVAL_MS,
  LOCK_STALE_MS,
  HEALTH_CHECKS,
  executable,
  pidAlive,
  lockIsStale,
  acquireLock,
  readAlertState,
  writeAlertState,
  clearAlertState,
  parseMergedPrTitles,
  waitForHealth,
  runAutoDeploy,
};
