#!/usr/bin/env node
'use strict';

const SecurityAuditor = require('../src/hydi-v3/SecurityAuditor');

async function main() {
  const auditor = new SecurityAuditor({
    scanPaths: [
      require('path').join(__dirname, '..', 'src', 'hydi-v3'),
      require('path').join(__dirname, '..', 'src', 'HYDISystem.js'),
    ],
  });

  const report = await auditor.runAudit();
  console.log(JSON.stringify(report, null, 2));

  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
