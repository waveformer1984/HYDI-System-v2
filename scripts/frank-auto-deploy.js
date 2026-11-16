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
const crypto = require('crypto');
const { execFile } = require('child_process');
const board = require('../lib/forge-board/sdk');
const disk = require('../lib/storage/disk');
const { readBuildStamp } = require('../lib/runtime/provenance');

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
// node_modules gets the same treatment as .next: the complete tree is moved
// aside before `npm ci` rebuilds it, so a failed install or a later rollback
// restores the previous runnable tree by rename — never by another install.
// 2026-11-16 incident: rollback ran `npm ci` in the live root, it EPERMed
// unlinking a locked esbuild.exe, and left node_modules gutted — heidi-web
// and hydi-daemon could no longer restart at all.
const NM_PREV_DIR = '.node_modules-prev';
const NM_FAILED_DIR = '.node_modules-failed';
// Extra free-space floor (GB) while a preserved + fresh node_modules coexist.
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

/**
 * The commit a stale-build rebuild was last attempted for and failed. One
 * failed rebuild of a commit is enough: without this marker the loop would
 * rebuild (and roll back) the same commit every five minutes. A new commit
 * on clean-main, or a successful rebuild, clears it.
 */
function readRebuildMarker(markerPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return typeof parsed.commit === 'string' ? parsed.commit : null;
  } catch {
    return null;
  }
}

function writeRebuildMarker(markerPath, commit) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ commit, at: new Date().toISOString() }));
}

function clearRebuildMarker(markerPath) {
  try { fs.unlinkSync(markerPath); } catch { /* already absent */ }
}

/**
 * The health checks a deploy must pass: every check that was passing before
 * the deploy started, plus heidi-web (the app being deployed) always. A
 * service that was already down — e.g. heidi-mobile-chat waiting for its
 * token after a reboot — cannot be made healthy by a deploy, and requiring
 * it would roll back every deploy until someone restarted it by hand.
 */
function requiredChecks(baseline, checks = HEALTH_CHECKS) {
  const passing = new Set(((baseline && baseline.results) || []).filter((r) => r.ok).map((r) => r.name));
  return checks.filter((check) => check.name === 'heidi-web' || passing.has(check.name));
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
  return ((health && health.results) || []).map((result) =>
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
  // Copies the contents of directory a into directory b (created if needed).
  copy: (a, b) => fs.cpSync(a, b, { recursive: true, force: true }),
  // Removes everything inside p but keeps p itself.
  emptyDir: (p) => {
    for (const name of fs.readdirSync(p)) {
      fs.rmSync(path.join(p, name), { recursive: true, force: true, maxRetries: 2 });
    }
  },
  readFile: (p) => fs.readFileSync(p),
  writeFile: (p, c) => fs.writeFileSync(p, c),
});

/**
 * Free RAM gate. A build below this fails partway; better to wait.
 * The default was 0.75 GB until 2026-11-02, when two unattended deploys of
 * the same commit passed this gate, rolled back about 8-15 minutes into the
 * build, and left Frank at 0.2-0.5 GB free: most likely out of memory in
 * `next build`. The last hand build that finished started with 1.9 GB free.
 */
const DEFAULT_MIN_FREE_RAM_GB = 1.5;

function memoryPreflight(env = process.env, freemem = os.freemem) {
  const n = Number(env.HYDI_DEPLOY_MIN_FREE_RAM_GB);
  const minGb = Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_FREE_RAM_GB;
  const freeGb = Math.round((freemem() / GIB) * 100) / 100;
  return freeGb >= minGb
    ? { ok: true, freeGb, reason: 'ok' }
    : { ok: false, freeGb, reason: `only ${freeGb} GB RAM free, needs ${minGb} GB` };
}

/**
 * Environment for the `npm run build` child. `next build` only defaults
 * NODE_ENV when it is unset, and frank-auto-deploy itself runs under PM2 with
 * NODE_ENV=development (ecosystem.config.js) — that value used to leak into
 * the build and ran prerendering in dev mode, killing export workers on
 * 2026-11-15. NODE_ENV is therefore pinned here rather than trusted from the
 * inherited environment. HYDI_BUILD_CPUS maps to next.config.js
 * experimental.cpus (the supported worker-count knob); it defaults to 1
 * because Frank's 16 GB host cannot afford Next's CPU-count default, and is
 * overridable per-host. `extra` carries per-callsite values like
 * HYDI_NEXT_DIST_DIR. Revalidate the worker default if host RAM or the
 * page count changes materially.
 */
