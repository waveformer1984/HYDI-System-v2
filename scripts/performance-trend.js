#!/usr/bin/env node
'use strict';

const PerformanceBenchmark = require('../src/hydi-v3/PerformanceBenchmark');

async function main() {
  const benchmark = new PerformanceBenchmark();
  const report = await benchmark.generateReport('markdown');
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
