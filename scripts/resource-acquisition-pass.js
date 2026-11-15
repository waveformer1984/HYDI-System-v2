#!/usr/bin/env node
'use strict';

/**
 * One-shot resource acquisition pass (fixtures → qualify → rank). No cron, no external submit.
 */

const fs = require('fs');
const path = require('path');
const { ResourceAcquisitionEngine } = require('../lib/partnerships-funding/resource-engine');

const profilePath = path.join(__dirname, '../docs/partnerships/organization-profile.template.json');

function main() {
  const draftLimit = Number(process.env.HYDI_RESOURCE_DRAFT_LIMIT || 0);
  const engine = new ResourceAcquisitionEngine();
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (profile.approved_by_owner) engine.setOrgProfile(profile);
  } catch {
    /* profile optional for discover+rank only */
  }
  const out = engine.runAcquisitionPass({ draftLimit });
  console.log(JSON.stringify(out, null, 2));
}

main();