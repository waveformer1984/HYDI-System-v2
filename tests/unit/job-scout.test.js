'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseFreelancer, parseRemotive, parseRemoteOk, pickHnThread, parseHnComments, freelancerUrl, stripHtml,
} = require('../../lib/job-scout/sources');
const { compileProfile, scoreLead, makeMatcher } = require('../../lib/job-scout/score');
const { runScout } = require('../../lib/job-scout/scout');
const { draftProposal } = require('../../lib/job-scout/draft');
const { JOBS } = require('../../scripts/hydi-schedulers');

const NOW = Date.parse('2026-11-13T06:00:00Z');
const DAY = 86400000;

const CONFIG = {
  minScore: 35,
  draftScore: 60,
  maxLeads: 50,
  retentionDays: 30,
  minFixedBudgetUsd: 150,
  minHourlyUsd: 20,
  negativeKeywords: ['unpaid', 'homework'],
  sources: {
    freelancer: { enabled: true, queries: ['react'] },
    remotive: { enabled: true, queries: ['react'], jobTypes: ['contract', 'freelance'] },
    remoteok: { enabled: true, requireTags: ['contract'] },
    hn: { enabled: true },
  },
  divisions: {
    AppForge: { pitch: 'full-stack web builds', keywords: ['react', 'next.js', 'stripe', 'supabase', 'api'] },
    'Build-A-Mind': { pitch: 'practical AI', keywords: ['ai', 'chatbot', 'llm'] },
  },
};

const FREELANCER = {
  status: 'success',
  result: {
    projects: [
      { id: 101, title: 'Build a Next.js dashboard with Stripe', seo_url: 'nextjs/dashboard-101', description: '<p>Need a <b>React</b> + Supabase app</p>', budget: { minimum: 500, maximum: 1500 }, currency: { code: 'USD' }, type: 'fixed', time_submitted: (NOW - DAY) / 1000, jobs: [{ name: 'React.js' }, { name: 'Stripe' }], bid_stats: { bid_count: 12 } },
      { id: 102, title: 'React homework help', seo_url: 'react/homework-102', description: 'my class assignment', budget: { minimum: 10, maximum: 30 }, currency: { code: 'USD' }, type: 'fixed', time_submitted: (NOW - DAY) / 1000, jobs: [] },
      { id: 103, title: 'Quick react fix', seo_url: 'react/fix-103', description: 'small bug', budget: { minimum: 10, maximum: 40 }, currency: { code: 'USD' }, type: 'fixed', time_submitted: (NOW - DAY) / 1000, jobs: [{ name: 'React.js' }] },
    ],
  },
};

const REMOTIVE = {
  jobs: [
    { id: 201, url: 'https://remotive.com/remote-jobs/software-dev/ai-chatbot-201', title: 'Contract AI chatbot engineer', company_name: 'Acme', job_type: 'contract', tags: ['llm', 'python'], publication_date: new Date(NOW - 2 * DAY).toISOString(), salary: '$80/hr', description: '<p>Build an LLM chatbot</p>' },
    { id: 202, url: 'https://remotive.com/remote-jobs/x-202', title: 'Senior React Engineer', company_name: 'BigCo', job_type: 'full_time', tags: ['react'], publication_date: new Date(NOW).toISOString(), description: 'full time' },
  ],
};

const REMOTEOK = [
  { legal: 'API Terms of Service' },
  { id: '301', slug: 'contract-react-301', url: 'https://remoteok.com/remote-jobs/contract-react-301', position: 'Contract React + API developer', company: 'Startup', tags: ['react', 'contract'], description: 'Short contract', epoch: (NOW - DAY) / 1000 },
  { id: '302', position: 'Full-time Go engineer', company: 'Other', tags: ['golang'], description: 'permanent role', epoch: (NOW - DAY) / 1000 },
];

const HN_STORIES = { hits: [{ objectID: '900', title: 'Ask HN: Freelancer? Seeking freelancer? (November 2026)' }] };
const HN_COMMENTS = {
  hits: [
    { objectID: '901', parent_id: 900, created_at: new Date(NOW - DAY).toISOString(), comment_text: 'SEEKING FREELANCER | Remote<p>Need a React + Stripe integration for our checkout' },
    { objectID: '902', parent_id: 900, created_at: new Date(NOW - DAY).toISOString(), comment_text: 'SEEKING WORK | React dev available' },
    { objectID: '903', parent_id: 901, created_at: new Date(NOW - DAY).toISOString(), comment_text: 'SEEKING FREELANCER reply nested' },
  ],
};

function fakeFetch(map, calls = []) {
  return async (url) => {
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const v = map[key];
    if (v instanceof Error) throw v;
    return { ok: true, status: 200, json: async () => v };
  };
}

