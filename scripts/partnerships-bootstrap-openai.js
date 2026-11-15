#!/usr/bin/env node
'use strict';

/**
 * Load OpenAI startups milestone into HYDI_PARTNERSHIPS_DIR (fixture; no web scrape).
 */

const fs = require('fs');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('../lib/partnerships-funding/coordinator');

const fixture = require('../tests/fixtures/partnerships/openai-for-startups-vc-api-credits.json');
const { loadApprovedOrgProfileFromEnv } = require('../lib/partnerships-funding/profile-loader');

function main() {
  const coord = new PartnershipsFundingCoordinator();
  const loaded = loadApprovedOrgProfileFromEnv();
  const p = loaded.ok ? coord.setOrgProfile(loaded.profile) : { ok: false, skipped_profile: true, reason: loaded.error };
  const d = coord.discoverFromSource(fixture);
  if (!d.ok) {
    console.error(JSON.stringify(d));
    process.exit(1);
  }
  let out = { discover: d, profile: p };
  if (loaded.ok) {
    out.evaluate = coord.evaluateOpportunity(d.opportunity.id);
    out.draft = { ok: false, skipped: 'requires operator source verification before draft' };
  }
  out.snapshot = coord.mobileSnapshot();
  console.log(JSON.stringify(out, null, 2));
}

main();