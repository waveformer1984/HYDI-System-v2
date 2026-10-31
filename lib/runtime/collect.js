'use strict';

/**
 * Adapters around the pure drift audit. PM2 and git are read here and only
 * here. A failure to read PM2 is UNKNOWN — never a green audit.
 * This module never restarts, kills, or starts a process.
 */

const path = require('path');
const { execFile } = require('child_process');
const { auditDrift } = require('./drift-audit');
const { readAllProvenance } = require('./provenance');

function asText(stdout) {
  if (typeof stdout === 'string') return stdout.trim();
  if (stdout && typeof stdout.toString === 'function') return stdout.toString('utf8').trim();
  return null;
}

/**
 * Kill a process and everything it started. On Windows a `shell: true`
 * launch is `cmd.exe /c pm2 jlist`: Node's own `timeout` kills only cmd.exe,
 * and the real `pm2 jlist` (node.exe) keeps running against the PM2 daemon.
 * Left behind every pass, those readers piled up on Frank and made each new
 * read slower (28s, then 59s, on 2026-10-30).
 */
function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch (_) { /* already gone */ }
  }
}

function execFileText(execImpl, cmd, args, cwd, timeoutMs, onFail, { treeKill = false, killImpl = killTree } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (text, reason) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (text == null && typeof onFail === 'function') onFail(reason || 'error');
      resolve(text);
    };
    try {
      const child = execImpl(cmd, args, {
        cwd,
        // With treeKill this function owns the deadline, so the whole tree
        // is killed while the parent is still alive to enumerate.
        timeout: treeKill ? 0 : timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) {
          const timedOut = err.killed === true || err.signal === 'SIGTERM' || /timed? ?out/i.test(String(err.message || ''));
          const reason = timedOut ? 'timeout'
            : err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'maxbuffer'
              : 'error';
          return finish(null, reason);
        }
        const text = asText(stdout);
        finish(text === null ? null : text, 'empty');
      });
      if (child && typeof child.on === 'function') child.on('error', () => finish(null, 'spawn'));
      if (treeKill && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          killImpl(child && child.pid);
          finish(null, 'timeout');
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }
    } catch (_) {
      finish(null, 'spawn');
    }
  });
}

// ─── Shared `pm2 jlist` read ────────────────────────────────────────────
// On Frank, `pm2 jlist` took ~28s under memory pressure (2026-10-30), past
// the old 20s bound, so every caller (CLI, /api/health, /api/heidi-health,
// the fix-list pass every 60s, the human-action verifiers) reported UNKNOWN
// and each started its own slow read. One read now runs at a time per
// process, its result is reused for a short while, and a caller waits at
// most `waitMs` for it while the read itself may take up to
// HYDI_PM2_JLIST_TIMEOUT_MS. A stale-but-recent result is served while a
// refresh runs; its age is reported (`pm2ReadAgeMs`). Nothing is invented:
// with no result young enough, the audit is UNKNOWN with the reason.
function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const JLIST_TIMEOUT_MS = () => envMs('HYDI_PM2_JLIST_TIMEOUT_MS', 120000);
const JLIST_FRESH_MS = () => envMs('HYDI_PM2_JLIST_CACHE_MS', 60000);
const JLIST_MAX_STALE_MS = () => envMs('HYDI_PM2_JLIST_MAX_STALE_MS', 10 * 60000);
const DEFAULT_WAIT_MS = 20000;

const jlistState = { text: null, at: 0, inflight: null, lastFailure: null };

function resetPm2ReadCache() {
  jlistState.text = null;
  jlistState.at = 0;
  jlistState.inflight = null;
  jlistState.lastFailure = null;
}

