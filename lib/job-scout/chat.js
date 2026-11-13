'use strict';
/**
 * `jobs` chat command for Heidi — deterministic, read-only, like `fix list`.
 * Shows the top open leads the scout found, skipping ones Jordan dismissed
 * or already applied to in Ursula.
 */

const fs = require('fs');
const path = require('path');
const { scoutDir } = require('./scout');

const PHRASES = new Set(['jobs', '/jobs', 'job leads', 'freelance jobs', 'job scout', 'any jobs', 'new jobs']);

function isJobsQuery(input) {
  const t = String(input || '').trim().toLowerCase().replace(/[?!.]+$/, '');
  return PHRASES.has(t);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function ago(iso, now) {
  const ms = now - Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '?';
  const h = Math.round(ms / 3600000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function formatJobs({ dir = scoutDir(), now = Date.now(), limit = 8 } = {}) {
  const status = readJson(path.join(dir, 'status.json'), null);
  const { leads = [] } = readJson(path.join(dir, 'leads.json'), {});
  const decisions = readJson(path.join(dir, 'decisions.json'), {});
  if (!status && !leads.length) {
    return 'jobs: no scan yet — heidi-job-scout runs under hydi-schedulers every 3h (or run `node scripts/job-scout.js --once`).';
  }
  const open = leads.filter((l) => !decisions[l.id] || decisions[l.id].status === 'shortlisted');
  const srcs = status ? Object.entries(status.sources || {}).map(([k, v]) => `${k}${v.ok ? '' : ' ✗'}`).join(', ') : '';
  const head = `jobs: ${open.length} open lead(s)${status ? ` — last scan ${ago(status.ranAt, now)} (${srcs}), ${status.newLeads} new` : ''}`;
  const lines = open.slice(0, limit).map((l) => {
    const star = decisions[l.id] && decisions[l.id].status === 'shortlisted' ? '★ ' : '';
    return `  ${star}${l.score} · ${l.division || '—'} · ${l.title} [${l.source}] ${l.sourceUrl}`;
  });
  return [head, ...lines, open.length ? 'Shortlist, dismiss or open drafts in Ursula → Freelance. Heidi never applies on your behalf.' : ''].filter(Boolean).join('\n');
}

module.exports = { isJobsQuery, formatJobs };
