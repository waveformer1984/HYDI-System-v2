#!/usr/bin/env node
'use strict';
/**
 * HYDI Mission Runner v1 -- protoforge.daily_opportunity_scan
 *
 *   discover -> analyze -> prioritize -> local queue -> briefing
 *   -> human approval -> (execute) -> verify -> record
 *
 * Every arrow is real code (see lib/missions/README.md for the full map).
 * This script IS the "Mission Controller" + "Find work / Analyze /
 * Prioritize" boxes; lib/missions/opportunity-store.js is the "Local work
 * queue"; lib/missions/briefing.js is the "Heidi briefing"; approval and
 * execution are deliberately out of this script's reach (see
 * lib/missions/approval.js).
 *
 * Usage:
 *   node scripts/missions/protoforge-daily-opportunity-scan.js          # human-readable
 *   node scripts/missions/protoforge-daily-opportunity-scan.js --json   # machine-readable (for the scheduler)
 *
 * Autonomy boundary: this script only ever performs GET requests against
 * public, unauthenticated, read-only APIs, and only ever writes to the
 * local `protoforge_opportunities` / `protoforge_mission_runs` tables. It
 * does not send anything external, does not spend anything, and does not
 * flip any record's approval_status. Every run is recorded (success or
 * failure) so this mission's history can be verified from the database,
 * not trusted from an exit code.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local'), quiet: true });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });

const { PRODUCTS, SOURCES, MISSION_ID } = require('../../lib/missions/config');
const { searchHackerNews } = require('../../lib/missions/scouts/hn-algolia-scout');
const { searchReddit } = require('../../lib/missions/scouts/reddit-scout');
const { analyzeItem } = require('../../lib/missions/opportunity-analyzer');
const { upsertOpportunity, listOpportunities, recordMissionRun } = require('../../lib/missions/opportunity-store');
const { buildBriefing } = require('../../lib/missions/briefing');

const JSON_MODE = process.argv.includes('--json');

function log(msg) {
  if (!JSON_MODE) console.log(`[${MISSION_ID}] ${new Date().toISOString()} ${msg}`);
}

/** Run every configured scout for every product's search terms. Never throws -- each source reports its own ok/error. */
async function discover() {
  const sourcesQueried = [];
  const rawItems = []; // { item, product }

  for (const [productKey, product] of Object.entries(PRODUCTS)) {
    for (const term of product.searchTerms) {
      if (SOURCES.hn_algolia.enabled) {
        // eslint-disable-next-line no-await-in-loop
        const hn = await searchHackerNews(term);
        sourcesQueried.push({ source_type: 'hn_algolia', query: term, ok: hn.ok, item_count: hn.items.length, error: hn.error || null });
        hn.items.forEach((item) => rawItems.push({ item, product: productKey }));
      }

      if (SOURCES.reddit_public.enabled) {
        // eslint-disable-next-line no-await-in-loop
        const redditResults = await searchReddit(term);
        for (const r of redditResults) {
          sourcesQueried.push({ source_type: 'reddit_public', query: `${term} (r/${r.subreddit})`, ok: r.ok, item_count: r.items.length, error: r.error || null });
          r.items.forEach((item) => rawItems.push({ item, product: productKey }));
        }
      }
    }
  }
  return { sourcesQueried, rawItems };
}

async function runMission() {
  const startedAt = Date.now();
  log('mission starting');

  let sourcesQueried = [];
  let rawItems = [];
  try {
    const discovered = await discover();
    sourcesQueried = discovered.sourcesQueried;
    rawItems = discovered.rawItems;
  } catch (e) {
    // discover() is designed to never throw (each scout call is wrapped),
    // but if something upstream still does, the run is recorded as
    // failed rather than silently producing an empty briefing.
    const durationMs = Date.now() - startedAt;
    await recordMissionRun({ status: 'failed', error: e.message, durationMs, sourcesQueried });
    log(`mission FAILED during discovery: ${e.message}`);
    return { status: 'failed', error: e.message };
  }

  log(`discovered ${rawItems.length} raw item(s) across ${sourcesQueried.length} source quer(y/ies)`);

  let inserted = 0;
  let duplicates = 0;
  const insertErrors = [];
  for (const { item, product } of rawItems) {
    const keywords = PRODUCTS[product].relevanceKeywords;
    const analyzed = analyzeItem(item, product, keywords);
    // eslint-disable-next-line no-await-in-loop
    const result = await upsertOpportunity(analyzed);
    if (result.inserted) inserted += 1;
    else if (result.duplicate) duplicates += 1;
    else if (result.error) insertErrors.push(result.error);
  }

  log(`persisted ${inserted} new opportunit(y/ies), skipped ${duplicates} duplicate(s)${insertErrors.length ? `, ${insertErrors.length} error(s)` : ''}`);

  let opportunities;
  try {
    opportunities = await listOpportunities({ limit: 100 });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    await recordMissionRun({ status: 'partial', error: `discovery ok, listing failed: ${e.message}`, durationMs, sourcesQueried, opportunitiesFound: inserted, duplicatesSkipped: duplicates });
    log(`mission PARTIAL: could not read back the queue: ${e.message}`);
    return { status: 'partial', error: e.message };
  }

  const briefingText = buildBriefing(opportunities);
  const highConfidenceCount = opportunities.filter((o) => o.status === 'high_confidence').length;
  const needsReviewCount = opportunities.filter((o) => o.status === 'needs_review').length;
  const rejectedCount = opportunities.filter((o) => o.status === 'rejected').length;
  const durationMs = Date.now() - startedAt;

  const anySourceOk = sourcesQueried.some((s) => s.ok);
  const status = anySourceOk ? (insertErrors.length > 0 ? 'partial' : 'success') : 'failed';

  const run = await recordMissionRun({
    status,
    sourcesQueried,
    opportunitiesFound: inserted,
    duplicatesSkipped: duplicates,
    highConfidenceCount,
    needsReviewCount,
    rejectedCount,
    briefingText,
    error: insertErrors.length ? insertErrors.join('; ') : (anySourceOk ? null : 'all sources failed'),
    durationMs,
  });

  log(`mission ${status.toUpperCase()} in ${durationMs}ms, run_id=${run.id}`);

  return {
    status,
    runId: run.id,
    briefingText,
    opportunitiesFound: inserted,
    duplicatesSkipped: duplicates,
    highConfidenceCount,
    needsReviewCount,
    rejectedCount,
    sourcesQueried,
    durationMs,
  };
}

if (require.main === module) {
  runMission()
    .then((result) => {
      if (JSON_MODE) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.briefingText) {
        console.log('\n' + result.briefingText + '\n');
      }
      process.exit(result.status === 'failed' ? 1 : 0);
    })
    .catch((e) => {
      console.error(`[${MISSION_ID}] FATAL: ${e.message}`);
      process.exit(1);
    });
}

module.exports = { runMission, discover };
