'use strict';

/**
 * Project state for HYDI, Heidi and ProtoForge, with provenance.
 *
 * Every value is recorded with where it came from and when it was observed,
 * and is labelled by how it is known:
 *   repo_verified  - read from git in the live checkout
 *   live_verified  - read from a running service's own status (Frank's
 *                    observation snapshot, the daemon status file, Heidi's
 *                    own diagnostics)
 *   documentation  - read from a repo document
 *   user_reported  - the user said so (long-term memories)
 * Anything older than its freshness window is shown as STALE, and a project
 * with no source at all is reported as UNKNOWN. Nothing is ever assumed.
 *
 * Refresh is explicit (or on read when older than REFRESH_AFTER_MS); there is
 * no background polling.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECTS = Object.freeze(['hydi', 'heidi', 'protoforge']);
const FRESH_MS = Object.freeze({ live_verified: 10 * 60 * 1000, repo_verified: 24 * 3600 * 1000, documentation: 30 * 24 * 3600 * 1000, user_reported: 90 * 24 * 3600 * 1000 });
const REFRESH_AFTER_MS = 5 * 60 * 1000;
const KIND_LABEL = Object.freeze({ live_verified: 'live', repo_verified: 'repo', documentation: 'docs', user_reported: 'you said' });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function defaultGit(root) {
  return (args) => execFileSync('git', args, { cwd: root, timeout: 3000, encoding: 'utf8', windowsHide: true }).trim();
}

/**
 * Re-reads every source for `project` that is available and records it.
 * Returns { recorded: number, errors: string[] }.
 */
async function refreshProject(store, project, opts = {}) {
  const p = String(project || '').toLowerCase();
  if (!PROJECTS.includes(p)) throw new Error(`unknown project ${project}`);
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const git = opts.git || defaultGit(root);
  const errors = [];
  let recorded = 0;
  const rec = (key, value, kind, source, observedAt) => {
    try { store.recordProjectState(p, key, value, { kind, source, observedAt }); recorded += 1; } catch (e) { errors.push(`${key}: ${e.message}`); }
  };

  if (p === 'hydi' || p === 'heidi') {
    try {
      const sha = git(['rev-parse', 'HEAD']);
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const committed = git(['log', '-1', '--format=%cI']);
      const dirty = git(['status', '--porcelain', '--untracked-files=no']);
      rec('commit', `${sha.slice(0, 12)} on ${branch}${dirty ? ' (uncommitted changes)' : ''}`, 'repo_verified', `git in ${root}`, committed || null);
    } catch (e) {
      errors.push(`git: ${e.message.split('\n')[0]}`);
    }
  }

  if (p === 'hydi') {
    const frank = readJson(path.join(root, '.runtime', 'observation', 'frank.json'));
    if (frank && frank.at) {
      const issues = Array.isArray(frank.issues) ? frank.issues.length : 0;
      rec('frank_health', `${frank.level}${issues ? ` (${issues} issue${issues === 1 ? '' : 's'})` : ''}`, 'live_verified', 'frank-observer .runtime/observation/frank.json', frank.at);
    } else {
      errors.push('frank observation snapshot missing');
    }
    const daemon = readJson(path.join(root, '.heidi-daemon-status.json'));
    if (daemon && daemon.updatedAt) {
      rec('daemon', `${daemon.state || 'unknown'}, last cycle ${daemon.lastCycleOutcome || 'unknown'}`, 'live_verified', 'hydi-daemon .heidi-daemon-status.json', daemon.updatedAt);
    } else {
      errors.push('daemon status file missing');
    }
  }

  if (p === 'heidi' && typeof opts.diagnostics === 'function') {
    try {
      const d = await opts.diagnostics();
      const now = new Date().toISOString();
      if (d && d.brain) rec('brain', d.brain.available ? `model ${d.brain.model} available` : 'model unavailable', 'live_verified', 'heidi-core diagnostics', now);
      if (d && d.agent_level !== undefined) rec('permission_level', String(d.agent_level), 'live_verified', 'heidi-core agent registry', now);
    } catch (e) {
      errors.push(`diagnostics: ${e.message}`);
    }
  }

  store.setMeta(`project_refresh_${p}`, new Date().toISOString());
  return { recorded, errors };
}

function ageText(ms) {
  if (!Number.isFinite(ms)) return 'unknown age';
  if (ms < 90 * 1000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 90 * 60 * 1000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 48 * 3600 * 1000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

/**
 * Text report for a project. `memories` are the owner's user-reported
 * memories mentioning it (from searchMemories).
 */
function describeProject(store, project, { now = Date.now(), memories = [] } = {}) {
  const p = String(project || '').toLowerCase();
  const rows = store.projectState(p);
  const lastRefresh = store.getMeta(`project_refresh_${p}`);
  const lines = [`📁 ${p.toUpperCase()} status (last refresh: ${lastRefresh ? ageText(now - Date.parse(lastRefresh)) : 'never'})`];
  if (!rows.length && !memories.length) {
    lines.push('UNKNOWN — no verified source is connected for this project yet. Tell me its status and I will record it as user-reported.');
    return lines.join('\n');
  }
  for (const r of rows) {
    const age = now - Date.parse(r.observed_at);
    const stale = !(age <= FRESH_MS[r.kind]);
    lines.push(`• ${r.skey}: ${r.value} — ${KIND_LABEL[r.kind] || r.kind}, ${ageText(age)}${stale ? ' ⚠️ STALE' : ''} (source: ${r.source})`);
  }
  for (const m of memories) {
    lines.push(`• (${KIND_LABEL.user_reported}, #${m.id}, ${String(m.updated_at).slice(0, 10)}) ${m.content}`);
  }
  return lines.join('\n');
}

function needsRefresh(store, project, now = Date.now()) {
  const last = store.getMeta(`project_refresh_${String(project).toLowerCase()}`);
  return !last || now - Date.parse(last) > REFRESH_AFTER_MS;
}

module.exports = { PROJECTS, FRESH_MS, refreshProject, describeProject, needsRefresh, ageText };
