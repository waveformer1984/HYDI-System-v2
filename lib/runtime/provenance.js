'use strict';

/**
 * Which code a long-running process is actually running.
 * Never invents a SHA: unknown stays null.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROVENANCE_DIR = path.join('.runtime', 'provenance');
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// Files a build rewrites in place; they never change what a process runs.
// Mirrors the restore list in scripts/frank-auto-deploy.js.
const BUILD_REGENERATED = new Set(['next-env.d.ts']);

function safeName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!NAME_RE.test(n)) throw new Error('invalid provenance process name');
  return n;
}

function asText(stdout) {
  if (typeof stdout === 'string') return stdout.trim();
  if (stdout && typeof stdout.toString === 'function') return stdout.toString('utf8').trim();
  return null;
}

function execFileText(exec, cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    let child;
    try {
      child = exec(cmd, args, {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) return finish(null);
        const text = asText(stdout);
        // Empty stdout is a real result (git status --porcelain on a clean tree).
        finish(text === null ? null : text);
      });
    } catch (_) {
      return finish(null);
    }
    if (child && typeof child.on === 'function') {
      child.on('error', () => finish(null));
    }
  });
}

/**
 * BUILD_SHA wins. Otherwise `git rev-parse HEAD`. Failure → null.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, execFile?: Function, timeoutMs?: number }} [opts]
 */
async function resolveGitIdentity(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const run = opts.execFile || execFile;
  // 15s, not 3s: provenance is recorded at process start, often while PM2
  // is restarting several services — git is local but slow under load.
  // Failure still yields null (fail closed), just fewer false UNKNOWNs.
  const timeoutMs = opts.timeoutMs || 15000;
  const fromEnv = typeof env.BUILD_SHA === 'string' ? env.BUILD_SHA.trim() : '';
  if (fromEnv) {
    const branch = typeof env.BUILD_BRANCH === 'string' && env.BUILD_BRANCH.trim() ? env.BUILD_BRANCH.trim() : null;
    return { gitSha: fromEnv, branch, gitDirty: false, source: 'BUILD_SHA' };
  }
  const sha = await execFileText(run, 'git', ['rev-parse', 'HEAD'], cwd, timeoutMs);
  if (!sha) return { gitSha: null, branch: null, gitDirty: null, source: 'git_failed' };
  const branch = await execFileText(run, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, timeoutMs);
  // --untracked-files=no: runtime debris (pcaps, reports, lockfiles, artifacts)
  // accumulates in the live tree permanently and cannot alter the code a
  // process executes. Dirty means tracked content differs from HEAD.
  const dirtyOut = await execFileText(run, 'git', ['status', '--porcelain', '--untracked-files=no'], cwd, timeoutMs);
  // Build-regenerated files (same set frank-auto-deploy restores after every
  // build) change under every deploy. Counting them latches gitDirty=true at
  // process start and the drift audit reports STALE_CODE forever even though
  // the running code IS HEAD — filter them the way the deploy itself does.
  const dirtyLines = dirtyOut === null ? null : dirtyOut.split(/\r?\n/)
    // porcelain "XY path"; the block's outer trim strips the first line's
    // leading unstaged-space column, so do not rely on a fixed offset.
    .map((line) => line.replace(/^\s*[A-Z?! ]{1,2}\s+/, '').trim())
    .filter((p) => p && !BUILD_REGENERATED.has(p));
  return {
    gitSha: sha,
    branch: branch || null,
    gitDirty: dirtyLines === null ? null : dirtyLines.length > 0,
    source: 'git',
  };
}

