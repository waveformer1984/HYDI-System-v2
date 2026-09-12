'use strict';

/**
 * scripts/missions/protoforge-daily-opportunity-scan.js -- hermetic tests
 * for the orchestration logic (discover/analyze/persist/record), with the
 * scouts and the store both mocked. No real network call, no real database
 * write happens in this file.
 *
 * Every test re-requires the mission script fresh (jest.resetModules() +
 * jest.doMock()) rather than mixing that with a shared top-level require --
 * a few tests need PROTOFORGE_SCOUT_REDDIT_ENABLED to take effect at
 * lib/missions/config.js's module-load time, and resetting modules for
 * only SOME tests while other tests keep a stale top-level `require`
 * reference is exactly the kind of hard-to-see bug this file's own first
 * draft had (mixed styles produced two failures that looked like mission
 * bugs but were test-harness bugs) -- one consistent pattern for every
 * test avoids that class of mistake entirely.
 */

const rawItem = (over = {}) => ({
  sourceType: 'hn_algolia', title: 'AI Music Generation launches', snippet: '',
  sourceUrl: 'https://example.com/1', engagement: 10, publishedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(), query: 'AI music generation', ...over,
});

/** Fresh, isolated require of the mission script and its mocked collaborators. */
function setupMission() {
  jest.resetModules();
  jest.doMock('../../lib/missions/scouts/hn-algolia-scout');
  jest.doMock('../../lib/missions/scouts/reddit-scout');
  jest.doMock('../../lib/missions/opportunity-store');
  const hn = require('../../lib/missions/scouts/hn-algolia-scout');
  const reddit = require('../../lib/missions/scouts/reddit-scout');
  const store = require('../../lib/missions/opportunity-store');
  const mission = require('../../scripts/missions/protoforge-daily-opportunity-scan');
  return { hn, reddit, store, ...mission };
}

afterEach(() => {
  delete process.env.PROTOFORGE_SCOUT_REDDIT_ENABLED;
});

describe('Test H -- disabled scout is never called', () => {
  it('Reddit is disabled by default: reddit-scout.searchReddit is never invoked', async () => {
    const { hn, reddit, store, discover } = setupMission();
    hn.searchHackerNews.mockResolvedValue({ ok: true, query: 'x', items: [rawItem()] });
    reddit.searchReddit.mockResolvedValue([]);
    store.upsertOpportunity.mockResolvedValue({ inserted: true, id: 'a' });

    await discover();

    expect(hn.searchHackerNews).toHaveBeenCalled();
    expect(reddit.searchReddit).not.toHaveBeenCalled();
  });

  it('explicitly enabling Reddit via env does call the scout', async () => {
    process.env.PROTOFORGE_SCOUT_REDDIT_ENABLED = 'true';
    const { hn, reddit, discover } = setupMission();
    hn.searchHackerNews.mockResolvedValue({ ok: true, query: 'x', items: [] });
    reddit.searchReddit.mockResolvedValue([{ ok: true, subreddit: 'test', query: 'x', items: [] }]);

    await discover();

    expect(reddit.searchReddit).toHaveBeenCalled();
  });
});

describe('Test I -- a fully-failed source (e.g. Reddit 403) does not fail the mission', () => {
  it('records the source failure in sourcesQueried but still returns whatever HN found', async () => {
    process.env.PROTOFORGE_SCOUT_REDDIT_ENABLED = 'true';
    const { hn, reddit, store, runMission } = setupMission();

    hn.searchHackerNews.mockResolvedValue({ ok: true, query: 'x', items: [rawItem()] });
    reddit.searchReddit.mockResolvedValue([{ ok: false, subreddit: 'test', query: 'x', items: [], error: 'HTTP 403' }]);
    store.upsertOpportunity.mockResolvedValue({ inserted: true, id: 'a' });
    store.listOpportunities.mockResolvedValue([{ id: 'a', status: 'needs_review', confidence: 40 }]);
    store.recordMissionRun.mockImplementation(async (run) => ({ id: 'run-1', run_at: new Date().toISOString(), _run: run }));

    const result = await runMission();

    expect(result.status).toBe('success'); // HN succeeded, so the mission overall did not fail
    const redditEntry = result.sourcesQueried.find((s) => s.source_type === 'reddit_public');
    expect(redditEntry).toMatchObject({ ok: false, error: 'HTTP 403' });
  });
});