function productionBuildEnv(env = process.env, extra = {}) {
  const workers = String(env.HYDI_BUILD_CPUS || '').trim();
  return {
    ...env,
    NODE_ENV: 'production',
    HYDI_BUILD_CPUS: /^\d+$/.test(workers) && Number(workers) > 0 ? workers : '1',
    ...extra,
  };
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
    env: productionBuildEnv(env, { HYDI_NEXT_DIST_DIR: STAGING_DIR }),
  });
  const missing = BUILD_MARKERS.filter((f) => !fsx.exists(path.join(staging, f)));
  if (missing.length) throw new Error(`build incomplete: ${missing.join(', ')} missing`);
}

/**
 * Copy fallback for when Windows refuses to rename LIVE_DIR even with the web
 * app stopped. On Frank (2026-11-01) the rename failed with Access denied
 * while no process held a handle on it, but replacing the files inside the
 * directory worked. LIVE_DIR is backed up to `keep` first; if the copy
 * fails partway, LIVE_DIR is put back from that backup before rethrowing.
 */
function copySwap({ live, source, keep, fsx }) {
  fsx.rm(keep);
  const hadLive = fsx.exists(live);
  if (hadLive) fsx.copy(live, keep);
  try {
    if (hadLive) fsx.emptyDir(live); else fsx.mkdir(live);
    fsx.copy(source, live);
  } catch (error) {
    if (hadLive) {
      try { fsx.emptyDir(live); fsx.copy(keep, live); } catch { /* reported below */ }
    }
    throw error;
  }
  const missing = BUILD_MARKERS.filter((f) => !fsx.exists(path.join(live, f)));
  if (missing.length) {
    if (hadLive) { fsx.emptyDir(live); fsx.copy(keep, live); }
    throw new Error(`copy swap incomplete: ${missing.join(', ')} missing`);
  }
  fsx.rm(source);
}

/**
 * Rename `from` over LIVE_DIR, keeping what was live at `keepAs`. Windows
 * can refuse to rename a directory the running server holds open; then stop
 * the web app and retry. If the rename is still refused, copy the files
 * into place instead (copySwap). Either way the caller starts the web app
 * again when `stoppedWeb` is true.
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
    return { stoppedWeb: false, method: 'rename' };
  } catch {
    await run(executable('pm2', platform), ['stop', WEB_APP], { cwd: root, timeout: 60 * 1000 });
    try {
      attempt();
      return { stoppedWeb: true, method: 'rename' };
    } catch {
      copySwap({ live, source, keep, fsx });
      return { stoppedWeb: true, method: 'copy' };
    }
  }
}

function nodeModulesDirs(root) {
  return {
    live: path.join(root, 'node_modules'),
    prev: path.join(root, NM_PREV_DIR),
    failed: path.join(root, NM_FAILED_DIR),
  };
}

/**
 * Move the current node_modules aside before `npm ci` rebuilds it.
 * Returns true when a previous tree was preserved. Any older preserved copy
 * is dropped first (bounded cleanup — it was already superseded).
 */
function preserveNodeModules({ root, fsx = realFs }) {
  const d = nodeModulesDirs(root);
  fsx.rm(d.prev);
  fsx.rm(d.failed);
  if (!fsx.exists(d.live)) return false;
  try {
    fsx.rename(d.live, d.prev);
  } catch (e) {
    // Windows refuses to rename a directory while any process has a file
    // inside it loaded — running executables (esbuild.exe under hydi-daemon's
    // tsx) and native modules (sharp, sqlite3) all count. Fail with an
    // actionable reason instead of a raw EPERM; the live tree is untouched.
    throw new Error(
      `blocked: dependency tree in use — a process holds files under node_modules ` +
      `(e.g. daemon esbuild or a native module). Stop the holder or defer this deploy. (${e.message})`
    );
  }
  return true;
}

/**
 * Restore the preserved tree after a failed ci/build/activation. Install-free:
 * renames only. No-op (returns false) when nothing was preserved, so the
 * current tree — whatever state it is in — is left untouched rather than
 * replaced by nothing.
 */
