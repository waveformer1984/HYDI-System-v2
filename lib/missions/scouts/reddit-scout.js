'use strict';
/**
 * Reddit public-search scout.
 *
 * Uses Reddit's public `.json` search endpoint, unauthenticated, against
 * specific named subreddits (see lib/missions/config.js SOURCES.reddit_public).
 * This is a read of public posts already visible to any logged-out
 * visitor -- R0 (observe) only. Reddit's API guidelines ask for a
 * descriptive, honest User-Agent, which config.js sets.
 *
 * Reddit rate-limits or blocks generic/anonymous traffic more
 * aggressively than HN's Algolia API. A failure here (403/429/timeout) is
 * reported as a failed source for this run, not treated as a mission
 * failure -- see scripts/missions/protoforge-daily-opportunity-scan.js's
 * partial-success handling.
 */

const { USER_AGENT, HTTP_TIMEOUT_MS, SOURCES } = require('../config');

/**
 * @param {string} subreddit
 * @param {string} query
 * @returns {Promise<{ok: boolean, query: string, subreddit: string, items: Array, error?: string}>}
 */
async function searchSubreddit(subreddit, query) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json` +
    `?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=10`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, query, subreddit, items: [], error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const children = (body.data && body.data.children) || [];
    const items = children.map((c) => {
      const d = c.data || {};
      return {
        sourceType: 'reddit_public',
        title: d.title || '(untitled)',
        sourceUrl: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
        snippet: (d.selftext || d.title || '').slice(0, 300),
        engagement: Number(d.score) || 0,
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        fetchedAt: new Date().toISOString(),
        query,
        subreddit,
      };
    });
    return { ok: true, query, subreddit, items };
  } catch (e) {
    return { ok: false, query, subreddit, items: [], error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Search every configured subreddit for one query. Never throws. */
async function searchReddit(query) {
  const subreddits = (SOURCES.reddit_public && SOURCES.reddit_public.subreddits) || [];
  const results = [];
  for (const sub of subreddits) {
    // Sequential, not parallel -- be a polite, low-volume caller of a
    // public, unauthenticated endpoint.
    // eslint-disable-next-line no-await-in-loop
    results.push(await searchSubreddit(sub, query));
  }
  return results;
}

module.exports = { searchReddit, searchSubreddit, SOURCE_TYPE: 'reddit_public' };
