'use strict';
/**
 * Job scout source adapters. Each adapter reads ONE public, documented
 * endpoint and normalizes results into a Lead:
 *
 *   { id, source, sourceUrl, title, description, company, budget, skills,
 *     postedAt, kind }
 *
 * Only sources that publish an open API or feed are here. Upwork is
 * deliberately absent: it retired its RSS feeds (Aug 2024), its API needs an
 * approved app key, and its pages refuse automated readers.
 *
 * Adapters take an injected fetch so tests run on fixtures with no network.
 * They never post, bid, apply or log in.
 */

const UA = 'HYDI-JobScout/1.0 (+private use; read-only)';

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    // &amp; last, so "&amp;lt;" decodes to the literal "&lt;" — not "<".
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function toIso(v) {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function getJson(fetchImpl, url, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Freelancer.com — public project search API (active projects only).
function freelancerUrl(query, limit = 30) {
  const p = new URLSearchParams({
    query,
    limit: String(limit),
    full_description: 'true',
    job_details: 'true',
    compact: 'true',
    sort_field: 'time_updated',
  });
  return `https://www.freelancer.com/api/projects/0.1/projects/active/?${p}`;
}

function parseFreelancer(body) {
  const projects = (body && body.result && Array.isArray(body.result.projects)) ? body.result.projects : [];
  return projects.map((p) => {
    const cur = (p.currency && p.currency.code) || 'USD';
    const b = p.budget || {};
    return {
      id: `freelancer:${p.id}`,
      source: 'freelancer',
      sourceUrl: p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`,
      title: clip(p.title, 200),
      description: clip(stripHtml(p.description || p.preview_description), 4000),
      company: null,
      budget: {
        min: Number.isFinite(b.minimum) ? b.minimum : null,
        max: Number.isFinite(b.maximum) ? b.maximum : null,
        currency: cur,
        type: p.type === 'hourly' ? 'hourly' : 'fixed',
      },
      skills: Array.isArray(p.jobs) ? p.jobs.map((j) => j && j.name).filter(Boolean) : [],
      postedAt: toIso(p.time_submitted),
      kind: 'project',
      bids: p.bid_stats && Number.isFinite(p.bid_stats.bid_count) ? p.bid_stats.bid_count : null,
    };
  });
}

async function fetchFreelancer(cfg, { fetchImpl, timeoutMs }) {
  const out = [];
  for (const q of cfg.queries || []) {
    out.push(...parseFreelancer(await getJson(fetchImpl, freelancerUrl(q), timeoutMs)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Remotive — public API. Terms: jobs are delayed 24h, link back to Remotive,
// don't republish to other job boards. Private use with links back is fine.
function remotiveUrl(search, limit = 50) {
  return `https://remotive.com/api/remote-jobs?${new URLSearchParams({ search, limit: String(limit) })}`;
}

function parseRemotive(body, jobTypes) {
  const jobs = body && Array.isArray(body.jobs) ? body.jobs : [];
  const allowed = new Set((jobTypes || []).map((t) => String(t).toLowerCase()));
  return jobs
    .filter((j) => !allowed.size || allowed.has(String(j.job_type || '').toLowerCase()))
    .map((j) => ({
      id: `remotive:${j.id}`,
      source: 'remotive',
      sourceUrl: j.url,
      title: clip(j.title, 200),
      description: clip(stripHtml(j.description), 4000),
      company: j.company_name || null,
      budget: { min: null, max: null, currency: 'USD', type: 'unknown', text: j.salary || null },
      skills: Array.isArray(j.tags) ? j.tags : [],
      postedAt: toIso(j.publication_date),
      kind: String(j.job_type || 'job'),
    }));
}

async function fetchRemotive(cfg, { fetchImpl, timeoutMs }) {
  const out = [];
  for (const q of cfg.queries || []) {
    out.push(...parseRemotive(await getJson(fetchImpl, remotiveUrl(q), timeoutMs), cfg.jobTypes));
  }
  return out;
}

// ---------------------------------------------------------------------------
// RemoteOK — public JSON feed. First element is a legal notice; terms ask
// for attribution and a link back, which sourceUrl provides.
function parseRemoteOk(body, requireTags) {
  const rows = Array.isArray(body) ? body.filter((r) => r && r.id && r.position) : [];
  const need = (requireTags || []).map((t) => String(t).toLowerCase());
  return rows
    .filter((r) => {
      if (!need.length) return true;
      const hay = `${(r.tags || []).join(' ')} ${r.position} ${r.description || ''}`.toLowerCase();
      return need.some((t) => hay.includes(t));
    })
    .map((r) => ({
      id: `remoteok:${r.id}`,
      source: 'remoteok',
      sourceUrl: r.url || `https://remoteok.com/remote-jobs/${r.slug || r.id}`,
      title: clip(r.position, 200),
      description: clip(stripHtml(r.description), 4000),
      company: r.company || null,
      budget: {
        min: Number(r.salary_min) || null,
        max: Number(r.salary_max) || null,
        currency: 'USD',
        type: 'annual',
      },
      skills: Array.isArray(r.tags) ? r.tags : [],
      postedAt: toIso(r.epoch || r.date),
      kind: 'job',
    }));
}

async function fetchRemoteOk(cfg, { fetchImpl, timeoutMs }) {
  return parseRemoteOk(await getJson(fetchImpl, 'https://remoteok.com/api', timeoutMs), cfg.requireTags);
}

// ---------------------------------------------------------------------------
// Hacker News "Ask HN: Freelancer? Seeking freelancer?" — public Algolia API.
// Only top-level comments that lead with SEEKING FREELANCER (i.e. someone
// hiring) are leads; SEEKING WORK posts are other freelancers.
const HN_THREAD_URL = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=freelancer&hitsPerPage=5';

function pickHnThread(body) {
  const hits = body && Array.isArray(body.hits) ? body.hits : [];
  const t = hits.find((h) => /seeking freelancer/i.test(h.title || ''));
  return t ? String(t.objectID) : null;
}

function parseHnComments(body, storyId) {
  const hits = body && Array.isArray(body.hits) ? body.hits : [];
  return hits
    .filter((h) => String(h.parent_id) === String(storyId))
    .map((h) => ({ h, text: stripHtml(h.comment_text) }))
    .filter(({ text }) => /^\s*seeking\s+freelancers?\b/i.test(text))
    .map(({ h, text }) => {
      const firstLine = text.split('\n')[0];
      return {
        id: `hn:${h.objectID}`,
        source: 'hn',
        sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: clip(firstLine, 200),
        description: clip(text, 4000),
        company: null,
        budget: { min: null, max: null, currency: 'USD', type: 'unknown' },
        skills: [],
        postedAt: toIso(h.created_at),
        kind: 'project',
      };
    });
}

async function fetchHn(_cfg, { fetchImpl, timeoutMs }) {
  const storyId = pickHnThread(await getJson(fetchImpl, HN_THREAD_URL, timeoutMs));
  if (!storyId) return [];
  const url = `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=500`;
  return parseHnComments(await getJson(fetchImpl, url, timeoutMs), storyId);
}

const ADAPTERS = {
  freelancer: fetchFreelancer,
  remotive: fetchRemotive,
  remoteok: fetchRemoteOk,
  hn: fetchHn,
};

module.exports = {
  ADAPTERS,
  UA,
  stripHtml,
  freelancerUrl,
  parseFreelancer,
  remotiveUrl,
  parseRemotive,
  parseRemoteOk,
  pickHnThread,
  parseHnComments,
  HN_THREAD_URL,
};