function restoreNodeModules({ root, fsx = realFs }) {
  const d = nodeModulesDirs(root);
  if (!fsx.exists(d.prev)) return false;
  try { fsx.rm(d.failed); } catch { /* locked leftover — suffixed below */ }
  // If the failed-tree slot is still occupied (locked files), move the
  // partial ci output aside under a unique name rather than failing the
  // restore — getting the good tree back is what matters.
  let failedTarget = d.failed;
  if (fsx.exists(failedTarget) && fsx.exists(d.live)) {
    failedTarget = `${d.failed}-${Date.now()}`;
  }
  if (fsx.exists(d.live)) fsx.rename(d.live, failedTarget);
  fsx.rename(d.prev, d.live);
  try {
    fsx.rm(failedTarget); // failed ci output is disposable — don't keep a second tree on disk
  } catch {
    // A locked file inside the failed tree must not fail the rollback — the
    // restore already succeeded. The leftover is evidence; the next
    // preserveNodeModules drops it.
  }
  return true;
}

/** After a deploy verifies healthy, drop both preserved copies (bounded). */
function dropNodeModulesBackup({ root, fsx = realFs }) {
  const d = nodeModulesDirs(root);
  fsx.rm(d.prev);
  fsx.rm(d.failed);
}

/** Record what actually went live: commit + lockfile identity. */
function writeDeployManifest({ root, commit, fsx = realFs }) {
  try {
    if (typeof fsx.writeFile !== 'function') return; // test doubles: skip
    const lockfile = path.join(root, 'package-lock.json');
    const lockfileSha256 = fsx.exists(lockfile) && typeof fsx.readFile === 'function'
      ? crypto.createHash('sha256').update(fsx.readFile(lockfile)).digest('hex')
      : null;
    fsx.writeFile(path.join(root, 'deploy-manifest.json'), JSON.stringify({
      commit, lockfileSha256, deployedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* manifest is evidence, never a deploy blocker */ }
}

// ---------------------------------------------------------------------------
// Dependency identity. A deploy must never build or restart against a
// dependency tree that does not belong to the candidate commit. Automatic
// installs are disabled, so the deploy can only proceed when (a) no
// dependency manifest changes between the live and candidate commits and
// (b) every installed tree on disk matches the candidate's lockfile.
// ---------------------------------------------------------------------------

const LOCKFILE_NAMES = Object.freeze(['package-lock.json', 'npm-shrinkwrap.json']);
// package.json fields that change what `npm ci` would install. Edits to
// scripts, metadata, etc. do not need a dependency install.
const DEPENDENCY_FIELDS = Object.freeze([
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies',
  'overrides', 'workspaces', 'packageManager',
]);

function baseName(p) {
  const parts = String(p).split('/');
  return parts[parts.length - 1];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Dependency-relevant fields of a package.json text; null when unparseable. */
function dependencyFields(text) {
  if (text === null) return {};
  try {
    const pkg = JSON.parse(text);
    const out = {};
    for (const field of DEPENDENCY_FIELDS) if (pkg[field] !== undefined) out[field] = pkg[field];
    return out;
  } catch {
    return null;
  }
}

async function showFile(run, root, commit, rel) {
  const result = await run('git', ['show', `${commit}:${rel}`], { cwd: root });
  return result && result.code === 0 ? String(result.stdout) : null;
}

/**
 * Every dependency manifest that changed between two commits in a way that
 * would need an install: any lockfile/shrinkwrap change anywhere in the repo
 * (root and sub-projects like heidi-core), and any package.json whose
 * dependency fields changed (or that could not be parsed — fail closed).
 * Returns repo-relative paths.
 */
async function dependencyManifestChanges({ run, root, from, to }) {
  const diff = await mustRun(run, 'git', ['diff', '--name-only', from, to], { cwd: root });
  const files = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const changed = [];
  for (const rel of files) {
    const name = baseName(rel);
    if (LOCKFILE_NAMES.includes(name)) {
      changed.push(rel);
    } else if (name === 'package.json') {
      const before = dependencyFields(await showFile(run, root, from, rel));
      const after = dependencyFields(await showFile(run, root, to, rel));
      if (before === null || after === null || stableJson(before) !== stableJson(after)) changed.push(rel);
    }
  }
  return changed;
}

function platformMatches(entry, platform, arch) {
  const allowed = (list, value) => {
    if (!Array.isArray(list) || !list.length) return true;
    const denied = list.filter((v) => String(v).startsWith('!')).map((v) => String(v).slice(1));
    if (denied.includes(value)) return false;
    const wanted = list.filter((v) => !String(v).startsWith('!'));
    return !wanted.length || wanted.includes(value);
  };
  return allowed(entry.os, platform) && allowed(entry.cpu, arch);
}

/**
 * Compare npm's record of the installed tree (node_modules/.package-lock.json)
 * with a candidate lockfile, entry by entry. The two files are never
 * byte-identical: the installed record omits the root "" entry and every
 * optional package that was not installed (e.g. other platforms' esbuild and
 * sharp binaries), so a hash comparison would block every deploy.
 */
function compareInstalledTree(candidateText, installedText, { platform = process.platform, arch = process.arch } = {}) {
  let candidate;
  let installed;
  try { candidate = JSON.parse(candidateText); } catch { return { ok: false, reason: 'candidate lockfile is not valid JSON' }; }
  try { installed = JSON.parse(installedText); } catch { return { ok: false, reason: 'installed-tree record is not valid JSON' }; }
  const cp = candidate && candidate.packages;
  const ip = installed && installed.packages;
  if (!cp || typeof cp !== 'object') return { ok: false, reason: 'candidate lockfile has no "packages" map (lockfileVersion < 2)' };
  if (!ip || typeof ip !== 'object') return { ok: false, reason: 'installed-tree record has no "packages" map' };

  const mismatched = [];
  const extraneous = [];
  const missing = [];
  for (const [key, have] of Object.entries(ip)) {
    if (!key) continue;
    const want = cp[key];
    if (!want) { extraneous.push(key); continue; }
    const versionDiffers = (want.version || null) !== (have.version || null);
    const integrityDiffers = Boolean(want.integrity && have.integrity && want.integrity !== have.integrity);
    const linkDiffers = Boolean(want.link) !== Boolean(have.link);
    if (versionDiffers || integrityDiffers || linkDiffers) {
      mismatched.push(`${key.replace(/^node_modules\//, '')} ${have.version || '?'}≠${want.version || '?'}`);
    }
  }
  for (const [key, want] of Object.entries(cp)) {
    if (!key || ip[key]) continue;
    // Optional packages, and packages restricted to another OS/CPU, are
    // legitimately absent. Everything else npm ci would have installed.
    if (want.optional || !platformMatches(want, platform, arch)) continue;
    missing.push(key.replace(/^node_modules\//, ''));
  }
  const problems = [];
  if (mismatched.length) problems.push(`${mismatched.length} version/integrity mismatch(es), e.g. ${mismatched.slice(0, 3).join(', ')}`);
  if (missing.length) problems.push(`${missing.length} missing, e.g. ${missing.slice(0, 3).join(', ')}`);
  if (extraneous.length) problems.push(`${extraneous.length} not in lockfile, e.g. ${extraneous.slice(0, 3).map((k) => k.replace(/^node_modules\//, '')).join(', ')}`);
  return { ok: problems.length === 0, reason: problems.join('; '), mismatched, missing, extraneous };
}

/**
 * Verify every installed dependency tree on disk against the candidate
 * commit's lockfiles. The root tree must exist and match. A sub-project
 * (heidi-core, mcp/protoforge-mcp, ...) with a node_modules must match; one
 * with no node_modules is not installed on this host and is reported as
 * skipped. A tree without npm's installed-tree record is unverifiable and
 * blocks (fail closed).
 */
async function verifyInstalledDependencies({ run, root, commit, fsx = realFs, platform, arch }) {
  const tree = await mustRun(run, 'git', ['ls-tree', '-r', '--name-only', commit], { cwd: root });
  const lockfiles = tree.stdout.split(/\r?\n/).map((line) => line.trim())
    .filter((rel) => rel && LOCKFILE_NAMES.includes(baseName(rel)));
  const problems = [];
  const verified = [];
  const skipped = [];
  if (!lockfiles.includes('package-lock.json') && !lockfiles.includes('npm-shrinkwrap.json')) {
    problems.push('candidate has no root lockfile');
  }
  for (const rel of lockfiles) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const isRoot = dir === '';
    const nodeModules = path.join(root, dir, 'node_modules');
    if (!fsx.exists(nodeModules)) {
      if (isRoot) problems.push(`${rel}: node_modules is missing`);
      else skipped.push(rel);
      continue;
    }
    const record = path.join(nodeModules, '.package-lock.json');
    let installedText = null;
    try {
      if (fsx.exists(record) && typeof fsx.readFile === 'function') installedText = String(fsx.readFile(record));
    } catch { installedText = null; }
    if (installedText === null) {
      problems.push(`${rel}: no readable node_modules/.package-lock.json — installed tree provenance unverifiable`);
      continue;
    }
    const candidateText = await showFile(run, root, commit, rel);
    if (candidateText === null) {
      problems.push(`${rel}: could not read the candidate lockfile`);
      continue;
    }
    const cmp = compareInstalledTree(candidateText, installedText, { platform, arch });
    if (cmp.ok) verified.push(rel);
    else problems.push(`${rel}: ${cmp.reason}`);
  }
  return {
    ok: problems.length === 0,
    reason: problems.slice(0, 3).join(' | ') + (problems.length > 3 ? ` | +${problems.length - 3} more` : ''),
    problems,
    verified,
    skipped,
  };
}

/** Full 40-hex commit id, or null. */
function isFullSha(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ''));
}

async function rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped = false, fsx = realFs }) {
  await mustRun(run, 'git', ['reset', '--hard', oldCommit], { cwd: root });
  // Restore the preserved dependency tree by rename — rollback must never
  // install. If npm ci never ran (no backup), this is a no-op.
  restoreNodeModules({ root, fsx });
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
    await mustRun(run, executable('npm', platform), ['run', 'build'], {
      cwd: root,
      timeout: 20 * 60 * 1000,
      env: productionBuildEnv(),
    });
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
  const log = overrides.log || ((message) => console.error(message));
  const lockPath = overrides.lockPath || path.join(root, '.runtime', 'frank-auto-deploy.lock');
  const rebuildMarkerPath = overrides.rebuildMarkerPath || path.join(root, '.runtime', 'frank-auto-deploy-rebuild.json');
  const readStamp = overrides.readBuildStamp || readBuildStamp;
  const lock = (overrides.acquireLock || acquireLock)(lockPath);
  if (!lock) return { status: 'lock_held' };

  const started = now();
  let oldCommit = null;
  let newCommit = null;
  let updated = false;
  let lockChanged = false;
  let swapped = false;
  let prTitles = [];
  // rebuild: clean-main has not moved, but the live .next was built from an
  // older commit (e.g. someone pulled by hand). liveCommit is that commit.
  let rebuild = false;
  let liveCommit = null;
  let skippedChecks = [];
  const fsx = overrides.fsx || realFs;

  // A rejected board post must never be silent: one stderr line with the
  // board's own error text (never the token) so the PM2 err log shows why
  // #alerts stayed quiet.
  const postToBoard = async (channel, body) => {
    const sent = await post(channel, body);
    if (!postSucceeded(sent)) {
      log(`[${APP_NAME}] board post to #${channel} failed: ${board.postFailureReason(sent)}`);
    }
    return sent;
  };

  // Alert once per distinct blocked/failed reason. The last reason persists
  // in .runtime so the long-lived loop does not spam #alerts every interval.
  const alertStatePath = overrides.alertStatePath || path.join(root, '.runtime', 'frank-auto-deploy-alert.json');
  const alert = async (reason, text) => {
    if (readAlertState(alertStatePath) === reason) return;
    const sent = await postToBoard('alerts', text);
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
      // The candidate is resolved to one exact commit, once. Everything after
      // this — the dependency checks, the fast-forward, the manifest — uses
      // that id, never the moving origin/clean-main ref.
      if (overrides.commit) {
        const pinned = String(overrides.commit).trim();
        const resolved = /^[0-9a-f]{7,40}$/i.test(pinned)
          ? await run('git', ['rev-parse', '--verify', `${pinned}^{commit}`], { cwd: root })
          : null;
        const sha = resolved && resolved.code === 0 ? String(resolved.stdout).trim() : '';
        if (!isFullSha(sha)) {
          result = { status: 'blocked', reason: `pinned commit ${pinned} not found` };
        } else {
          const onMain = await run('git', ['merge-base', '--is-ancestor', sha, 'origin/clean-main'], { cwd: root });
          if (!onMain || onMain.code !== 0) result = { status: 'blocked', reason: `pinned commit ${sha.slice(0, 8)} is not on origin/clean-main` };
          else newCommit = sha;
        }
      } else {
        newCommit = (await mustRun(run, 'git', ['rev-parse', 'origin/clean-main'], { cwd: root })).stdout.trim();
      }
      if (result) {
        await alert(result.reason, `Frank auto-deploy stopped: ${result.reason}. Nothing changed.`);
      } else if (!isFullSha(oldCommit) || !isFullSha(newCommit)) {
        result = { status: 'failed', reason: `could not resolve commits (HEAD=${oldCommit || '?'}, candidate=${newCommit || '?'})` };
      } else if (oldCommit === newCommit) {
        const stamp = readStamp(root);
        const stampSha = stamp && stamp.gitSha;
        if (stampSha && stampSha !== newCommit && readRebuildMarker(rebuildMarkerPath) !== newCommit) {
          rebuild = true;
          liveCommit = stampSha;
        } else {
          result = { status: 'noop' };
        }
      } else {
        clearRebuildMarker(rebuildMarkerPath);
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
      // What must be healthy afterwards is decided by what is healthy now.
      const baseline = await waitForHealth({ ...healthOptions, timeoutMs: 0 });
      healthOptions.checks = requiredChecks(baseline);
      skippedChecks = HEALTH_CHECKS.map((c) => c.name).filter((n) => !healthOptions.checks.some((c) => c.name === n));

      if (!rebuild) {
        const log = await mustRun(run, 'git', ['log', '--format=%B%x1e', `${oldCommit}..${newCommit}`], { cwd: root });
        prTitles = parseMergedPrTitles(log.stdout);
        const manifestChanges = await dependencyManifestChanges({ run, root, from: oldCommit, to: newCommit });
        lockChanged = manifestChanges.length > 0;

        if (lockChanged) {
          // FAIL CLOSED: a lockfile change means dependencies must change, and
          // automatic `npm ci` in the live root is disabled — running consumers
          // can hold files under node_modules (daemon esbuild, sharp, sqlite3)
          // and a rename does not prove they tolerate it. A successful rename
          // is not consumer safety. Manual maintenance / staged-release
          // migration is required; nothing is touched.
          const listed = manifestChanges.slice(0, 5).join(', ') + (manifestChanges.length > 5 ? `, +${manifestChanges.length - 5} more` : '');
          const reason = `dependency manifests changed ${oldCommit.slice(0, 8)}→${newCommit.slice(0, 8)} (${listed}) — ` +
            'automatic dependency install is disabled; manual maintenance window required';
          await alert('lockfile_change', `Frank auto-deploy paused: ${reason}. Nothing changed.`);
          result = { status: 'blocked', reason, manifestChanges };
        }
      }
      if (!result) {
        // The manifests did not change, but that says nothing about what is
        // actually on disk: a hand-run install, a half-finished npm ci, or a
        // checkout that already sits at the candidate can all leave
        // node_modules belonging to some other lockfile. Check the trees
        // themselves against the candidate before anything moves.
        const deps = await (overrides.verifyInstalledDependencies || verifyInstalledDependencies)({ run, root, commit: newCommit, fsx });
        if (!deps.ok) {
          const reason = `installed dependencies do not match ${newCommit.slice(0, 8)}: ${deps.reason}`;
          await alert('dependency_mismatch', `Frank auto-deploy paused: ${reason}. Nothing changed. A manual dependency maintenance window is required.`);
          result = { status: 'blocked', reason, dependencyProblems: deps.problems };
        }
      }
      if (!result && !rebuild) {
        // From here a failure must reset the checkout, so mark it before the
        // merge rather than after.
        updated = true;
        await mustRun(run, 'git', ['merge', '--ff-only', newCommit], { cwd: root });
        const head = (await mustRun(run, 'git', ['rev-parse', '--verify', 'HEAD'], { cwd: root })).stdout.trim();
        if (head !== newCommit) {
          throw new Error(`checkout is at ${head.slice(0, 8) || 'unknown'} after fast-forward, expected exactly ${newCommit.slice(0, 8)}`);
        }
      }
      if (!result) {
        updated = true;
        await stagedBuild({ run, root, platform, fsx, env: overrides.env || process.env });
      await restoreGenerated(run, root);
      const swap = await swapLive({ run, root, platform, from: STAGING_DIR, keepAs: PREV_DIR, fsx });
      swapped = true;
      await restartApps(run, root, platform, swap.stoppedWeb ? [WEB_APP] : []);

      const health = await waitForHealth(healthOptions);
      const from = rebuild ? liveCommit : oldCommit;
      const what = rebuild ? 'Frank rebuilt a stale build' : 'Frank deployed';
      const notRequired = skippedChecks.length ? [`Not required (already down before the deploy): ${skippedChecks.join(', ')}`] : [];
      if (!health.ok) {
        const failing = health.results.filter((check) => !check.ok).map((check) => check.name).join(', ');
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped, fsx });
        if (rebuild) writeRebuildMarker(rebuildMarkerPath, newCommit);
        await alert(
          `rollback:${newCommit}`,
          `Frank auto-deploy rolled back ${newCommit.slice(0, 8)} to ${from.slice(0, 8)}; failing check: ${failing}. Rollback health: ${healthText(rollbackHealth)}.`,
        );
        await postToBoard('ops', [
          `${what} — rolled back: ${from.slice(0, 8)}→${newCommit.slice(0, 8)}→${from.slice(0, 8)}`,
          `Merged PRs: ${prTitles.join('; ') || 'none detected'}`,
          `Failed health: ${healthText(health)}`,
          ...notRequired,
          `Rollback health: ${healthText(rollbackHealth)}`,
          `Duration: ${Math.round((now() - started) / 1000)}s`,
        ].join('\n'));
        result = { status: 'rolled_back', oldCommit: from, newCommit, health, rollbackHealth, rebuild };
      } else {
        if (rebuild) clearRebuildMarker(rebuildMarkerPath);
        dropNodeModulesBackup({ root, fsx });
        // newCommit is the verified HEAD: asserted right after the
        // fast-forward, and equal to HEAD by construction on a rebuild.
        writeDeployManifest({ root, commit: newCommit, fsx });
        await postToBoard('ops', [
          `${what}: ${from.slice(0, 8)}→${newCommit.slice(0, 8)}`,
          `Merged PRs: ${prTitles.join('; ') || 'none detected'}`,
          `Health: ${healthText(health)}`,
          ...notRequired,
          `Duration: ${Math.round((now() - started) / 1000)}s`,
        ].join('\n'));
        result = { status: 'deployed', oldCommit: from, newCommit, health, rebuild };
      }
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown deployment failure';
    if (updated && oldCommit) {
      try {
        const rollbackHealth = await rollback({ run, root, platform, oldCommit, lockChanged, healthOptions, swapped, fsx });
        if (rebuild) writeRebuildMarker(rebuildMarkerPath, newCommit);
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
    const sent = await postToBoard('alerts', 'Frank auto-deploy unblocked — deploys resumed.');
    if (postSucceeded(sent)) clearAlertState(alertStatePath);
  }
  return result;
}

/** One log line for a deploy that changed something. */
function describeOutcome(result) {
  const range = result.oldCommit && result.newCommit
    ? ` ${String(result.oldCommit).slice(0, 8)}→${String(result.newCommit).slice(0, 8)}` : '';
  if (result.status === 'deployed') {
    return `deployed${range}; health: ${healthText(result.health)}`;
  }
  const why = result.reason
    ? `deployment error: ${String(result.reason).split(/\r?\n/).slice(0, 3).join(' | ').slice(0, 600)}`
    : `failed health: ${healthText(result.health)}`;
  return `rolled_back${range}; ${why}; rollback health: ${healthText(result.rollbackHealth)}`;
}

function startDeployLoop({
  deploy = runAutoDeploy,
  intervalMs = INTERVAL_MS,
  setIntervalFn = setInterval,
  log = (message) => console.error(message),
} = {}) {
  let inFlight = false;
  // 'blocked' is a steady state, not an event: log each distinct reason
  // once, so a day-long block leaves one readable line instead of a flood.
  const loggedBlockedReasons = new Set();
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await deploy();
      if (result.status === 'failed' || result.status === 'rollback_failed') {
        log(`[${APP_NAME}] ${result.status}: ${result.reason || ''}`);
      } else if (result.status === 'rolled_back' || result.status === 'deployed') {
        // These outcomes used to reach only the board. On 2026-11-02 a
        // rollback left nothing in the PM2 logs and the board read on Frank
        // could not show it, so the cause was lost. Log every one.
        loggedBlockedReasons.clear();
        log(`[${APP_NAME}] ${describeOutcome(result)}`);
      } else if (result.status === 'blocked') {
        const reason = result.reason || 'unknown';
        if (!loggedBlockedReasons.has(reason)) {
          loggedBlockedReasons.add(reason);
          log(`[${APP_NAME}] blocked: ${reason}`);
        }
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

/**
 * CLI: no arguments runs the long-lived loop (PM2). `--once` runs one deploy
 * pass and exits, which lets a separate clone at an exact commit drive the
 * production tree: `node scripts/frank-auto-deploy.js --once --root <prod>
 * [--commit <sha>]`. --root and --commit are only accepted with --once so a
 * second long-lived loop can never be pointed at production by accident.
 */
function parseCliArgs(argv) {
  const out = { once: false, root: null, commit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') out.once = true;
    else if (arg === '--root' || arg === '--commit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      out[arg.slice(2)] = value;
      i += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if ((out.root || out.commit) && !out.once) throw new Error('--root and --commit require --once');
  return out;
}

/**
 * The checkout whose board environment to load: the --root value when one is
 * given, else this script's own repo. Never throws — argument errors are
 * reported by parseCliArgs right after, once the environment is loaded.
 */
function cliRoot(argv) {
  const i = argv.indexOf('--root');
  const value = i >= 0 ? argv[i + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : path.resolve(__dirname, '..');
}

/** Exit code for a --once pass: 0 deployed/noop, 2 blocked/lock held, 1 anything else. */
function onceExitCode(result) {
  const status = result && result.status;
  if (status === 'deployed' || status === 'noop') return 0;
  if (status === 'blocked' || status === 'lock_held') return 2;
  return 1;
}

async function runOnce({ root, commit, deploy = runAutoDeploy, out = (line) => console.log(line) } = {}) {
  const result = await deploy({ root, ...(commit ? { commit } : {}) });
  out(JSON.stringify({
    status: result.status,
    reason: result.reason || null,
    oldCommit: result.oldCommit || null,
    newCommit: result.newCommit || null,
    summary: result.status === 'deployed' || result.status === 'rolled_back' ? describeOutcome(result) : undefined,
  }));
  return onceExitCode(result);
}

if (require.main === module) {
  require('../lib/runtime/board-env').loadBoardEnv(cliRoot(process.argv.slice(2)));
  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[${APP_NAME}] ${error instanceof Error ? error.message : error}`);
    process.exit(64);
  }
  const root = cli.root ? path.resolve(cli.root) : path.resolve(__dirname, '..');
  if (cli.root && !fs.existsSync(path.join(root, '.git'))) {
    console.error(`[${APP_NAME}] --root ${root} is not a git checkout`);
    process.exit(64);
  }
  if (cli.once) {
    runOnce({ root, commit: cli.commit }).then((code) => { process.exitCode = code; }, (error) => {
      console.error(`[${APP_NAME}] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
  } else {
    require('../lib/runtime/provenance').recordProcessProvenance(APP_NAME).then(() => startDeployLoop());
  }
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
  readRebuildMarker,
  requiredChecks,
  postSucceeded,
  parseMergedPrTitles,
  waitForHealth,
  memoryPreflight,
  stagedBuild,
  productionBuildEnv,
  swapLive,
  copySwap,
  preserveNodeModules,
  restoreNodeModules,
  dropNodeModulesBackup,
  writeDeployManifest,
  dependencyManifestChanges,
  compareInstalledTree,
  verifyInstalledDependencies,
  parseCliArgs,
  cliRoot,
  onceExitCode,
  runOnce,
  NM_PREV_DIR,
  NM_FAILED_DIR,
  rollback,
  LIVE_DIR,
  STAGING_DIR,
  PREV_DIR,
  WEB_APP,
  runAutoDeploy,
  startDeployLoop,
  describeOutcome,
};
