#!/usr/bin/env node
'use strict';
/**
 * HYDI Mission Effectiveness Review -- protoforge.daily_opportunity_scan
 * ----------------------------------------------------------------------------
 * Answers the 10 effectiveness questions from the operator's review request
 * against real, persisted data. This is a READ-ONLY reporting tool: it
 * never writes to protoforge_opportunities or protoforge_mission_runs,
 * never changes approval_status, and never touches the mission's scoring,
 * scouts, or scheduler. Running this script is not an architectural
 * change -- it is the review the operator asked for, not another
 * infrastructure audit.
 *
 * Meant to be run periodically (the operator's own recommendation: after
 * 3-7 daily cycles have accumulated). A run with fewer cycles than that
 * still works, but is reported as PRELIMINARY -- see the header of its
 * own output.
 *
 * --save-baseline writes this run's computed report AND a raw dump of the
 * genuine opportunity/mission-run rows it was computed from to
 * docs/mission-reviews/<date>-*.json. This exists so a later tuning
 * decision has something concrete to compare against -- "did precision
 * actually improve" requires the pre-tuning numbers to still exist
 * somewhere, not just today's spoken conclusion. It does not modify
 * protoforge_opportunities/protoforge_mission_runs in any way; it only
 * writes local files.
 *
 * Usage:
 *   node scripts/missions/protoforge-opportunity-review.js
 *   node scripts/missions/protoforge-opportunity-review.js --json
 *   node scripts/missions/protoforge-opportunity-review.js --save-baseline
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local'), quiet: true });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });

const fs = require('fs');
const path = require('path');
const { getClient } = require('../../lib/missions/opportunity-store');

const JSON_MODE = process.argv.includes('--json');
const SAVE_BASELINE = process.argv.includes('--save-baseline');
const BASELINE_DIR = path.resolve(__dirname, '../../docs/mission-reviews');
const MIN_CYCLES_FOR_FULL_CONFIDENCE = 3;

// Two mission_runs rows exist from tests/migrations/20260916000000.test.js's
// own "records a mission run" test, which writes real rows to the live
// database to prove the schema's CHECK constraints and RLS -- see that
// test's own docstring. They are identifiable by the exact fixture
// briefing_text literal it hardcodes; no real mission run ever produces
// that string. Filtered here so the review isn't skewed by test fixtures;
// not deleted, since deleting protoforge_mission_runs rows was not asked
// for and this script only reads.
const TEST_RUN_BRIEFING_MARKER = 'PROTOFORGE DAILY BRIEF\n...';

async function fetchData(supabase) {
  const [oppsRes, runsRes] = await Promise.all([
    supabase.from('protoforge_opportunities').select('*').not('dedup_hash', 'like', 'test-%'),
    supabase.from('protoforge_mission_runs').select('*').order('run_at', { ascending: true }),
  ]);
  if (oppsRes.error) throw new Error(`reading protoforge_opportunities: ${oppsRes.error.message}`);
  if (runsRes.error) throw new Error(`reading protoforge_mission_runs: ${runsRes.error.message}`);

  const opportunities = oppsRes.data || [];
  const allRuns = runsRes.data || [];
  const testRuns = allRuns.filter((r) => r.briefing_text === TEST_RUN_BRIEFING_MARKER);
  const runs = allRuns.filter((r) => r.briefing_text !== TEST_RUN_BRIEFING_MARKER);
  return { opportunities, runs, testRunsExcluded: testRuns.length };
}

function avg(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

/** Q2/Q3: what scoring factors separate rejected from needs_review/high_confidence. */
function scoreSeparation(opportunities) {
  const byStatus = { rejected: [], needs_review: [], high_confidence: [] };
  for (const o of opportunities) {
    const d = o.scoring_detail || {};
    if (byStatus[o.status]) byStatus[o.status].push(d);
  }
  const summarize = (rows) => ({
    count: rows.length,
    avgRelevance: round1(avg(rows.map((r) => r.relevance))),
    avgEngagement: round1(avg(rows.map((r) => r.engagement))),
    avgRecency: round1(avg(rows.map((r) => r.recency))),
    zeroKeywordMatchPct: rows.length ? round1(100 * rows.filter((r) => (r.matchedKeywords || []).length === 0).length / rows.length) : null,
  });
  return {
    rejected: summarize(byStatus.rejected),
    needs_review: summarize(byStatus.needs_review),
    high_confidence: summarize(byStatus.high_confidence),
  };
}

/** Q4: source breakdown. */
function sourceQuality(opportunities) {
  const bySource = {};
  for (const o of opportunities) {
    bySource[o.source_type] = bySource[o.source_type] || { count: 0, high_confidence: 0, needs_review: 0, rejected: 0, confidences: [] };
    const s = bySource[o.source_type];
    s.count += 1;
    s[o.status] = (s[o.status] || 0) + 1;
    s.confidences.push(Number(o.confidence));
  }
  const out = {};
  for (const [k, v] of Object.entries(bySource)) {
    out[k] = { count: v.count, avgConfidence: round1(avg(v.confidences)), high_confidence: v.high_confidence, needs_review: v.needs_review, rejected: v.rejected };
  }
  return out;
}

