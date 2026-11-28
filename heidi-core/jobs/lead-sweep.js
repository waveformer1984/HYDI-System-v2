'use strict';

/**
 * Daily lead sweep (Phase 2b scoring v2). Disabled unless HEIDI_LEADS_ENABLED=true.
 * Rules for CKAN permits; LLM only for sa-bid + rule-unscored rows.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeCkanRecord, scorePermitLead, rollupBuilders } = require('./lead-scoring-rules');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LLM_TIMEOUT_MS = 90_000;

function llmMax() {
  const raw = process.env.HEIDI_LEADS_LLM_MAX;
  if (raw === undefined || String(raw).trim() === '') return 20;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 20;
  return n;
}

function minFreeMb() {
  const n = parseInt(process.env.HEIDI_LEADS_MIN_FREE_MB || '1500', 10);
  return Number.isFinite(n) && n > 0 ? n : 1500;
}

const CKAN_SOURCE_IDS = new Set([
  'sanantonio-permits-ckan',
  'bexar-permits-ckan',
  'comal-permits-ckan',
]);

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

function loadFixtureRecords(source, repoRoot) {
  const rel = source.fixture || 'tests/fixtures/heidi-leads/sample-listing.json';
  const fp = path.join(repoRoot, rel);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function resolvePreferredModel() {
  return (
    process.env.HEIDI_MODEL_FLOOR ||
    process.env.LOCAL_MODEL_NAME ||
    process.env.OLLAMA_MODEL ||
    null
  );
}

function freeMemMb() {
  return os.freemem() / (1024 * 1024);
}

function canRunLlm() {
  return freeMemMb() >= minFreeMb();
}

function parseScoreFromText(text) {
  const m = String(text).match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function parseStrictJsonScore(text) {
  try {
    const trimmed = String(text).trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(trimmed.slice(start, end + 1));
    if (typeof obj.score !== 'number' || !Number.isFinite(obj.score)) return null;
    const score = Math.min(1, Math.max(0, obj.score));
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.map((r) => String(r)).filter(Boolean)
      : [];
    return { score, score_reasons: reasons };
  } catch {
    return null;
  }
}

async function scoreLeadWithLlm(lead, deps) {
  const fetchFn = deps.fetch;
  if (typeof fetchFn !== 'function') return null;

  const model = deps.model || resolvePreferredModel();
  if (!model) return null;

  const prompt = [
    'You score construction make-ready / final-clean opportunities for San Antonio new-home builders.',
    'Respond with JSON only: {"score":0.0-1.0,"reasons":["short reason"]}',
    `Title: ${lead.title}`,
    `Snippet: ${lead.snippet || ''}`,
    `Location: ${lead.location || ''}`,
    `Source: ${lead.source}`,
  ].join('\n');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetchFn(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const parsed = parseStrictJsonScore(body.response || '');
    if (!parsed) {
      const fallback = parseScoreFromText(body.response || '');
      if (fallback == null) return null;
      return { score: fallback, score_reasons: ['llm_numeric_fallback'], scored_by: 'llm' };
    }
    return { ...parsed, scored_by: 'llm' };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function applyRulesScore(lead) {
  if (lead.source === 'sa-bid') {
    return { score: null, score_reasons: [], scored_by: null, contractor: lead.contractor || null };
  }
  if (CKAN_SOURCE_IDS.has(lead.source) || lead.permit_type != null) {
    const ruled = scorePermitLead(lead);
    return {
      score: ruled.score,
      score_reasons: ruled.score_reasons,
      scored_by: ruled.scored_by,
      contractor: ruled.contractor || lead.contractor || null,
    };
  }
  const ruled = scorePermitLead(lead);
  return {
    score: ruled.score,
    score_reasons: ruled.score_reasons,
    scored_by: ruled.scored_by,
    contractor: ruled.contractor || lead.contractor || null,
  };
}

async function scoreLeads(leads, deps) {
  const llmBudget = llmMax();
  let llmUsed = 0;
  const memOk = canRunLlm();

  for (const lead of leads) {
    const ruled = applyRulesScore(lead);
    lead.contractor = ruled.contractor || lead.contractor || null;
    lead.score_reasons = ruled.score_reasons || [];
    lead.scored_by = ruled.scored_by;
    lead.score = ruled.score;

    const needsLlm =
      lead.source === 'sa-bid' || lead.score == null || lead.scored_by == null;

    if (!needsLlm) continue;
    if (!memOk) {
      lead.score_reasons = [...(lead.score_reasons || []), 'llm_skipped_low_memory'];
      continue;
    }
    if (llmUsed >= llmBudget) {
      lead.score_reasons = [...(lead.score_reasons || []), 'llm_cap_reached'];
      continue;
    }

    const llm = await scoreLeadWithLlm(lead, deps);
    llmUsed += 1;
    if (!llm) {
      lead.score = null;
      lead.scored_by = null;
      lead.score_reasons = [...(lead.score_reasons || []), 'llm_failed'];
      continue;
    }
    lead.score = llm.score;
    lead.scored_by = llm.scored_by;
    lead.score_reasons = [...new Set([...(lead.score_reasons || []), ...(llm.score_reasons || [])])];
  }

  return leads;
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

function listingToLead(item, sourceId) {
  return {
    source: sourceId,
    title: item.title,
    url: item.url,
    location: item.location || null,
    posted_at: item.posted_at || null,
    snippet: item.snippet || '',
    title_hash: titleHash(item.title),
    contractor: item.contractor || item.builder || null,
    permit_type: item.permit_type || null,
  };
}

async function collectFromSources(config, repoRoot, deps) {
  const leads = [];
  for (const source of config.sources || []) {
    if (!source.enabled) continue;
    const records = loadFixtureRecords(source, repoRoot);

    if (source.type === 'ckan_permit' || CKAN_SOURCE_IDS.has(source.id)) {
      for (const record of records) {
        const norm = normalizeCkanRecord(record, source.id);
        leads.push({
          ...norm,
          title_hash: titleHash(norm.title),
        });
      }
      continue;
    }

    if (source.type === 'fixture' || source.type === 'bid') {
      for (const item of records) {
        leads.push(listingToLead(item, source.id));
      }
    }
  }

  return scoreLeads(leads, deps);
}

async function writeDigest(store, leads, repoRoot, log = console) {
  const scored = leads.filter((l) => l.score != null);
  const top = [...scored].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  const builders = rollupBuilders(leads).slice(0, 10);
  const day = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(repoRoot, 'logs', `heidi-lead-digest-${day}.md`);
  const md = [
    `# Lead digest ${day}`,
    '',
    '## Top scored leads',
    '',
    ...(top.length
      ? top.map(
          (l, i) =>
            `${i + 1}. (${l.score}) ${l.title} — ${l.url}${l.contractor ? ` · ${l.contractor}` : ''}`,
        )
      : ['_(no scored leads)_']),
    '',
    '## Top builders (by permit/listing count)',
    '',
    ...(builders.length
      ? builders.map(
          (b, i) =>
            `${i + 1}. ${b.name} — ${b.count} permit(s)${
              b.avg_score != null ? `, avg score ${b.avg_score}` : ''
            }`,
        )
      : ['_(no contractor names in feed)_']),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, `${md}\n`, 'utf8');

  if (store && store.isAvailable && store.isAvailable()) {
    try {
      await store.from('heidi_events').insert({
        event_type: 'lead_digest',
        division: 'commercial',
        payload: {
          day,
          top10: top.map(({ source, title, url, score, location, contractor, scored_by }) => ({
            source,
            title,
            url,
            score,
            location,
            contractor,
            scored_by,
          })),
          top_builders: builders,
        },
      });
    } catch (e) {
      log.warn(`[lead-sweep] digest event failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { mdPath, top, builders };
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
      score_reasons: lead.score_reasons || [],
      scored_by: lead.scored_by,
      contractor: lead.contractor,
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
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const curH = Number(parts.hour);
  const curM = Number(parts.minute);
  let deltaMin = hour * 60 + minute - (curH * 60 + curM);
  if (deltaMin <= 0) deltaMin += 24 * 60;
  return deltaMin * 60 * 1000;
}

function startLeadSweepScheduler({ store, repoRoot, log = console } = {}) {
  if (!enabled()) return () => {};
  const cfg = loadConfig(repoRoot || path.resolve(__dirname, '..', '..'));
  const [hh, mm] = String(cfg.run_at || '06:30')
    .split(':')
    .map((x) => Number(x));
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
  parseStrictJsonScore,
  collectFromSources,
  scoreLeads,
  applyRulesScore,
  canRunLlm,
  runLeadSweep,
  startLeadSweepScheduler,
  loadConfig,
  CKAN_SOURCE_IDS,
  llmMax,
  minFreeMb,
};