function readBuildStamp(cwd, fsImpl = fs) {
  try {
    const raw = fsImpl.readFileSync(path.join(cwd, '.next', 'hydi-build.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const gitSha = typeof parsed.gitSha === 'string' && parsed.gitSha.trim() ? parsed.gitSha.trim() : null;
    const branch = typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : null;
    let gitDirty = null;
    if (parsed.gitDirty === true) gitDirty = true;
    else if (parsed.gitDirty === false) gitDirty = false;
    return { gitSha, branch, gitDirty, stampedAt: parsed.stampedAt || null };
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ name: string, cwd?: string, env?: NodeJS.ProcessEnv, execFile?: Function, now?: () => number, pid?: number, fs?: object }} opts
 */
async function captureProvenance(opts) {
  const name = safeName(opts.name);
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const startedAt = new Date(now()).toISOString();
  const web = name === 'heidi-web' || name === 'heidi-web-standalone';
  let identity;
  if (web) {
    const stamp = readBuildStamp(cwd, opts.fs || fs);
    const fromEnv = typeof env.BUILD_SHA === 'string' ? env.BUILD_SHA.trim() : '';
    if (fromEnv) {
      identity = { gitSha: fromEnv, branch: env.BUILD_BRANCH || null, gitDirty: false, source: 'BUILD_SHA' };
    } else if (stamp) {
      identity = {
        gitSha: stamp.gitSha,
        branch: stamp.branch,
        gitDirty: stamp.gitDirty,
        source: 'build_stamp',
      };
    } else {
      identity = { gitSha: null, branch: null, gitDirty: null, source: 'build_stamp_missing' };
    }
  } else {
    identity = await resolveGitIdentity({ cwd, env, execFile: opts.execFile });
  }
  return {
    name,
    pid: opts.pid != null ? opts.pid : process.pid,
    gitSha: identity.gitSha,
    gitDirty: identity.gitDirty,
    branch: identity.branch,
    startedAt,
    node: process.version,
    cwd,
    source: identity.source,
  };
}

function provenancePath(root, name) {
  return path.join(root, PROVENANCE_DIR, `${safeName(name)}.json`);
}

/**
 * Atomic tmp+rename. Never throws. Returns an error string or null.
 */
function writeProvenance(root, record, fsImpl = fs) {
  let tmp = null;
  try {
    const name = safeName(record.name);
    const dir = path.join(root, PROVENANCE_DIR);
    fsImpl.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${name}.json`);
    tmp = `${target}.tmp-${process.pid}`;
    const body = JSON.stringify({ ...record, name });
    fsImpl.writeFileSync(tmp, body);
    fsImpl.renameSync(tmp, target);
    return null;
  } catch (e) {
    if (tmp) {
      try { fsImpl.unlinkSync(tmp); } catch (_) { /* torn tmp is best-effort */ }
    }
    return e instanceof Error ? e.message : 'provenance write failed';
  }
}

function readProvenance(root, name, fsImpl = fs) {
  try {
    const raw = fsImpl.readFileSync(provenancePath(root, name), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function readAllProvenance(root, fsImpl = fs) {
  const dir = path.join(root, PROVENANCE_DIR);
  /** @type {Record<string, object>} */
  const out = {};
  let names = [];
  try {
    names = fsImpl.readdirSync(dir);
  } catch (_) {
    return out;
  }
  for (const file of names) {
    if (!file.endsWith('.json')) continue;
    const name = file.slice(0, -5);
    const rec = readProvenance(root, name, fsImpl);
    if (rec) out[name] = rec;
  }
  return out;
}

/**
 * Capture and write. Never throws — a provenance failure must not kill the process.
 * @returns {Promise<object|null>}
 */
async function recordProcessProvenance(name, opts = {}) {
  try {
    const record = await captureProvenance({ name, ...opts });
    writeProvenance(opts.root || opts.cwd || process.cwd(), record, opts.fs);
    return record;
  } catch (_) {
    return null;
  }
}

module.exports = {
  PROVENANCE_DIR,
  captureProvenance,
  resolveGitIdentity,
  readBuildStamp,
  writeProvenance,
  readProvenance,
  readAllProvenance,
  recordProcessProvenance,
  provenancePath,
};