/** Q5: recency -- age at discovery, using the analyzer's own recency score (already stored, not recomputed). */
function recencyReport(opportunities) {
  const scores = opportunities.map((o) => (o.scoring_detail || {}).recency).filter((n) => typeof n === 'number');
  return { avgRecencyScore: round1(avg(scores)), sampleSize: scores.length };
}

/** Q6: product mapping. */
function productMapping(opportunities) {
  const byProduct = {};
  for (const o of opportunities) byProduct[o.product] = (byProduct[o.product] || 0) + 1;
  return byProduct;
}

/** Q7: actionability -- is required_action distinct text, or a small closed set of templates? */
function actionabilityReport(opportunities) {
  const distinctActions = new Set(opportunities.map((o) => o.required_action));
  return {
    totalOpportunities: opportunities.length,
    distinctRequiredActionStrings: distinctActions.size,
    templates: [...distinctActions],
    isTemplated: distinctActions.size <= 3, // the analyzer currently has exactly 3 canned strings
  };
}

/** Q8: human workload -- what a person actually has to look at (rejected items are filed, not queued for review). */
function humanWorkload(opportunities) {
  const reviewable = opportunities.filter((o) => o.status !== 'rejected' && o.approval_status === 'pending');
  return { reviewableNow: reviewable.length, estimatedMinutes: round1((reviewable.length * 20) / 60) };
}

/** Q9: dedup rate + stability across runs. */
function dedupReport(runs) {
  const rates = runs.map((r) => {
    const total = (r.opportunities_found || 0) + (r.duplicates_skipped || 0);
    return total > 0 ? r.duplicates_skipped / total : null;
  }).filter((n) => n !== null);
  const avgRate = avg(rates); // avg([]) is null; `100 * null` coerces to 0 in JS, so guard explicitly rather than silently reporting 0% for "no data".
  return {
    perRun: runs.map((r) => ({ run_at: r.run_at, found: r.opportunities_found, duplicates: r.duplicates_skipped })),
    avgDuplicateRatePct: avgRate === null ? null : round1(100 * avgRate),
    minPct: rates.length ? round1(100 * Math.min(...rates)) : null,
    maxPct: rates.length ? round1(100 * Math.max(...rates)) : null,
  };
}

/** Q10: revenue potential -- heuristic flag, not a fabricated dollar estimate. Human judgment still required. */
function revenueSignal(opportunities) {
  const collaborationSignals = ['partner', 'collab', 'looking for', 'hiring', 'launch', 'raised', 'funding', 'acquisition', 'licensing', 'sync'];
  const flagged = opportunities.filter((o) => {
    const text = `${o.title} ${o.why_it_matters || ''}`.toLowerCase();
    return collaborationSignals.some((k) => text.includes(k));
  });
  return { flaggedCount: flagged.length, totalCount: opportunities.length, examples: flagged.slice(0, 5).map((o) => o.title) };
}

function computeReport(opportunities, runs, testRunsExcluded) {
  const cyclesObserved = runs.length;
  const confidenceLevel = cyclesObserved >= MIN_CYCLES_FOR_FULL_CONFIDENCE ? 'sufficient' : 'PRELIMINARY -- fewer than the recommended 3-7 cycles';

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      cyclesObserved,
      confidenceLevel,
      testRunsExcludedFromAnalysis: testRunsExcluded,
      totalGenuineOpportunities: opportunities.length,
    },
    q2_q3_scoreSeparation: scoreSeparation(opportunities),
    q4_sourceQuality: sourceQuality(opportunities),
    q5_recency: recencyReport(opportunities),
    q6_productMapping: productMapping(opportunities),
    q7_actionability: actionabilityReport(opportunities),
    q8_humanWorkload: humanWorkload(opportunities),
    q9_deduplication: dedupReport(runs),
    q10_revenueSignal: revenueSignal(opportunities),
  };
}

async function runReview() {
  const supabase = getClient();
  const { opportunities, runs, testRunsExcluded } = await fetchData(supabase);
  return computeReport(opportunities, runs, testRunsExcluded);
}

/**
 * Write today's report plus the raw rows it was computed from to
 * docs/mission-reviews/. Read-only against the database; only ever
 * creates new local files, never overwrites a prior day's baseline
 * (a second save on the same date is suffixed rather than clobbering the
 * first, so an accidental re-run can't silently erase the day's evidence).
 */
