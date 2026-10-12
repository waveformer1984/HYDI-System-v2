#!/usr/bin/env node
/**
 * Read-only health sweep for Termux/cron — probes local HYDI endpoints and
 * exits non-zero when any probe fails. Does not restart services.
 *
 *   node scripts/mobile-health-loop.js
 *   node scripts/mobile-health-loop.js --json
 */
'use strict';

const { runHealthCheck } = require('../lib/mobile-ops/action-runners');

async function main() {
  const json = process.argv.includes('--json');
  const report = await runHealthCheck();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const p of report.probes) {
      console.log(`${p.ok ? 'OK' : 'FAIL'} ${p.name} (${p.ms}ms) ${p.hint}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
