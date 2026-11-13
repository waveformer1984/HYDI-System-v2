'use strict';

/**
 * Job scout strong-lead alerts — fake Supabase client, no network.
 * Covers: per-lead notify, >3 batching, never-twice dedupe via
 * notifiedAt in leads.json, quiet-hours deferral, and scan resilience.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runScout } = require('../../lib/job-scout/scout');
const { maybeNotifyLeads, isQuietHours } = require('../../lib/job-scout/notify');
const { createNotification } = require('../../lib/notifications/notify');

// 2026-11-13T18:00Z = 12:00 America/Chicago (CST) — outside quiet hours.
const DAYTIME = Date.parse('2026-11-13T18:00:00Z');
// 2026-11-14T04:30Z = 22:30 America/Chicago — inside 22:00–07:00 quiet.
const QUIET = Date.parse('2026-11-14T04:30:00Z');

const CONFIG = {
  minScore: 35,
  draftScore: 60,
  notifyScore: 75,
  notify: { quietHours: { start: '22:00', end: '07:00', timezone: 'America/Chicago' } },
  maxLeads: 50,
  retentionDays: 30,
  minFixedBudgetUsd: 150,
  minHourlyUsd: 20,
  negativeKeywords: ['unpaid'],
  sources: { freelancer: { enabled: true, queries: ['react'] } },
  divisions: {
    AppForge: { pitch: 'full-stack web builds', keywords: ['react', 'next.js', 'stripe', 'supabase'] },
  },
};

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-scout-notify-'));
  return { dir, env: { JOB_SCOUT_DIR: dir } };
}
const noSleep = async () => {};

function freelancerFetch(projects) {
  return async (url) => {
    if (url.includes('freelancer.com')) {
      return { ok: true, json: async () => ({ status: 'success', result: { projects } }) };
    }
    throw new Error(`unexpected url ${url}`);
  };
}

function strongProject(id, title) {
  return {
    id, title, seo_url: `p-${id}`, description: '<p>React Next.js Supabase Stripe dashboard</p>',
    budget: { minimum: 1000, maximum: 3000 }, currency: { code: 'USD' }, type: 'fixed',
    time_submitted: DAYTIME / 1000, jobs: [{ name: 'React.js' }],
  };
}

/** Fake Supabase: records notification inserts; no push subscriptions. */
function fakeSupabase() {
  const inserted = [];
  const client = {
    inserted,
    from(table) {
      const q = {
        _table: table, _payload: null, _op: 'select',
        insert(p) { q._op = 'insert'; q._payload = p; return q; },
        select() { return q; },
        update() { return q; },
        eq() { return q; },
        single() {
          if (q._op === 'insert') {
            const row = { id: `n${inserted.length + 1}`, ...q._payload };
            inserted.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve, reject) {
          const data = q._table === 'push_subscriptions' ? [] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return client;
}

const notifyVia = (sb) => (input) => createNotification(sb, input);

describe('job scout — quiet hours', () => {
  it('detects the overnight window in America/Chicago', () => {
    expect(isQuietHours(QUIET, { start: '22:00', end: '07:00', timezone: 'America/Chicago' })).toBe(true);
    expect(isQuietHours(DAYTIME, { start: '22:00', end: '07:00', timezone: 'America/Chicago' })).toBe(false);
    expect(isQuietHours(DAYTIME, null)).toBe(false);
  });
});

describe('job scout — lead alerts', () => {
  it('sends one notification per new strong lead through createNotification', async () => {
    const { env } = tmpEnv();
    const sb = fakeSupabase();
    const summary = await runScout({
      config: CONFIG, env, now: DAYTIME, sleep: noSleep,
      fetchImpl: freelancerFetch([strongProject(1, 'Build a Next.js dashboard with Stripe billing'), strongProject(2, 'Build a React Supabase Stripe client portal')]),
      notifyFn: notifyVia(sb),
    });
    expect(summary.ok).toBe(true);
    expect(summary.notify.sent).toBe(2);
    expect(sb.inserted).toHaveLength(2);
    expect(sb.inserted.every((n) => n.category === 'job_lead')).toBe(true);
    expect(sb.inserted[0].severity).toBe('operational');
  });

  it('batches into one summary notification when more than 3 leads qualify', async () => {
    const { env } = tmpEnv();
    const sb = fakeSupabase();
    const projects = [1, 2, 3, 4, 5].map((i) => strongProject(i, `Build a Next.js Stripe dashboard ${i}`));
    const summary = await runScout({
      config: CONFIG, env, now: DAYTIME, sleep: noSleep,
      fetchImpl: freelancerFetch(projects),
      notifyFn: notifyVia(sb),
    });
    expect(summary.notify.batched).toBe(true);
    expect(sb.inserted).toHaveLength(1);
    expect(sb.inserted[0].title).toMatch(/5 new strong leads/);
    expect(sb.inserted[0].metadata.kind).toBe('job_lead_batch');
    expect(sb.inserted[0].metadata.leadIds).toHaveLength(5);
  });

  it('never notifies the same lead twice across scans', async () => {
    const { dir, env } = tmpEnv();
    const sb = fakeSupabase();
    const fetchImpl = freelancerFetch([strongProject(1, 'Build a Next.js dashboard with Stripe billing')]);
    await runScout({ config: CONFIG, env, now: DAYTIME, sleep: noSleep, fetchImpl, notifyFn: notifyVia(sb) });
    expect(sb.inserted).toHaveLength(1);
    // Second scan, same lead still present and still strong.
    const summary2 = await runScout({ config: CONFIG, env, now: DAYTIME + 3600000, sleep: noSleep, fetchImpl, notifyFn: notifyVia(sb) });
    expect(summary2.notify.candidates).toBe(0);
    expect(sb.inserted).toHaveLength(1);
    const { leads } = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    expect(leads[0].notifiedAt).toBeTruthy();
  });

  it('defers during quiet hours and sends on the next daytime scan', async () => {
    const { env } = tmpEnv();
    const sb = fakeSupabase();
    const fetchImpl = freelancerFetch([strongProject(1, 'Build a Next.js dashboard with Stripe billing')]);
    const s1 = await runScout({ config: CONFIG, env, now: QUIET, sleep: noSleep, fetchImpl, notifyFn: notifyVia(sb) });
    expect(s1.notify.deferred).toBe(true);
    expect(s1.notify.sent).toBe(0);
    expect(sb.inserted).toHaveLength(0);
    const s2 = await runScout({ config: CONFIG, env, now: DAYTIME, sleep: noSleep, fetchImpl, notifyFn: notifyVia(sb) });
    expect(s2.notify.sent).toBe(1);
    expect(sb.inserted).toHaveLength(1);
  });

  it('a notify failure is recorded in status but never fails the scan', async () => {
    const { env } = tmpEnv();
    const summary = await runScout({
      config: CONFIG, env, now: DAYTIME, sleep: noSleep,
      fetchImpl: freelancerFetch([strongProject(1, 'Build a Next.js dashboard with Stripe billing')]),
      notifyFn: async () => { throw new Error('supabase down'); },
    });
    expect(summary.ok).toBe(true);
    expect(summary.notify.error).toMatch(/supabase down/);
    const status = JSON.parse(fs.readFileSync(path.join(env.JOB_SCOUT_DIR, 'status.json'), 'utf8'));
    expect(status.notify.error).toMatch(/supabase down/);
  });

  it('maybeNotifyLeads ignores leads below notifyScore and already-notified leads', async () => {
    const sent = [];
    const leads = [
      { id: 'a:1', title: 'weak', score: 50 },
      { id: 'b:2', title: 'strong', score: 90, notifiedAt: '2026-01-01T00:00:00Z' },
      { id: 'c:3', title: 'fresh strong', score: 80, sourceUrl: 'https://x' },
    ];
    const r = await maybeNotifyLeads({ leads, config: CONFIG, notifyFn: async (n) => sent.push(n), now: DAYTIME });
    expect(r.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].metadata.leadId).toBe('c:3');
  });
});