const ALL = {
  'freelancer.com': FREELANCER,
  'remotive.com': REMOTIVE,
  'remoteok.com': REMOTEOK,
  'search_by_date': HN_STORIES,
  'story_900': HN_COMMENTS,
};

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-scout-'));
  return { dir, env: { JOB_SCOUT_DIR: dir } };
}
const noSleep = async () => {};

describe('job scout — source parsing', () => {
  it('freelancer: normalizes budget, skills, url and strips HTML', () => {
    const [p] = parseFreelancer(FREELANCER);
    expect(p).toMatchObject({ id: 'freelancer:101', source: 'freelancer', sourceUrl: 'https://www.freelancer.com/projects/nextjs/dashboard-101' });
    expect(p.budget).toEqual({ min: 500, max: 1500, currency: 'USD', type: 'fixed' });
    expect(p.skills).toEqual(['React.js', 'Stripe']);
    expect(p.description).toBe('Need a React + Supabase app');
    expect(freelancerUrl('next.js')).toContain('/api/projects/0.1/projects/active/?query=next.js');
  });

  it('remotive: keeps only configured job types', () => {
    const rows = parseRemotive(REMOTIVE, ['contract', 'freelance']);
    expect(rows.map((r) => r.id)).toEqual(['remotive:201']);
  });

  it('remoteok: skips the legal notice row and filters by required tags', () => {
    const rows = parseRemoteOk(REMOTEOK, ['contract']);
    expect(rows.map((r) => r.id)).toEqual(['remoteok:301']);
  });

  it('hn: only top-level SEEKING FREELANCER comments become leads', () => {
    expect(pickHnThread(HN_STORIES)).toBe('900');
    const rows = parseHnComments(HN_COMMENTS, '900');
    expect(rows.map((r) => r.id)).toEqual(['hn:901']);
    expect(rows[0].sourceUrl).toBe('https://news.ycombinator.com/item?id=901');
  });

  it('stripHtml decodes entities and drops tags', () => {
    expect(stripHtml('<p>a &amp; b</p><br>c&#x27;s')).toBe("a & b\nc's");
  });
});

describe('job scout — scoring', () => {
  const profile = compileProfile(CONFIG);

  it('short keywords match whole words only', () => {
    expect(makeMatcher('ai').test('email marketing')).toBe(false);
    expect(makeMatcher('ai').test('AI assistant')).toBe(true);
    expect(makeMatcher('next.js').test('nextXjs')).toBe(false);
  });

  it('ranks a strong title match into the best division', () => {
    const [p] = parseFreelancer(FREELANCER);
    const s = scoreLead(p, profile, NOW);
    expect(s.division).toBe('AppForge');
    expect(s.score).toBeGreaterThanOrEqual(60);
  });

  it('negative keywords zero the score', () => {
    const lead = parseFreelancer(FREELANCER)[1];
    expect(scoreLead(lead, profile, NOW)).toMatchObject({ score: 0, division: null });
  });

  it('budget below the floor costs 30 points', () => {
    const lead = parseFreelancer(FREELANCER)[2];
    const s = scoreLead(lead, profile, NOW);
    const sHigh = scoreLead({ ...lead, budget: { ...lead.budget, max: 900 } }, profile, NOW);
    expect(sHigh.score - s.score).toBe(30);
    expect(s.reasons).toContain('budget below floor');
  });

  it('old posts lose 15 points', () => {
    const [p] = parseFreelancer(FREELANCER);
    const fresh = scoreLead(p, profile, NOW).score;
    const stale = scoreLead({ ...p, postedAt: new Date(NOW - 20 * DAY).toISOString() }, profile, NOW).score;
    expect(fresh - stale).toBe(15);
  });
});

