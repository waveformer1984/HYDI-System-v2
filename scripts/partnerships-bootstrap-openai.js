#!/usr/bin/env node
'use strict';

/**
 * Load OpenAI startups milestone into HYDI_PARTNERSHIPS_DIR (fixture; no web scrape).
 */

const fs = require('fs');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('../lib/partnerships-funding/coordinator');

const fixture = require('../tests/fixtures/partnerships/openai-for-startups-vc-api-credits.json');
const profilePath = path.join(__dirname, '../docs/partnerships/organization-profile.template.json');

function main() {
  const coord = new PartnershipsFundingCoordinator();
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const p = profile.approved_by_owner ? coord.setOrgProfile(profile) : { ok: false, skipped_profile: true };
  const d = coord.discoverFromSource(fixture);
  if (!d.ok) {
    console.error(JSON.stringify(d));
    process.exit(1);
  }
  let out = { discover: d, profile: p };
  if (profile.approved_by_owner) {
    out.evaluate = coord.evaluateOpportunity(d.opportunity.id);
    out.draft = coord.prepareDraft(d.opportunity.id);
  }
  out.snapshot = coord.mobileSnapshot();
  console.log(JSON.stringify(out, null, 2));
}

main();