function startJlistRead(execImpl, root, now, killImpl) {
  if (jlistState.inflight) return jlistState.inflight;
  const timeoutMs = JLIST_TIMEOUT_MS();
  let reason = null;
  jlistState.inflight = execFileText(execImpl, 'pm2', ['jlist'], root, timeoutMs, (r) => { reason = r; },
    { treeKill: true, killImpl })
    .then((text) => {
      if (text != null) {
        jlistState.text = text;
        jlistState.at = now();
        jlistState.lastFailure = null;
      } else {
        jlistState.lastFailure = reason === 'timeout'
          ? `pm2 jlist did not answer within ${Math.round(timeoutMs / 1000)}s`
          : `pm2 jlist failed (${reason || 'error'})`;
      }
      return text;
    })
    .finally(() => { jlistState.inflight = null; });
  return jlistState.inflight;
}

/** Returns { text, ageMs } or { text: null, why }. */
async function readJlistShared(execImpl, root, waitMs, now, killImpl) {
  const age = jlistState.text != null ? now() - jlistState.at : Infinity;
  if (age <= JLIST_FRESH_MS()) return { text: jlistState.text, ageMs: age };
  const read = startJlistRead(execImpl, root, now, killImpl);
  if (age <= JLIST_MAX_STALE_MS()) return { text: jlistState.text, ageMs: age };
  let timer;
  const waited = await Promise.race([
    read.then((text) => ({ done: true, text })),
    new Promise((resolve) => { timer = setTimeout(() => resolve({ done: false }), waitMs); }),
  ]);
  clearTimeout(timer);
  if (waited.done && waited.text != null) return { text: waited.text, ageMs: 0 };
  if (!waited.done) {
    return { text: null, why: `pm2 jlist still answering after ${Math.round(waitMs / 1000)}s (read continues in the background; the next audit uses it)` };
  }
  return { text: null, why: jlistState.lastFailure || 'pm2 jlist failed' };
}

function pm2ExecFor(execImpl) {
  return (cmd, args, o, cb) => execImpl(cmd, args, { ...o, shell: process.platform === 'win32' }, cb);
}

/**
 * The shared PM2 process list, parsed. One read serves every caller in this
 * process (frank-observer's collector, strays check and fix-list, or a
 * server's health routes). Returns { list, ageMs } or { list: null, why }.
 * The list includes pm2_env, which carries environment values: callers must
 * not write it anywhere as-is.
 * @param {{ root?: string, waitMs?: number, execFile?: Function, now?: Function, killImpl?: Function }} [opts]
 */
async function readPm2List(opts = {}) {
  const got = await readJlistShared(pm2ExecFor(opts.execFile || execFile), opts.root || process.cwd(),
    opts.waitMs || DEFAULT_WAIT_MS, opts.now || Date.now, opts.killImpl);
  if (got.text == null) return { list: null, why: got.why };
  try {
    const list = JSON.parse(got.text);
    return Array.isArray(list) ? { list, ageMs: got.ageMs } : { list: null, why: 'pm2 jlist output was not a list' };
  } catch (_) {
    return { list: null, why: 'pm2 jlist output was not JSON' };
  }
}

function unreadable(declared, why) {
  const audit = auditDrift({ pm2Readable: false, declared });
  if (why) audit.suggestion = `${why}. The audit is UNKNOWN, not OK. No process was restarted.`;
  return audit;
}

function loadDeclaredApps(root, requireImpl = require) {
  const eco = requireImpl(path.join(root, 'ecosystem.config.js'));
  const apps = eco && Array.isArray(eco.apps) ? eco.apps : [];
  return apps.filter((app) => app && app.name).map((app) => ({
    name: app.name,
    script: app.script,
    args: app.args,
    cwd: app.cwd,
    max_restarts: app.max_restarts,
    exp_backoff_restart_delay: app.exp_backoff_restart_delay,
    kill_timeout: app.kill_timeout,
    // external: declared process runs a binary outside this repo (e.g.
    // ngrok.exe). Repo-SHA provenance is meaningless for it — the audit
    // still checks presence and declared config, just not code version.
    external: app.external === true,
  }));
}