describe('job scout — run', () => {
  it('scans all sources, keeps ranked leads and drafts strong ones', async () => {
    const { dir, env } = tmpEnv();
    const summary = await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    expect(summary.ok).toBe(true);
    expect(Object.values(summary.sources).every((s) => s.ok)).toBe(true);

    const { leads } = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    const ids = leads.map((l) => l.id);
    expect(ids).toContain('freelancer:101');
    expect(ids).toContain('hn:901');
    expect(ids).not.toContain('freelancer:102'); // negative keyword
    expect(ids).not.toContain('remotive:202'); // full-time filtered
    for (let i = 1; i < leads.length; i++) expect(leads[i - 1].score).toBeGreaterThanOrEqual(leads[i].score);

    const top = leads.find((l) => l.id === 'freelancer:101');
    expect(top.draft).toMatch(/Build a Next\.js dashboard with Stripe/);
    expect(summary.newStrong).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, 'status.json'))).toBe(true);
  });

  it('a failing source is recorded and the others still run', async () => {
    const { env } = tmpEnv();
    const summary = await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch({ ...ALL, 'remotive.com': new Error('boom') }), sleep: noSleep });
    expect(summary.ok).toBe(true);
    expect(summary.sources.remotive).toMatchObject({ ok: false, error: 'boom' });
    expect(summary.sources.freelancer.ok).toBe(true);
  });

  it('a total outage does not overwrite existing leads', async () => {
    const { dir, env } = tmpEnv();
    await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    const before = fs.readFileSync(path.join(dir, 'leads.json'), 'utf8');
    const summary = await runScout({ config: CONFIG, env, now: NOW + 40 * DAY, fetchImpl: fakeFetch({}), sleep: noSleep });
    expect(summary.ok).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8')).toBe(before);
  });

  it('keeps firstSeenAt across runs and never touches decisions.json', async () => {
    const { dir, env } = tmpEnv();
    const decisions = { 'freelancer:101': { status: 'shortlisted', at: new Date(NOW).toISOString() } };
    fs.writeFileSync(path.join(dir, 'decisions.json'), JSON.stringify(decisions));
    await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    await runScout({ config: CONFIG, env, now: NOW + DAY, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    const { leads } = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    const l = leads.find((x) => x.id === 'freelancer:101');
    expect(l.firstSeenAt).toBe(new Date(NOW).toISOString());
    expect(l.lastSeenAt).toBe(new Date(NOW + DAY).toISOString());
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'decisions.json'), 'utf8'))).toEqual(decisions);
  });

  it('retention drops unseen leads but keeps shortlisted ones', async () => {
    const { dir, env } = tmpEnv();
    await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    fs.writeFileSync(path.join(dir, 'decisions.json'), JSON.stringify({ 'hn:901': { status: 'shortlisted' } }));
    // 40 days later only freelancer answers, and with nothing relevant.
    await runScout({ config: CONFIG, env, now: NOW + 40 * DAY, fetchImpl: fakeFetch({ 'freelancer.com': { result: { projects: [] } } }), sleep: noSleep });
    const ids = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8')).leads.map((l) => l.id);
    expect(ids).toEqual(['hn:901']);
  });

  it('only issues GET requests to public endpoints', async () => {
    const { env } = tmpEnv();
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, method: (init && init.method) || 'GET' }); return fakeFetch(ALL)(url, init); };
    await runScout({ config: CONFIG, env, now: NOW, fetchImpl, sleep: noSleep });
    expect(seen.every((c) => c.method === 'GET')).toBe(true);
    expect(seen.every((c) => /^https:\/\/(www\.freelancer\.com|remotive\.com|remoteok\.com|hn\.algolia\.com)\//.test(c.url))).toBe(true);
  });
});

describe('job scout — wiring', () => {
  it('draft is a starter that asks Jordan to edit, never a finished send', () => {
    const d = draftProposal({ title: 'X', matched: ['react'] }, { pitch: 'web builds' });
    expect(d).toMatch(/\[EDIT:/);
  });

  it('runs under hydi-schedulers every 3h by default', () => {
    const job = JOBS.find((j) => j.name === 'heidi-job-scout');
    expect(job).toMatchObject({ script: 'scripts/job-scout.js' });
    expect(job.intervalMs).toBe(Number(process.env.JOB_SCOUT_INTERVAL_MS) || 10800000);
  });

  it('shipped config parses and every division has keywords and a pitch', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'job-scout.json'), 'utf8'));
    expect(Object.keys(cfg.divisions).length).toBeGreaterThan(0);
    for (const d of Object.values(cfg.divisions)) {
      expect(d.keywords.length).toBeGreaterThan(0);
      expect(d.pitch).toBeTruthy();
    }
    expect(cfg.sources.upwork).toBeUndefined();
  });
});

describe('job scout — Heidi chat command', () => {
  const { isJobsQuery, formatJobs } = require('../../lib/job-scout/chat');

  it('recognises the jobs phrases only', () => {
    expect(isJobsQuery('jobs')).toBe(true);
    expect(isJobsQuery('Any jobs?')).toBe(true);
    expect(isJobsQuery('what jobs does the scheduler run')).toBe(false);
  });

  it('explains when no scan has run yet', () => {
    const { dir } = tmpEnv();
    expect(formatJobs({ dir, now: NOW })).toMatch(/no scan yet/);
  });

  it('lists open leads, hides dismissed ones and stars shortlisted ones', async () => {
    const { dir, env } = tmpEnv();
    await runScout({ config: CONFIG, env, now: NOW, fetchImpl: fakeFetch(ALL), sleep: noSleep });
    fs.writeFileSync(path.join(dir, 'decisions.json'), JSON.stringify({
      'hn:901': { status: 'dismissed' },
      'freelancer:101': { status: 'shortlisted' },
    }));
    const text = formatJobs({ dir, now: NOW + 3600000 });
    expect(text).not.toContain('item?id=901');
    expect(text).toMatch(/★ \d+ · AppForge · Build a Next\.js dashboard/);
    expect(text).toMatch(/never applies/);
  });
});