function saveBaseline(report, opportunities, runs, dir = BASELINE_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  let suffix = '';
  let n = 1;
  const exists = (s) => fs.existsSync(path.join(dir, `${date}${s}-review.json`));
  while (exists(suffix)) { n += 1; suffix = `-${n}`; }

  const files = {
    [`${date}${suffix}-review.json`]: report,
    [`${date}${suffix}-raw-opportunities.json`]: opportunities,
    [`${date}${suffix}-raw-mission-runs.json`]: runs,
  };
  const written = [];
  for (const [name, data] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    written.push(p);
  }
  return written;
}

function renderText(r) {
  const lines = [];
  lines.push('PROTOFORGE MISSION EFFECTIVENESS REVIEW');
  lines.push('='.repeat(44));
  lines.push('');
  lines.push(`Generated: ${r.meta.generatedAt}`);
  lines.push(`Cycles observed (test fixtures excluded): ${r.meta.cyclesObserved}`);
  lines.push(`Confidence: ${r.meta.confidenceLevel}`);
  if (r.meta.testRunsExcludedFromAnalysis > 0) {
    lines.push(`(${r.meta.testRunsExcludedFromAnalysis} test-fixture mission_runs row(s) excluded from this analysis -- not deleted)`);
  }
  lines.push(`Genuine opportunities analyzed: ${r.meta.totalGenuineOpportunities}`);
  lines.push('');

  lines.push('Q2/Q3 -- Noise & ranking: what separates rejected from needs_review');
  for (const [status, s] of Object.entries(r.q2_q3_scoreSeparation)) {
    lines.push(`  ${status.padEnd(16)} n=${String(s.count).padEnd(4)} avg relevance=${s.avgRelevance ?? 'n/a'} engagement=${s.avgEngagement ?? 'n/a'} recency=${s.avgRecency ?? 'n/a'}  zero-keyword-match=${s.zeroKeywordMatchPct ?? 'n/a'}%`);
  }
  lines.push('');

  lines.push('Q4 -- Source quality');
  for (const [src, s] of Object.entries(r.q4_sourceQuality)) {
    lines.push(`  ${src.padEnd(16)} n=${s.count}  avgConfidence=${s.avgConfidence}  high=${s.high_confidence} review=${s.needs_review} rejected=${s.rejected}`);
  }
  if (!r.q4_sourceQuality.reddit_public) lines.push('  reddit_public: 0 items -- disabled by default (HTTP 403 from this network, documented in lib/missions/config.js)');
  lines.push('');

  lines.push(`Q5 -- Recency: avg recency score ${r.q5_recency.avgRecencyScore}/100 across ${r.q5_recency.sampleSize} items (100=discovered same day)`);
  lines.push('');

  lines.push('Q6 -- ProtoForge relevance (product mapping)');
  for (const [product, count] of Object.entries(r.q6_productMapping)) lines.push(`  ${product}: ${count}`);
  lines.push('');

  lines.push(`Q7 -- Actionability: ${r.q7_actionability.distinctRequiredActionStrings} distinct required_action string(s) across ${r.q7_actionability.totalOpportunities} opportunities`);
  if (r.q7_actionability.isTemplated) {
    lines.push('  FINDING: required_action is currently a closed set of 3 generic templates, not a concrete');
    lines.push('  per-opportunity proposed action. Heidi cannot yet turn a good opportunity into a specific');
    lines.push('  next step from this field alone -- it still requires a human to read the title/evidence.');
  }
  lines.push('');

  lines.push(`Q8 -- Human workload: ${r.q8_humanWorkload.reviewableNow} opportunity(ies) currently pending review (~${r.q8_humanWorkload.estimatedMinutes} min at 20s/item)`);
  lines.push('');

  lines.push(`Q9 -- Deduplication: avg duplicate rate ${r.q9_deduplication.avgDuplicateRatePct}% (range ${r.q9_deduplication.minPct}%-${r.q9_deduplication.maxPct}% across observed cycles)`);
  lines.push('');

  lines.push(`Q10 -- Revenue signal: ${r.q10_revenueSignal.flaggedCount}/${r.q10_revenueSignal.totalCount} opportunities contain a collaboration/business-signal keyword`);
  if (r.q10_revenueSignal.examples.length) {
    lines.push('  Examples:');
    r.q10_revenueSignal.examples.forEach((t) => lines.push(`    - ${t}`));
  }
  lines.push('  Everything else is industry-awareness/competitive-intelligence signal, not a direct lead.');

  return lines.join('\n');
}

async function main() {
  const supabase = getClient();
  const { opportunities, runs, testRunsExcluded } = await fetchData(supabase);
  const report = computeReport(opportunities, runs, testRunsExcluded);

  if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
  else console.log(renderText(report));

  if (SAVE_BASELINE) {
    const written = saveBaseline(report, opportunities, runs);
    console.error('\nBaseline saved:');
    written.forEach((p) => console.error(`  ${p}`));
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`Review FAILED: ${e.message}`);
      process.exit(1);
    });
}

module.exports = { runReview, computeReport, saveBaseline, renderText, scoreSeparation, sourceQuality, dedupReport, actionabilityReport, revenueSignal };