function normalizePm2List(list) {
  if (!Array.isArray(list)) return null;
  return list.map((proc) => {
    const env = (proc && proc.pm2_env) || {};
    return {
      name: (proc && proc.name) || env.name || null,
      status: env.status || (proc && proc.status) || null,
      script: env.pm_exec_path || env.script || (proc && proc.script) || '',
      args: env.args != null ? env.args : proc && proc.args,
      cwd: env.pm_cwd || env.cwd || (proc && proc.cwd) || '',
      max_restarts: env.max_restarts != null ? env.max_restarts : proc && proc.max_restarts,
      exp_backoff_restart_delay: env.exp_backoff_restart_delay != null
        ? env.exp_backoff_restart_delay
        : proc && proc.exp_backoff_restart_delay,
      kill_timeout: env.kill_timeout != null ? env.kill_timeout : proc && proc.kill_timeout,
      // PM2 modules (e.g. pm2-logrotate) are installed via `pm2 install`,
      // not ecosystem.config.js. They can never be declared there, so the
      // app-level audit must not report them UNDECLARED.
      isModule: env.pmx_module === true || env.rotateModule != null,
    };
  });
}

/**
 * @param {{ root?: string, execFile?: Function, timeoutMs?: number, gitTimeoutMs?: number, requireImpl?: Function, fs?: object, waitMs?: number, shared?: boolean, now?: Function }} [opts]
 *   `waitMs`: how long this caller waits for the shared PM2 read (default 20s).
 *   `shared`: use the shared cached read. Default: on with the real execFile,
 *   off when a test injects `execFile` (so injected calls stay isolated).
 */
async function collectRuntimeAudit(opts = {}) {
  const root = opts.root || process.cwd();
  const execImpl = opts.execFile || execFile;
  const timeoutMs = opts.timeoutMs || 5000;
  const gitTimeoutMs = opts.gitTimeoutMs || 3000;
  let declared;
  try {
    declared = loadDeclaredApps(root, opts.requireImpl || require);
  } catch (e) {
    const audit = auditDrift({ pm2Readable: false });
    audit.suggestion = `ecosystem.config.js could not be loaded (${e instanceof Error ? e.message : 'unknown'}). The audit is UNKNOWN, not OK. No process was restarted.`;
    return audit;
  }

  // On Windows `pm2` is a .cmd shim; Node >=22 refuses to spawn .cmd via
  // execFile without a shell (CVE-2024-27980). shell:true is safe here —
  // args are literal constants ('jlist'), never caller input. The PM2
  // daemon answers slowly under load on Windows (~7s observed); allow a
  // wider bound than the generic 5s before declaring PM2 unreadable.
  const pm2Exec = pm2ExecFor(execImpl);
  const shared = opts.shared != null ? opts.shared === true : !opts.execFile;
  let jlist;
  let ageMs = 0;
  if (shared) {
    const got = await readJlistShared(pm2Exec, root, opts.waitMs || DEFAULT_WAIT_MS, opts.now || Date.now, opts.killImpl);
    if (got.text == null) return unreadable(declared, got.why);
    jlist = got.text;
    ageMs = got.ageMs;
  } else {
    let reason = null;
    jlist = await execFileText(pm2Exec, 'pm2', ['jlist'], root, Math.max(timeoutMs, 20000), (r) => { reason = r; });
    if (jlist == null) return unreadable(declared, reason === 'timeout' ? 'pm2 jlist did not answer in time' : null);
  }
  let parsed;
  try {
    parsed = JSON.parse(jlist);
  } catch (_) {
    return unreadable(declared, 'pm2 jlist output was not JSON');
  }
  const running = normalizePm2List(parsed);
  if (!running) return unreadable(declared, null);
  const provenance = readAllProvenance(root, opts.fs);
  const repoHead = await execFileText(execImpl, 'git', ['rev-parse', 'HEAD'], root, gitTimeoutMs);
  const audit = auditDrift({
    pm2Readable: true,
    declared,
    running,
    provenance,
    repoHead: repoHead || null,
  });
  if (shared) audit.pm2ReadAgeMs = ageMs;
  return audit;
}

module.exports = {
  collectRuntimeAudit,
  readPm2List,
  resetPm2ReadCache,
  execFileText,
  loadDeclaredApps,
  normalizePm2List,
};
