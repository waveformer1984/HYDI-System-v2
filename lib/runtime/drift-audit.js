'use strict';

/**
 * Pure drift audit. All inputs are injected. This module does not spawn
 * processes, restart anything, or read the clock beyond what callers pass.
 *
 * OK only when the running SHA matches repo HEAD, the tree is not dirty,
 * and the live PM2 settings match the declared file. UNKNOWN is never OK.
 */

const path = require('path');

const CONFIG_FIELDS = ['max_restarts', 'exp_backoff_restart_delay', 'kill_timeout', 'script', 'args', 'cwd'];
const DEGRADE_VERDICTS = new Set(['STALE_CODE', 'UNDECLARED', 'UNKNOWN_CODE']);

function normArgs(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ').trim();
  return String(value).trim();
}

function normScript(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function scriptsMatch(declared, running) {
  const d = normScript(declared);
  const r = normScript(running);
  if (!d || !r) return d === r;
  return r === d || r.endsWith(`/${d}`);
}

function cwdMatch(declared, running) {
  if (!declared || !running) return declared === running || (!declared && !running);
  try {
    return path.resolve(String(declared)) === path.resolve(String(running));
  } catch (_) {
    return String(declared) === String(running);
  }
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function configDiffs(declared, running) {
  /** @type {string[]} */
  const diffs = [];
  for (const field of ['max_restarts', 'exp_backoff_restart_delay', 'kill_timeout']) {
    if (num(declared[field]) !== num(running[field])) diffs.push(field);
  }
  if (!scriptsMatch(declared.script, running.script)) diffs.push('script');
  if (normArgs(declared.args) !== normArgs(running.args)) diffs.push('args');
  if (!cwdMatch(declared.cwd, running.cwd)) diffs.push('cwd');
  return diffs;
}

function suggestionFor(name, verdict) {
  switch (verdict) {
    case 'STALE_CODE':
      return `git pull && npm ci && npm run build && pm2 delete ${name} && pm2 start ecosystem.config.js --only ${name} && pm2 save`;
    case 'CONFIG_DRIFT':
      return `pm2 delete ${name} && pm2 start ecosystem.config.js --only ${name} && pm2 save`;
    case 'MISSING':
      return `pm2 start ecosystem.config.js --only ${name} && pm2 save`;
    case 'UNDECLARED':
      return `pm2 delete ${name} && pm2 save  # not in ecosystem.config.js — do not restart until an owner declares it`;
    case 'UNKNOWN_CODE':
      return `pm2 restart ${name}  # after this build is what PM2 loaded; then re-run npm run runtime:audit`;
    default:
      return null;
  }
}

function emptyCounts() {
  return { OK: 0, STALE_CODE: 0, UNDECLARED: 0, MISSING: 0, UNKNOWN_CODE: 0, CONFIG_DRIFT: 0, UNKNOWN: 0 };
}

function isOnline(proc) {
  const status = proc && proc.status ? String(proc.status) : 'online';
  return status === 'online' || status === 'launching';
}

function overallFrom(rows) {
  const kinds = new Set();
  for (const r of rows) {
    const list = Array.isArray(r.verdicts) && r.verdicts.length ? r.verdicts : [r.verdict];
    for (const verdict of list) {
      if (verdict && verdict !== 'OK') kinds.add(verdict);
    }
  }
  if (kinds.size === 0) return 'OK';
  const onlyUnknown = [...kinds].every((kind) => kind === 'UNKNOWN_CODE');
  return onlyUnknown ? 'UNKNOWN' : 'DRIFT';
}

/**
 * @param {{ pm2Readable?: boolean, declared?: object[], running?: object[], provenance?: Record<string, object|null>, repoHead?: string|null }} input
 */
function auditDrift(input) {
  const src = input || {};
  if (src.pm2Readable !== true) {
    const counts = emptyCounts();
    counts.UNKNOWN = 1;
    const audit = {
      overall: 'UNKNOWN',
      ok: false,
      counts,
      rows: [],
      repoHead: null,
      suggestion: 'pm2 jlist was unreadable. The audit is UNKNOWN, not OK. No process was restarted.',
    };
    audit.degradesHealth = degradesApiHealth(audit);
    return audit;
  }

  const declared = Array.isArray(src.declared) ? src.declared : [];
  const running = Array.isArray(src.running) ? src.running : [];
  const provenance = src.provenance && typeof src.provenance === 'object' ? src.provenance : {};
  const repoHead = typeof src.repoHead === 'string' && src.repoHead.trim() ? src.repoHead.trim() : null;
  const declaredByName = new Map(declared.filter((d) => d && d.name).map((d) => [d.name, d]));
  const runningByName = new Map();
  for (const proc of running) {
    // PM2 modules (pm2-logrotate etc.) are installed via `pm2 install`,
    // not ecosystem.config.js — they can never be "declared" there, so
    // they are out of scope for the app drift audit.
    if (proc && proc.name && isOnline(proc) && proc.isModule !== true) runningByName.set(proc.name, proc);
  }

  /** @type {object[]} */
  const rows = [];

  for (const [name, proc] of runningByName) {
    const decl = declaredByName.get(name);
    if (!decl) {
      rows.push(row(name, ['UNDECLARED'], { detail: 'running under PM2 but absent from ecosystem.config.js' }));
      continue;
    }
    const verdicts = [];
    const prov = provenance[name];
    if (!prov || prov.gitSha == null || !repoHead) {
      verdicts.push('UNKNOWN_CODE');
    } else if (prov.gitSha !== repoHead || prov.gitDirty === true) {
      verdicts.push('STALE_CODE');
    }
    const diffs = configDiffs(decl, proc);
    if (diffs.length) verdicts.push('CONFIG_DRIFT');
    if (!verdicts.length) verdicts.push('OK');
    rows.push(row(name, verdicts, {
      gitSha: prov ? prov.gitSha : null,
      repoHead,
      gitDirty: prov ? prov.gitDirty : null,
      configDiffs: diffs,
    }));
  }

  for (const decl of declared) {
    if (!decl || !decl.name) continue;
    if (!runningByName.has(decl.name)) {
      rows.push(row(decl.name, ['MISSING'], { detail: 'declared in ecosystem.config.js but not online' }));
    }
  }

  const counts = emptyCounts();
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const overall = overallFrom(rows);
  const audit = {
    overall,
    ok: overall === 'OK',
    counts,
    rows,
    repoHead,
    suggestion: overall === 'OK'
      ? null
      : 'Report only. Run the suggestion on a row yourself; this audit does not restart processes.',
  };
  audit.degradesHealth = degradesApiHealth(audit);
  return audit;
}

/**
 * Shape embedded by /api/heidi-health. Anything other than OK is unhealthy.
 * UNKNOWN is never OK.
 */
function runtimeHealthCheck(audit) {
  const overall = audit && typeof audit.overall === 'string' ? audit.overall : 'UNKNOWN';
  return {
    healthy: overall === 'OK',
    state: overall,
    details: {
      counts: audit && audit.counts ? audit.counts : emptyCounts(),
      rows: audit && Array.isArray(audit.rows) ? audit.rows : [],
      repoHead: audit && audit.repoHead ? audit.repoHead : null,
      degradesHealth: degradesApiHealth(audit),
      suggestion: audit && audit.suggestion ? audit.suggestion : null,
    },
  };
}

function row(name, verdicts, extra) {
  const primary = verdicts.find((v) => v !== 'OK') || 'OK';
  return {
    name,
    verdict: primary,
    verdicts,
    suggestion: primary === 'OK' ? null : suggestionFor(name, primary),
    ...extra,
  };
}

function degradesApiHealth(audit) {
  if (!audit) return true;
  if (audit.overall === 'UNKNOWN') return true;
  return (audit.rows || []).some((r) => DEGRADE_VERDICTS.has(r.verdict) || (r.verdicts || []).some((v) => DEGRADE_VERDICTS.has(v)));
}

module.exports = {
  CONFIG_FIELDS,
  DEGRADE_VERDICTS,
  auditDrift,
  degradesApiHealth,
  runtimeHealthCheck,
  configDiffs,
  suggestionFor,
  overallFrom,
};
