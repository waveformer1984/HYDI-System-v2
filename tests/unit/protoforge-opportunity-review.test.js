'use strict';

/**
 * Pure-function tests for scripts/missions/protoforge-opportunity-review.js.
 * No database, no network -- these operate on synthetic fixtures shaped
 * like real rows. The script's own DB read (fetchData/runReview) is not
 * re-tested here (it's a thin two-query read, already exercised for real
 * against the live database when the review was first run).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  scoreSeparation, sourceQuality, dedupReport, actionabilityReport, revenueSignal, saveBaseline,
} = require('../../scripts/missions/protoforge-opportunity-review');

const opp = (over = {}) => ({
  title: 'x', why_it_matters: '', required_action: 'Needs a human read to judge relevance before any follow-up.',
  product: 'rezonate', source_type: 'hn_algolia', status: 'needs_review', confidence: 50,
  scoring_detail: { relevance: 30, engagement: 20, recency: 50, matchedKeywords: ['ai music'] },
  ...over,
});

describe('scoreSeparation', () => {
  it('separates the three status buckets and computes their averages independently', () => {
    const opportunities = [
      opp({ status: 'rejected', scoring_detail: { relevance: 0, engagement: 0, recency: 10, matchedKeywords: [] } }),
      opp({ status: 'rejected', scoring_detail: { relevance: 10, engagement: 10, recency: 10, matchedKeywords: [] } }),
      opp({ status: 'needs_review', scoring_detail: { relevance: 40, engagement: 40, recency: 40, matchedKeywords: ['x'] } }),
    ];
    const result = scoreSeparation(opportunities);
    expect(result.rejected.count).toBe(2);
    expect(result.rejected.avgRelevance).toBe(5);
    expect(result.rejected.zeroKeywordMatchPct).toBe(100);
    expect(result.needs_review.count).toBe(1);
    expect(result.needs_review.avgRelevance).toBe(40);
  });

  it('reports null (not NaN or a crash) for an empty bucket', () => {
    const result = scoreSeparation([opp({ status: 'rejected' })]);
    expect(result.high_confidence.count).toBe(0);
    expect(result.high_confidence.avgRelevance).toBeNull();
  });
});

describe('sourceQuality', () => {
  it('breaks down count/confidence/status by source_type', () => {
    const opportunities = [
      opp({ source_type: 'hn_algolia', status: 'needs_review', confidence: 40 }),
      opp({ source_type: 'hn_algolia', status: 'rejected', confidence: 10 }),
      opp({ source_type: 'reddit_public', status: 'high_confidence', confidence: 90 }),
    ];
    const result = sourceQuality(opportunities);
    expect(result.hn_algolia.count).toBe(2);
    expect(result.hn_algolia.avgConfidence).toBe(25);
    expect(result.reddit_public.count).toBe(1);
    expect(result.reddit_public.high_confidence).toBe(1);
  });
});

describe('dedupReport', () => {
  it('computes the duplicate rate per run and the min/max/avg across runs', () => {
    const runs = [
      { run_at: 't1', opportunities_found: 10, duplicates_skipped: 0 },  // 0%
      { run_at: 't2', opportunities_found: 5, duplicates_skipped: 45 },  // 90%
    ];
    const result = dedupReport(runs);
    expect(result.minPct).toBe(0);
    expect(result.maxPct).toBe(90);
    expect(result.avgDuplicateRatePct).toBe(45);
  });

  it('ignores a run with zero total activity rather than dividing by zero', () => {
    const runs = [{ run_at: 't1', opportunities_found: 0, duplicates_skipped: 0 }];
    const result = dedupReport(runs);
    expect(result.avgDuplicateRatePct).toBeNull();
  });
});

describe('actionabilityReport', () => {
  it('flags the current templated-action limitation when few distinct strings are used', () => {
    const opportunities = [
      opp({ required_action: 'Needs a human read to judge relevance before any follow-up.' }),
      opp({ required_action: 'Needs a human read to judge relevance before any follow-up.' }),
      opp({ required_action: 'No action -- filed for the record, not worth follow-up as scored.' }),
    ];
    const result = actionabilityReport(opportunities);
    expect(result.distinctRequiredActionStrings).toBe(2);
    expect(result.isTemplated).toBe(true);
  });
});

describe('revenueSignal', () => {
  it('flags opportunities whose text contains a collaboration/business-signal keyword', () => {
    const opportunities = [
      opp({ title: 'Show HN: I built SyncForge to connect indie artists with sync deals' }),
      opp({ title: 'A completely unrelated post about Linux kernel scheduling' }),
    ];
    const result = revenueSignal(opportunities);
    expect(result.flaggedCount).toBe(1);
    expect(result.examples[0]).toContain('SyncForge');
  });

  it('never fabricates a dollar figure -- only counts and titles are returned', () => {
    const result = revenueSignal([opp()]);
    expect(result).not.toHaveProperty('estimatedRevenue');
    expect(result).not.toHaveProperty('dollarValue');
  });
});

describe('saveBaseline', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoforge-review-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the report and both raw dumps as real, valid JSON files', () => {
    const written = saveBaseline({ meta: { x: 1 } }, [{ id: 'a' }], [{ id: 'run-1' }], dir);
    expect(written).toHaveLength(3);
    for (const p of written) {
      expect(fs.existsSync(p)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(p, 'utf8'))).not.toThrow();
    }
  });

  it('never overwrites an existing same-day baseline -- suffixes instead', () => {
    const first = saveBaseline({ meta: { run: 1 } }, [], [], dir);
    const second = saveBaseline({ meta: { run: 2 } }, [], [], dir);
    expect(first[0]).not.toBe(second[0]);
    // The first save's content must survive the second save untouched.
    const firstContent = JSON.parse(fs.readFileSync(first[0], 'utf8'));
    expect(firstContent.meta.run).toBe(1);
  });
});
