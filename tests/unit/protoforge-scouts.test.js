'use strict';

/**
 * Scout tests: global `fetch` is mocked throughout. These tests never
 * make a real network call -- see scripts/missions/protoforge-daily-
 * opportunity-scan.js's own manual/integration run for proof the real
 * HTTP path works (documented in the mission's own README and the PR
 * description, not re-asserted here since a hermetic unit test must not
 * depend on network availability or a third party's uptime).
 */

const { searchHackerNews } = require('../../lib/missions/scouts/hn-algolia-scout');
const { searchSubreddit, searchReddit } = require('../../lib/missions/scouts/reddit-scout');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('hn-algolia-scout', () => {
  it('parses a successful response into the common item shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          { objectID: '1', title: 'AI Music Tool', url: 'https://example.com/a', points: 42, created_at: '2026-01-01T00:00:00Z' },
          { objectID: '2', story_title: 'Fallback title', points: 5, created_at: null },
        ],
      }),
    });

    const result = await searchHackerNews('AI music');
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      sourceType: 'hn_algolia', title: 'AI Music Tool', sourceUrl: 'https://example.com/a', engagement: 42,
    });
    // falls back to the HN item link when no external url is present
    expect(result.items[1].sourceUrl).toContain('news.ycombinator.com/item?id=2');
  });

  it('reports ok:false on a non-2xx response without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await searchHackerNews('x');
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.error).toContain('503');
  });

  it('reports ok:false on a network error without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const result = await searchHackerNews('x');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNRESET');
  });
});

describe('reddit-scout', () => {
  it('parses a successful subreddit search into the common item shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { children: [{ data: {
          title: 'Sample post', permalink: '/r/test/comments/1/sample', score: 10,
          created_utc: 1735689600, selftext: 'body text',
        } }] },
      }),
    });

    const result = await searchSubreddit('WeAreTheMusicMakers', 'stem separation');
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({
      sourceType: 'reddit_public', title: 'Sample post', engagement: 10, subreddit: 'WeAreTheMusicMakers',
    });
    expect(result.items[0].sourceUrl).toContain('reddit.com/r/test/comments/1/sample');
  });

  it('reports the exact status on a block (documented: 403 from this network)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const result = await searchSubreddit('WeAreTheMusicMakers', 'x');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 403');
  });

  it('searchReddit queries every configured subreddit sequentially and never throws even if all fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const results = await searchReddit('x');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ok === false)).toBe(true);
  });
});