describe('Test K -- duplicate opportunity discovery', () => {
  it('counts duplicates separately from newly-inserted opportunities and still succeeds', async () => {
    const { hn, reddit, store, runMission } = setupMission();

    // Two distinct real signals, each surfaced once per search term -- the
    // store is what actually decides new-vs-duplicate (by dedup_hash), so
    // the mock below tracks "seen hashes" itself rather than depending on
    // call order, exactly mirroring the real upsertOpportunity's behavior.
    const items = [rawItem({ sourceUrl: 'https://example.com/1' }), rawItem({ sourceUrl: 'https://example.com/2', title: 'Stem separation update' })];
    hn.searchHackerNews.mockResolvedValue({ ok: true, query: 'x', items });
    reddit.searchReddit.mockResolvedValue([]);

    const seen = new Set();
    store.upsertOpportunity.mockImplementation(async (record) => {
      if (seen.has(record.dedupHash)) return { inserted: false, duplicate: true, id: 'existing' };
      seen.add(record.dedupHash);
      return { inserted: true, id: `new-${seen.size}` };
    });
    store.listOpportunities.mockResolvedValue([{ id: 'new-1', status: 'needs_review', confidence: 40 }, { id: 'new-2', status: 'needs_review', confidence: 40 }]);
    store.recordMissionRun.mockImplementation(async (run) => ({ id: 'run-1', run_at: new Date().toISOString(), _run: run }));

    const result = await runMission();

    // 2 distinct items x 6 configured Rezonate search terms = 12 raw
    // upserts, but only 2 distinct dedup hashes -- so exactly 2 inserted,
    // 10 duplicates, regardless of how many search terms surface them.
    expect(result.opportunitiesFound).toBe(2);
    expect(result.duplicatesSkipped).toBe(10);
    expect(result.status).toBe('success');
  });
});

describe('Test J -- persistence failure at the mission level', () => {
  it('reports status:"partial" (not "success") when the queue cannot be read back after discovery succeeded', async () => {
    const { hn, reddit, store, runMission } = setupMission();
    hn.searchHackerNews.mockResolvedValue({ ok: true, query: 'x', items: [rawItem()] });
    reddit.searchReddit.mockResolvedValue([]);
    store.upsertOpportunity.mockResolvedValue({ inserted: true, id: 'a' });
    store.listOpportunities.mockRejectedValue(new Error('connection reset'));
    store.recordMissionRun.mockImplementation(async (run) => ({ id: 'run-1', run_at: new Date().toISOString(), _run: run }));

    const result = await runMission();

    expect(result.status).toBe('partial');
    expect(result.error).toMatch(/connection reset/);
    // Even a partial failure must still be recorded -- never a silent gap.
    expect(store.recordMissionRun).toHaveBeenCalled();
  });

  it('reports status:"failed" when every source fails', async () => {
    const { hn, reddit, store, runMission } = setupMission();
    hn.searchHackerNews.mockResolvedValue({ ok: false, query: 'x', items: [], error: 'HTTP 503' });
    reddit.searchReddit.mockResolvedValue([]);
    store.listOpportunities.mockResolvedValue([]);
    store.recordMissionRun.mockImplementation(async (run) => ({ id: 'run-1', run_at: new Date().toISOString(), _run: run }));

    const result = await runMission();

    expect(result.status).toBe('failed');
  });
});

describe('Test L -- R1/R2+ boundary: the scheduled path never references approval or execution', () => {
  it('the mission script and scheduler never import or call approve/reject/execute', () => {
    const fs = require('fs');
    const path = require('path');
    const missionSrc = fs.readFileSync(path.resolve(__dirname, '../../scripts/missions/protoforge-daily-opportunity-scan.js'), 'utf8');
    const schedulerSrc = fs.readFileSync(path.resolve(__dirname, '../../scripts/protoforge-opportunity-scheduler.js'), 'utf8');
    for (const forbidden of ['approveOpportunity', 'rejectOpportunity', 'executeApprovedOpportunity', "require('../../lib/missions/approval')", "require('./approval')"]) {
      expect(missionSrc).not.toContain(forbidden);
      expect(schedulerSrc).not.toContain(forbidden);
    }
  });

  it("executeApprovedOpportunity remains unconditionally NOT_IMPLEMENTED (re-asserted here as a scheduler-qualification gate, not just approval's own suite)", async () => {
    jest.resetModules();
    jest.doMock('../../lib/missions/opportunity-store', () => ({
      setApproval: jest.fn(), getOpportunity: jest.fn().mockResolvedValue({ id: '1', approval_status: 'approved' }),
    }));
    const { executeApprovedOpportunity } = require('../../lib/missions/approval');
    await expect(executeApprovedOpportunity('1')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});
