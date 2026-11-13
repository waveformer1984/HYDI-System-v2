'use strict';
/**
 * Heidi job scout — one read-only scan across the enabled boards.
 *
 * Files (under .runtime/job-scout/, or JOB_SCOUT_DIR):
 *   leads.json      written only here: ranked leads, drafts, first/last seen
 *   decisions.json  written only by Ursula: shortlist / dismissed / applied
 *   status.json     written only here: last run, per-source outcome
 *
 * Keeping the two writers on separate files means a scan can never
 * overwrite a decision Jordan just made in Ursula.
 *
 * A failing source is recorded and skipped; the scan fails (exit 1 from the
 * CLI) only when every enabled source failed.
 */

const fs = require('fs');
const path = require('path');
const { ADAPTERS } = require('./sources');
const { compileProfile, scoreLead } = require('./score');
const { draftFor } = require('./draft');
const { maybeNotifyLeads } = require('./notify');

const ROOT = path.resolve(__dirname, '..', '..');
const ACTIVE_DECISIONS = new Set(['shortlisted', 'applied']);

function scoutDir(env = process.env) {
  return env.JOB_SCOUT_DIR ? path.resolve(env.JOB_SCOUT_DIR) : path.join(ROOT, '.runtime', 'job-scout');
}

function configPath(env = process.env) {
  return env.JOB_SCOUT_CONFIG ? path.resolve(env.JOB_SCOUT_CONFIG) : path.join(ROOT, 'config', 'job-scout.json');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function dedupeKey(lead) {
  return `${String(lead.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(lead.company || '').toLowerCase()}`;
}

/**
 * @param {object} opts
 * @param {Function} [opts.fetchImpl]  injected fetch (tests)
 * @param {number}   [opts.now]
 * @param {Function} [opts.sleep]      delay between sources
 * @param {object}   [opts.env]
 */
async function runScout(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now();
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = Number(env.JOB_SCOUT_HTTP_TIMEOUT_MS) || 15000;

  const config = opts.config || readJson(configPath(env), null);
  if (!config) throw new Error(`job scout config unreadable: ${configPath(env)}`);
  const profile = compileProfile(config);
  const divisionsByName = Object.fromEntries(
    Object.entries(config.divisions || {}).map(([name, d]) => [name, { name, pitch: d.pitch }]),
  );

  const dir = scoutDir(env);
  const leadsFile = path.join(dir, 'leads.json');
  const statusFile = path.join(dir, 'status.json');
  const existing = readJson(leadsFile, { leads: [] });
  const decisions = readJson(path.join(dir, 'decisions.json'), {});
  const byId = new Map((existing.leads || []).map((l) => [l.id, l]));

  const sourceResults = {};
  const fetched = [];
  const enabled = Object.entries(config.sources || {}).filter(([name, c]) => c && c.enabled && ADAPTERS[name]);
  for (const [name, cfg] of enabled) {
    const t0 = Date.now();
    try {
      const rows = await ADAPTERS[name](cfg, { fetchImpl, timeoutMs });
      fetched.push(...rows);
      sourceResults[name] = { ok: true, count: rows.length, ms: Date.now() - t0 };
    } catch (e) {
      sourceResults[name] = { ok: false, count: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 300) };
    }
    await sleep(250);
  }

  const nowIso = new Date(now).toISOString();
  const seenKeys = new Set();
  let newLeads = 0;
  let newStrong = 0;
  const minScore = Number(config.minScore) || 0;
  const draftScore = Number(config.draftScore) || 101;

  for (const raw of fetched) {
    if (!raw || !raw.id || !raw.title) continue;
    const key = dedupeKey(raw);
    if (seenKeys.has(key) && !byId.has(raw.id)) continue; // same post on two boards
    seenKeys.add(key);

    const s = scoreLead(raw, profile, now);
    const prev = byId.get(raw.id);
    const decided = decisions[raw.id] && ACTIVE_DECISIONS.has(decisions[raw.id].status);
    if (s.score < minScore && !prev && !decided) continue;

    const lead = {
      ...raw,
      score: s.score,
      division: s.division,
      matched: s.matched,
      reasons: s.reasons,
      firstSeenAt: prev ? prev.firstSeenAt : nowIso,
      lastSeenAt: nowIso,
      notifiedAt: prev ? prev.notifiedAt || null : null,
      notifyPending: prev ? Boolean(prev.notifyPending) : false,
      draft: prev && prev.draft ? prev.draft : null,
    };
    if (!lead.draft && lead.score >= draftScore) lead.needsDraft = true;
    if (!prev) {
      newLeads++;
      if (lead.score >= draftScore) newStrong++;
      const notifyScore = Number(config.notifyScore) || 75;
      if (lead.score >= notifyScore) lead.notifyPending = true;
    }
    byId.set(lead.id, lead);
  }

  // Drafts: template by default; local-model drafts only when the operator
  // opts in via JOB_SCOUT_LLM_DRAFTS=true (see lib/job-scout/draft.js).
  const draftTargets = [...byId.values()].filter((l) => l.needsDraft);
  await Promise.all(draftTargets.map(async (l) => {
    l.draft = await draftFor(l, divisionsByName[l.division], {
      env,
      fetchImpl,
      timeoutMs: Number(env.JOB_SCOUT_DRAFT_TIMEOUT_MS) || 20000,
    });
    delete l.needsDraft;
  }));

  // Retention: drop leads not seen for retentionDays unless shortlisted/applied.
  const retentionMs = (Number(config.retentionDays) || 30) * 86400000;
  let leads = [...byId.values()].filter((l) => {
    const d = decisions[l.id];
    if (d && ACTIVE_DECISIONS.has(d.status)) return true;
    return now - Date.parse(l.lastSeenAt || l.firstSeenAt || nowIso) <= retentionMs;
  });
  leads.sort((a, b) => b.score - a.score || String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  const maxLeads = Number(config.maxLeads) || 400;
  if (leads.length > maxLeads) {
    const keep = leads.filter((l) => decisions[l.id] && ACTIVE_DECISIONS.has(decisions[l.id].status));
    const rest = leads.filter((l) => !keep.includes(l)).slice(0, Math.max(0, maxLeads - keep.length));
    leads = [...keep, ...rest].sort((a, b) => b.score - a.score);
  }

  const okSources = Object.values(sourceResults).filter((r) => r.ok).length;
  const summary = {
    ranAt: nowIso,
    ok: enabled.length === 0 || okSources > 0,
    sources: sourceResults,
    fetched: fetched.length,
    kept: leads.length,
    newLeads,
    newStrong,
  };

  // Only replace leads.json when at least one source answered — a total
  // outage must not wipe or age out what Jordan already has.
  if (summary.ok) {
    // Strong-lead phone alerts. Runs before the write so notifiedAt lands
    // in leads.json; a notify failure is recorded, never fails the scan.
    if (typeof opts.notifyFn === 'function') {
      try {
        summary.notify = await maybeNotifyLeads({ leads, config, notifyFn: opts.notifyFn, now });
      } catch (e) {
        summary.notify = { error: String((e && e.message) || e).slice(0, 200) };
      }
    }
    writeJsonAtomic(leadsFile, { updatedAt: nowIso, leads });
  }
  writeJsonAtomic(statusFile, summary);
  return summary;
}

module.exports = { runScout, scoutDir, configPath, dedupeKey, ACTIVE_DECISIONS };
