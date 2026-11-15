#!/usr/bin/env node
'use strict';

/**
 * Print evaluation harness results for comparing router/identity changes before promotion.
 * Does not call live models unless extended in a follow-up integration job.
 */

const { runHarnessSelfTest, resourceSnapshot, layerEnabled } = require('../lib/heidi-intelligence');

function main() {
  const report = runHarnessSelfTest();
  const payload = {
    layerEnabled: layerEnabled(),
    resources: resourceSnapshot(),
    evaluation: report,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();