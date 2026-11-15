#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('../lib/partnerships-funding/coordinator');

const verifyPath = process.argv[2] || path.join(process.cwd(), '.runtime', 'resource-discovery', 'last-verification-sample.json');
const v = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
const state = new PartnershipsFundingCoordinator().store.load();
const byId = Object.fromEntries(state.opportunities.map((o) => [o.id, o]));

const { bucketForOpportunity, RANKING_BUCKETS } = require('../lib/resource-acquisition/intelligence');

function reportBucket(opp) {
  const b = bucketForOpportunity(opp);
  if (b === RANKING_BUCKETS.AI_RESEARCH || b === RANKING_BUCKETS.IMMEDIATE_FREE) return 'ai_developer';
  if (b === RANKING_BUCKETS.COMPUTE_INFRA) return 'compute';
  if (b === RANKING_BUCKETS.GRANTS_FUNDING) return 'grants_funding';
  if (b === RANKING_BUCKETS.COMMERCIAL) return 'commercial';
  return 'other';
}

const stats = {
  ai_developer: { checked: 0, source_reachable: 0, program_confirmed: 0 },
  compute: { checked: 0, source_reachable: 0, program_confirmed: 0 },
  grants_funding: { checked: 0, source_reachable: 0, program_confirmed: 0 },
  commercial: { checked: 0, source_reachable: 0, program_confirmed: 0 },
};

for (const r of v.results) {
  const o = byId[r.id];
  if (!o) continue;
  const k = reportBucket(o);
  if (!stats[k]) continue;
  stats[k].checked += 1;
  if (r.flags.source_reachable) stats[k].source_reachable += 1;
  if (r.flags.program_confirmed) stats[k].program_confirmed += 1;
}

const out = {
  verification_file: verifyPath,
  global: v.counts,
  by_bucket: stats,
  target_per_bucket: 10,
  benefits_confirmed_note: 'Automated v1 never sets benefits_confirmed from HTML alone.',
};
console.log(JSON.stringify(out, null, 2));