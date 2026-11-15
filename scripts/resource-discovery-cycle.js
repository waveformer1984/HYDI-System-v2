#!/usr/bin/env node
'use strict';

/**
 * On-demand discovery cycle — NOT a PM2 daemon.
 * Modes: daily | weekly | monthly (controls fixture inclusion + reporting label only).
 *
 * Live HTTP reachability: HYDI_ALLOW_LIVE_DISCOVERY=1 HYDI_LIVE_DISCOVERY_MAX_URLS=8
 */

const { HydiResourceAcquisitionSystem } = require('../lib/resource-acquisition/system');
const { loadApprovedOrgProfileFromEnv } = require('../lib/partnerships-funding/profile-loader');

async function main() {
  const mode = process.argv[2] || process.env.HYDI_RESOURCE_CYCLE_MODE || 'weekly';
  const system = new HydiResourceAcquisitionSystem({ allowTestHarness: false });
  const loaded = loadApprovedOrgProfileFromEnv();
  const profile = loaded.ok ? loaded.profile : null;
  const out = await system.runCycle({
    mode,
    profile,
    liveReachability: process.env.HYDI_ALLOW_LIVE_DISCOVERY === '1',
  });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});