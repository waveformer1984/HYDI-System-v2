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

function execFileText(execImpl, cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    try {
      const child = execImpl(cmd, args, {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) return finish(null);
        const text = asText(stdout);
        finish(text === null ? null : text);
      });
      if (child && typeof child.on === 'function') child.on('error', () => finish(null));
    } catch (_) {
      finish(null);
    }
  });
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
 * @param {{ root?: string, execFile?: Function, timeoutMs?: number, gitTimeoutMs?: number, requireImpl?: Function, fs?: object }} [opts]
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
  const jlist = await execFileText(
    (cmd, args, opts, cb) => execImpl(cmd, args, { ...opts, shell: process.platform === 'win32' }, cb),
    'pm2', ['jlist'], root, Math.max(timeoutMs, 20000));
  if (jlist == null) return auditDrift({ pm2Readable: false, declared });
  let parsed;
  try {
    parsed = JSON.parse(jlist);
  } catch (_) {
    return auditDrift({ pm2Readable: false, declared });
  }
  const running = normalizePm2List(parsed);
  if (!running) return auditDrift({ pm2Readable: false, declared });
  const provenance = readAllProvenance(root, opts.fs);
  const repoHead = await execFileText(execImpl, 'git', ['rev-parse', 'HEAD'], root, gitTimeoutMs);
  return auditDrift({
    pm2Readable: true,
    declared,
    running,
    provenance,
    repoHead: repoHead || null,
  });
}

module.exports = {
  collectRuntimeAudit,
  loadDeclaredApps,
  normalizePm2List,
};
