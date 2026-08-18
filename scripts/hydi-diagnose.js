#!/usr/bin/env node
'use strict';
/**
 * HYDI Self-Diagnostic Command — `npm run hydi:diagnose`
 *
 * Produces a complete operational snapshot. Output is human-readable
 * by default, or machine-readable JSON with --json.
 *
 * Phase 4: --operator mode produces the operator view (governed autonomy summary).
 *
 * Usage:
 *   node scripts/hydi-diagnose.js              # human-readable diagnostic
 *   node scripts/hydi-diagnose.js --json       # JSON output
 *   node scripts/hydi-diagnose.js --operator   # Phase 4: operator view
 *   npm run hydi:diagnose
 */

const path = require('path');

// Install the TypeScript runtime loader BEFORE requiring any .ts module.
// Must be the first require so the register hook is in place.
require('./babel-register');

async function main() {
  const jsonOutput = process.argv.includes('--json');
  const operatorMode = process.argv.includes('--operator');
  const { OperationalIntelligence } = require('../lib/operational/OperationalIntelligence');

  const oi = new OperationalIntelligence(path.resolve(__dirname, '..'));

  try {
    if (operatorMode) {
      // Phase 4: Run health checks first, then produce operator view
      await oi.checkHealth();
      const output = oi.produceOperatorView();
      console.log(output);
    } else {
      const output = await oi.diagnose(jsonOutput);
      console.log(output);
    }

    // Exit code: 0 if healthy, 1 if not
    const overallState = oi.stateModel.getOverallState();
    await oi.destroy();
    process.exit(overallState === 'HEALTHY' ? 0 : 1);
  } catch (e) {
    console.error(`hydi:diagnose failed: ${e.message}`);
    await oi.destroy();
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
