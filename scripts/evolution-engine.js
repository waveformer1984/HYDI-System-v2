#!/usr/bin/env node
'use strict';

/**
 * CLI for the evolution engine (host / CI / operator).
 *
 *   node scripts/evolution-engine.js status
 *   node scripts/evolution-engine.js audit
 *   node scripts/evolution-engine.js plan
 *   node scripts/evolution-engine.js history
 *   node scripts/evolution-engine.js verify --suite evolution
 */

const path = require('path');
const { createEvolutionEngine } = require('../lib/evolution-engine');

const repoRoot = process.env.HYDI_REPO_ROOT || path.join(__dirname, '..');
const cmd = process.argv[2] || 'status';

async function main() {
  const engine = createEvolutionEngine({ repoRoot });

  if (cmd === 'status') {
    console.log(JSON.stringify(engine.status(), null, 2));
    return;
  }
  if (cmd === 'audit') {
    const report = await engine.runAudit('owner');
    console.log(JSON.stringify({ counts: report.counts, findings: report.findings }, null, 2));
    return;
  }
  if (cmd === 'plan') {
    await engine.runAudit('owner');
    const plan = engine.generatePlan();
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (cmd === 'history') {
    console.log(JSON.stringify(engine.getHistory(50), null, 2));
    return;
  }
  if (cmd === 'verify') {
    const suite = process.argv.includes('--suite') ? process.argv[process.argv.indexOf('--suite') + 1] : 'evolution';
    const { TEST_SUITES } = require('../lib/mobile-ops/action-catalog');
    const files = TEST_SUITES[suite];
    if (!files) {
      console.error('Unknown suite', suite);
      process.exit(1);
    }
    const r = await engine.verify({ testFiles: files });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
