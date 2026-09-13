'use strict';
/**
 * Hacker News (Algolia) scout.
 *
 * https://hn.algolia.com/api/ -- a public, unauthenticated, read-only JSON
 * search API explicitly designed for third-party querying. No API key, no
 * ToS restriction on this kind of read. This is R0 (observe) only: a GET
 * request and nothing else.
 */

const { USER_AGENT, HTTP_TIMEOUT_MS } = require('../config');

const BASE_URL = 'https://hn.algolia.com/api/v1/search_by_date';

/**
 * @param {string} query
 * @returns {Promise<{ok: boolean, query: string, items: Array, error?: string}>}
 */
async function searchHackerNews(query) {
  const url = `${BASE_URL}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=15`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, query, items: [], error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const items = (body.hits || []).map((hit) => ({
      sourceType: 'hn_algolia',
      title: hit.title || hit.story_title || '(untitled)',
      sourceUrl: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: hit.title || hit.story_title || '',
      engagement: Number(hit.points) || 0,
      publishedAt: hit.created_at || null,
      fetchedAt: new Date().toISOString(),
      query,
    }));
    return { ok: true, query, items };
  } catch (e) {
    return { ok: false, query, items: [], error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchHackerNews, SOURCE_TYPE: 'hn_algolia' };
