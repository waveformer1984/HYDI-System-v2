'use strict';
/**
 * Job scout — tests on REAL trimmed API responses captured live
 * (GET only, existing User-Agent, no logins). Fixtures under
 * tests/fixtures/job-scout/ are verbatim slices of the endpoints the
 * adapters call, so a field-name or shape change upstream fails here
 * instead of silently zeroing the scout.
 */

const fs = require('fs');
const path = require('path');
const {
  parseFreelancer, parseRemotive, parseRemoteOk, pickHnThread, parseHnComments,
} = require('../../lib/job-scout/sources');

const DIR = path.join(__dirname, '..', 'fixtures', 'job-scout');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

const REMOTIVE_JOB_TYPES = ['contract', 'freelance', 'part_time'];
const REMOTEOK_TAGS = ['contract', 'freelance', 'part time', 'part-time'];

describe('job scout — live fixtures (real API shapes)', () => {
  it('freelancer: parses projects/active response into leads', () => {
    const leads = parseFreelancer(load('freelancer-active.json'));
    expect(leads.length).toBeGreaterThanOrEqual(3);
    for (const l of leads) {
      expect(l.id).toMatch(/^freelancer:\d+$/);
      expect(l.source).toBe('freelancer');
      expect(l.sourceUrl).toMatch(/^https:\/\/www\.freelancer\.com\//);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.description.length).toBeGreaterThan(0);
      expect(l.budget).toHaveProperty('currency');
      expect(Array.isArray(l.skills)).toBe(true);
      expect(l.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // Real response carries hourly + fixed budgets and seo_url paths.
    expect(leads.some((l) => l.budget.type === 'hourly')).toBe(true);
    expect(leads.every((l) => !/<[a-z]/i.test(l.description))).toBe(true);
  });

  it('remotive: filters real jobs to configured job types', () => {
    const body = load('remotive-remote-jobs.json');
    const leads = parseRemotive(body, REMOTIVE_JOB_TYPES);
    expect(body.jobs.length).toBeGreaterThan(leads.length); // filter actually filters
    expect(leads.length).toBeGreaterThanOrEqual(5);
    for (const l of leads) {
      expect(l.id).toMatch(/^remotive:\d+$/);
      expect(REMOTIVE_JOB_TYPES).toContain(l.kind);
      expect(l.sourceUrl).toMatch(/^https:\/\//);
      expect(l.company).toBeTruthy();
    }
  });

  it('remoteok: skips the legal notice row and filters by required tags', () => {
    const body = load('remoteok-api.json');
    const leads = parseRemoteOk(body, REMOTEOK_TAGS);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).not.toHaveProperty('position'); // legal notice first row
    expect(leads.length).toBeGreaterThanOrEqual(2);
    for (const l of leads) {
      expect(l.id).toMatch(/^remoteok:\d+$/);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.sourceUrl).toMatch(/^https:\/\//);
      expect(l.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('hn: picks the real seeking-freelancer thread and parses its comments', () => {
    const thread = load('hn-thread-search.json');
    const storyId = pickHnThread(thread);
    expect(storyId).toBe('45438502'); // Ask HN: Freelancer? Seeking freelancer? (October 2025)

    // The October 2025 thread currently has zero SEEKING FREELANCER posts —
    // almost everything is SEEKING WORK. That is real data, not a parser bug.
    const oct = parseHnComments(load('hn-comments-oct.json'), storyId);
    expect(oct).toEqual([]);

    // The September 2025 thread does have real hiring posts; the parser
    // must catch them.
    const sept = parseHnComments(load('hn-comments-sept.json'), '45093191');
    expect(sept.length).toBe(2);
    for (const l of sept) {
      expect(l.id).toMatch(/^hn:\d+$/);
      expect(l.sourceUrl).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
      expect(l.title).toMatch(/^SEEKING FREELANCER/i);
      expect(l.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
