#!/usr/bin/env node
'use strict';

/**
 * One-shot resource acquisition pass (fixtures → qualify → rank). No cron, no external submit.
 */

const { ResourceAcquisitionEngine } = require('../lib/partnerships-funding/resource-engine');
const { loadApprovedOrgProfileFromEnv } = require('../lib/partnerships-funding/profile-loader');

function main() {
  const draftLimit = Number(process.env.HYDI_RESOURCE_DRAFT_LIMIT || 0);
  const engine = new ResourceAcquisitionEngine();
  const loaded = loadApprovedOrgProfileFromEnv();
  if (loaded.ok) engine.setOrgProfile(loaded.profile);
  const out = engine.runAcquisitionPass({ draftLimit });
  console.log(JSON.stringify(out, null, 2));
}

main();