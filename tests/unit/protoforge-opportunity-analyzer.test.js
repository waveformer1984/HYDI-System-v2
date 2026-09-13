'use strict';

const {
  analyzeItem, dedupHash, classify, relevanceScore, engagementScore, recencyScore,
} = require('../../lib/missions/opportunity-analyzer');

describe('opportunity-analyzer: relevanceScore', () => {
  it('scores 0 for no keyword matches', () => {
    expect(relevanceScore('completely unrelated text', ['ai music', 'stem separation'])).toBe(0);
  });
  it('scores partial credit for one match', () => {
    const s = relevanceScore('a post about AI Music generation', ['ai music', 'stem separation', 'sync licensing']);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });
  it('saturates at 100 with 3+ distinct matches', () => {
    const s = relevanceScore('ai music, stem separation, and sync licensing all in one post', ['ai music', 'stem separation', 'sync licensing']);
    expect(s).toBe(100);
  });
  it('is case-insensitive', () => {
    expect(relevanceScore('AI MUSIC GENERATION', ['ai music'])).toBeGreaterThan(0);
  });
});

describe('opportunity-analyzer: engagementScore', () => {
  it('scores 0 for no engagement', () => {
    expect(engagementScore(0)).toBe(0);
  });
  it('scores higher for more engagement, log-scaled', () => {
    const low = engagementScore(5);
    const mid = engagementScore(100);
    const high = engagementScore(1000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBeLessThanOrEqual(100);
  });
  it('treats negative/garbage input as zero engagement, never throws', () => {
    expect(engagementScore(-5)).toBe(0);
    expect(engagementScore(undefined)).toBe(0);
    expect(engagementScore(NaN)).toBe(0);
  });
});

describe('opportunity-analyzer: recencyScore', () => {
  it('scores near 100 for something published now', () => {
    expect(recencyScore(new Date().toISOString())).toBeGreaterThanOrEqual(95);
  });
  it('scores near the floor for something older than the window', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(old)).toBe(10);
  });
  it('does not zero out or reward a missing publish date', () => {
    const s = recencyScore(null);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });
});

describe('opportunity-analyzer: dedupHash', () => {
  it('is stable for the same URL', () => {
    const a = dedupHash({ sourceUrl: 'https://example.com/post/1', sourceType: 'hn_algolia', title: 'x' });
    const b = dedupHash({ sourceUrl: 'https://example.com/post/1', sourceType: 'hn_algolia', title: 'x' });
    expect(a).toBe(b);
  });
  it('is case/trailing-slash insensitive', () => {
    const a = dedupHash({ sourceUrl: 'https://Example.com/post/1/' });
    const b = dedupHash({ sourceUrl: 'https://example.com/post/1' });
    expect(a).toBe(b);
  });
  it('differs for different URLs', () => {
    const a = dedupHash({ sourceUrl: 'https://example.com/post/1' });
    const b = dedupHash({ sourceUrl: 'https://example.com/post/2' });
    expect(a).not.toBe(b);
  });
  it('falls back to sourceType+title when there is no URL', () => {
    const a = dedupHash({ sourceType: 'reddit_public', title: 'Same title' });
    const b = dedupHash({ sourceType: 'reddit_public', title: 'Same title' });
    expect(a).toBe(b);
  });
});

describe('opportunity-analyzer: classify', () => {
  it('rejects below the reject threshold', () => {
    expect(classify(10)).toBe('rejected');
    expect(classify(24)).toBe('rejected');
  });
  it('needs review in the middle band', () => {
    expect(classify(25)).toBe('needs_review');
    expect(classify(69)).toBe('needs_review');
  });
  it('is high-confidence at and above the threshold', () => {
    expect(classify(70)).toBe('high_confidence');
    expect(classify(100)).toBe('high_confidence');
  });
});

describe('opportunity-analyzer: analyzeItem (integration of the above)', () => {
  const keywords = ['ai music', 'stem separation'];
  const item = {
    sourceType: 'hn_algolia',
    title: 'New AI Music tool launches',
    snippet: 'A new AI Music generation tool',
    sourceUrl: 'https://example.com/story',
    engagement: 200,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    query: 'AI music generation',
  };

  it('produces a row with every field the store expects', () => {
    const result = analyzeItem(item, 'rezonate', keywords);
    expect(result).toMatchObject({
      product: 'rezonate',
      title: item.title,
      sourceType: 'hn_algolia',
      status: expect.stringMatching(/^(high_confidence|needs_review|rejected)$/),
    });
    expect(typeof result.confidence).toBe('number');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].source_url).toBe(item.sourceUrl);
    expect(result.scoringDetail.weights).toEqual({ relevance: 0.5, engagement: 0.3, recency: 0.2 });
  });

  it('never fabricates a dollar estimate', () => {
    const result = analyzeItem(item, 'rezonate', keywords);
    expect(result.estimatedValue).toMatch(/unknown/i);
  });

  it('why_it_matters cites the actual matched keywords, not a generic claim', () => {
    const result = analyzeItem(item, 'rezonate', keywords);
    expect(result.whyItMatters).toContain('ai music');
  });
});
