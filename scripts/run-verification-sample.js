#!/usr/bin/env node
'use strict';

if (process.env.HYDI_VERIFY_DEBUG === '1') {
  // eslint-disable-next-line no-console
  console.error('[run-verification-sample] argv', process.argv.slice(2), 'env_limit', process.env.HYDI_VERIFY_LIMIT);
}

const fs = require('fs');
const path = require('path');
const { HydiResourceAcquisitionSystem } = require('../lib/resource-acquisition/system');
const { runVerificationPass } = require('../lib/resource-acquisition/verify/run-pass');

async function main() {
  const limit = Number(process.env.HYDI_VERIFY_LIMIT || process.argv[2] || 16);
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`invalid_verify_limit:${process.env.HYDI_VERIFY_LIMIT || process.argv[2]}`);
  const outPath = process.env.HYDI_VERIFY_OUT || path.join(process.cwd(), '.runtime', 'resource-discovery', 'last-verification-sample.json');
  const system = new HydiResourceAcquisitionSystem({ allowTestHarness: false });
  await system.runCycle({ mode: 'weekly' });
  if (process.env.HYDI_VERIFY_DEBUG === '1') {
    const n = system.runner.engine.coordinator.store.load().opportunities.length;
    // eslint-disable-next-line no-console
    console.error('[run-verification-sample] opps', n);
  }
  const summary = await runVerificationPass(system.runner.engine.coordinator, { limit });
  if (process.env.HYDI_VERIFY_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console.error('[run-verification-sample] checked', summary.checked);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ outPath, counts: summary.counts, by_classification: summary.by_classification, checked: summary.checked }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });