'use strict';
/**
 * Deterministic scoring for raw scout items -> opportunity records.
 *
 * Deliberately NOT an LLM call. A confidence number that came out of a
 * language model's "judgment" is not evidence of anything; a confidence
 * number that came out of three named, readable factors is. Every score
 * this module produces carries its own `scoring_detail` so a human can
 * see exactly why a record got the number it did, and the analyzer's
 * unit tests (tests/unit/protoforge-opportunity-analyzer.test.js) pin the
 * formula down so it can't silently drift.
 *
 * Formula (each 0-100, then weighted-averaged):
 *   relevance  (50%) -- fraction of the product's configured keywords
 *                       that appear in the item's title+snippet, scaled up.
 *   engagement (30%) -- log-scaled score/upvotes, so one outlier post
 *                       can't single-handedly dominate.
 *   recency    (20%) -- linear decay over 14 days; older items still
 *                       score low rather than zero, since the underlying
 *                       trend can still be worth noting.
 */

const crypto = require('crypto');
const { HIGH_CONFIDENCE_THRESHOLD, REJECT_BELOW } = require('./config');

const RECENCY_WINDOW_DAYS = 14;

function relevanceScore(text, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase()));
  // 1 keyword hit already counts for something (it wasn't picked
  // randomly); scale so 3+ distinct keyword hits saturates at 100.
  return Math.min(100, Math.round((hits.length / 3) * 100));
}

function engagementScore(engagement) {
  const n = Math.max(0, Number(engagement) || 0);
  // log10(1)=0 .. log10(1000)=3 -> scale 0..100 over that range.
  return Math.min(100, Math.round((Math.log10(n + 1) / 3) * 100));
}

function recencyScore(publishedAtIso) {
  if (!publishedAtIso) return 40; // unknown age: neither fresh nor stale, don't punish or reward a missing fact
  const ageMs = Date.now() - new Date(publishedAtIso).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 100;
  if (ageDays >= RECENCY_WINDOW_DAYS) return 10;
  return Math.round(100 - (ageDays / RECENCY_WINDOW_DAYS) * 90);
}

/** sha256 of the normalized dedup key -- same item across runs must land on the same row. */
function dedupHash(item) {
  const key = (item.sourceUrl || `${item.sourceType}:${item.title}`).trim().toLowerCase().replace(/\/+$/, '');
  return crypto.createHash('sha256').update(key).digest('hex');
}

function classify(confidence) {
  if (confidence < REJECT_BELOW) return 'rejected';
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'high_confidence';
  return 'needs_review';
}

/**
 * @param {object} item  raw scout item (see scouts/*.js output shape)
 * @param {string} product  key into config.PRODUCTS
 * @param {string[]} keywords  product.relevanceKeywords
 * @returns {object} a row shaped for opportunity-store.upsertOpportunity
 */
function analyzeItem(item, product, keywords) {
  const text = `${item.title || ''} ${item.snippet || ''}`;
  const relevance = relevanceScore(text, keywords);
  const engagement = engagementScore(item.engagement);
  const recency = recencyScore(item.publishedAt);
  const confidence = Math.round(relevance * 0.5 + engagement * 0.3 + recency * 0.2);
  const status = classify(confidence);

  const matchedKeywords = keywords.filter((k) => text.toLowerCase().includes(k.toLowerCase()));

  return {
    product,
    dedupHash: dedupHash(item),
    title: item.title,
    whyItMatters: matchedKeywords.length > 0
      ? `Matches ${matchedKeywords.length} tracked term(s) for ${product}: ${matchedKeywords.slice(0, 3).join(', ')}.`
      : `Surfaced by query "${item.query}" but did not match a tracked keyword -- review before acting on it.`,
    requiredAction: status === 'high_confidence'
      ? 'Review and, if genuinely actionable, approve for follow-up.'
      : status === 'needs_review'
        ? 'Needs a human read to judge relevance before any follow-up.'
        : 'No action -- filed for the record, not worth follow-up as scored.',
    estimatedValue: 'unknown -- not estimated in v1 (no fabricated dollar figures)',
    confidence,
    status,
    sourceType: item.sourceType,
    evidence: [{
      source_url: item.sourceUrl || null,
      snippet: (item.snippet || '').slice(0, 300),
      fetched_at: item.fetchedAt,
      raw_score: item.engagement,
    }],
    scoringDetail: {
      relevance, engagement, recency,
      weights: { relevance: 0.5, engagement: 0.3, recency: 0.2 },
      matchedKeywords,
      query: item.query,
    },
    discoveredAt: item.fetchedAt,
  };
}

module.exports = {
  analyzeItem,
  dedupHash,
  classify,
  relevanceScore,
  engagementScore,
  recencyScore,
};
