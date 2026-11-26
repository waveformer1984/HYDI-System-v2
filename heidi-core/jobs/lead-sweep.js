'use strict';

/**
 * Daily lead sweep (Phase 2). Disabled unless HEIDI_LEADS_ENABLED=true.
 * No paid APIs; Ollama scoring optional; fixtures for tests.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'qwen2.5:3b-instruct-q4_K_M';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

function enabled() {
  return String(process.env.HEIDI_LEADS_ENABLED || '').toLowerCase() === 'true';
}

function titleHash(title) {
  return crypto.createHash('sha256').update(String(title).trim().toLowerCase()).digest('hex').slice(0, 32);
}

function loadConfig(repoRoot) {
  const p = path.join(repoRoot, 'config', 'heidi-leads.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadFixtureListings(source, repoRoot) {
  const rel = source.fixture || 'tests/fixtures/heidi-leads/sample-listing.json';
  const fp = path.join(repoRoot, rel);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function parseScoreFromText(text) {
  const m = String(text).match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

async function scoreLeadWithOllama(lead, deps) {
  const fetchFn = deps.fetch;
  if (typeof fetchFn !== 'function') return 0.5;
  const prompt = [
    'Score 0.0 to 1.0 how well this job fits San Antonio new-home construction make-ready / final clean work.',
    'Reply with only the number.',
    `Title: ${lead.title}`,
    `Snippet: ${lead.snippet || ''}`,
    `Location: ${lead.location || ''}`,
  ].join('\n');
  try {
    const res = await fetchFn(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: deps.model || DEFAULT_MODEL, prompt, stream: false }),
    });
    if (!res.ok) return 0;
    const body = await res.json();
    return parseScoreFromText(body.response || '');
  } catch {
    return 0;
  }
}

async function upsertLead(store, row) {
  if (!store || !store.isAvailable || !store.isAvailable()) {
    return { ok: false, reason: 'no-store' };
  }
  try {
    const { error } = await store.from('heidi_leads').upsert(row, {
      onConflict: 'source,url,title_hash',
      ignoreDuplicates: false,
    });
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function collectFromSources(config, repoRoot, deps) {
  const leads = [];
  for (const source of config.sources || []) {
    if (!source.enabled) continue;
    if (source.type === 'fixture') {
      for (const item of loadFixtureListings(source, repoRoot)) {
        leads.push({
          source: source.id,
          title: item.title,
          url: item.url,
          location: item.location || null,
          posted_at: item.posted_at || null,
          snippet: item.snippet || '',
          title_hash: titleHash(item.title),
        });
      }
    }
  }
  for (const lead of leads) {
    lead.score = await scoreLeadWithOllama(lead, deps);
  }
  return leads;
}

async function writeDigest(store, leads, repoRoot, log = console) {
  const top = [...leads].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  const day = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(repoRoot, 'logs', `heidi-lead-digest-${day}.md`);
  const md = [
    `# Lead digest ${day}`,
    '',
    ...top.map((l, i) => `${i + 1}. (${l.score}) ${l.title} — ${l.url}`),
  ].join('\n');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, `${md}\n`, 'utf8');

  if (store && store.isAvailable && store.isAvailable()) {
    try {
      await store.from('heidi_events').insert({
        event_type: 'lead_digest',
        division: 'commercial',
        payload: { day, top10: top.map(({ source, title, url, score, location }) => ({ source, title, url, score, location })) },
      });
    } catch (e) {
      log.warn(`[lead-sweep] digest event failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { mdPath, top };
}

async function runLeadSweep(deps = {}) {
  const repoRoot = deps.repoRoot || path.resolve(__dirname, '..', '..');
  const config = loadConfig(repoRoot);
  const store = deps.store;
  const log = deps.log || console;
  const raw = await collectFromSources(config, repoRoot, deps);
  for (const lead of raw) {
    const row = {
      source: lead.source,
      title: lead.title,
      url: lead.url,
      location: lead.location,
      posted_at: lead.posted_at,
      score: lead.score,
      title_hash: lead.title_hash,
      status: 'new',
    };
    const up = await upsertLead(store, row);
    if (!up.ok) log.warn(`[lead-sweep] upsert failed: ${up.reason}`);
  }
  return writeDigest(store, raw, repoRoot, log);
}

function msUntilChicago(hour, minute, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const curH = Number(parts.hour);
  const curM = Number(parts.minute);
  let deltaMin = (hour * 60 + minute) - (curH * 60 + curM);
  if (deltaMin <= 0) deltaMin += 24 * 60;
  return deltaMin * 60 * 1000;
}

function startLeadSweepScheduler({ store, repoRoot, log = console } = {}) {
  if (!enabled()) return () => {};
  const cfg = loadConfig(repoRoot || path.resolve(__dirname, '..', '..'));
  const [hh, mm] = String(cfg.run_at || '06:30').split(':').map((x) => Number(x));
  let timer = null;
  let stopped = false;
  const deps = { store, repoRoot, log };

  const schedule = () => {
    if (stopped) return;
    const wait = msUntilChicago(hh, mm || 0);
    timer = setTimeout(() => {
      void runLeadSweep(deps).catch((e) => log.warn(`[lead-sweep] ${e.message}`));
      schedule();
    }, wait);
    if (timer.unref) timer.unref();
  };
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = {
  enabled,
  titleHash,
  parseScoreFromText,
  collectFromSources,
  runLeadSweep,
  startLeadSweepScheduler,
  loadConfig,
};