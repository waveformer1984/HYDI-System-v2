#!/usr/bin/env node
'use strict';

/**
 * Owner-invoked bounded self-improvement — never scheduled.
 *
 *   node scripts/heidi-self-improve.js assess
 *   node scripts/heidi-self-improve.js run --owner-requested
 */

const path = require('path');
const {
  assessImprovementOpportunities,
  runBoundedSelfImprovement,
} = require('../lib/heidi/bounded-self-improvement-loop');

const cmd = process.argv[2] || 'assess';

async function main() {
  const root = process.cwd();
  const ownerRequested = process.argv.includes('--owner-requested');
  const forceNew = process.argv.includes('--force-new');
  const demoFailedProbes = process.argv.includes('--demo-failed-probes');
  const gapId = process.argv.find((a) => a.startsWith('--gap='))?.slice(6);

  const fetchImpl = demoFailedProbes
    ? async () => ({ ok: false, status: 0 })
    : undefined;

  const simulated = process.argv.includes('--simulated') || demoFailedProbes;

  if (cmd === 'dashboard') {
    const { buildImprovementDashboard } = require('../lib/heidi/self-improvement/dashboard');
    const { frankLiveTruthEligible } = require('../lib/heidi/self-improvement/frank-context');
    const dash = await buildImprovementDashboard({
      root,
      fetchImpl,
      frankReachable: frankLiveTruthEligible(root),
      localCiIncidentOpen: process.argv.includes('--local-ci-open'),
    });
    console.log(JSON.stringify(dash, null, 2));
    return;
  }

  if (cmd === 'assess') {
    const report = await assessImprovementOpportunities({
      root,
      fetchImpl,
      localCiIncidentOpen: process.argv.includes('--local-ci-open'),
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (cmd === 'run') {
    const result = await runBoundedSelfImprovement({
      root,
      ownerRequested,
      forceNew,
      gapId,
      fetchImpl,
      simulated,
      localCiIncidentOpen: process.argv.includes('--local-ci-open'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.error('Usage: heidi-self-improve.js assess|run|dashboard [--owner-requested] [--demo-failed-probes] [--simulated]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});