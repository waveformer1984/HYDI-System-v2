#!/usr/bin/env node
'use strict';
/**
 * HYDI Self-Recovery Command — `npm run hydi:recover`
 *
 * Phase 3: bounded recovery with verification.
 * Phase 4: governed recovery with policy, authorization, decision records.
 *
 * Usage:
 *   node scripts/hydi-recover.js                              # auto-recover all unhealthy
 *   node scripts/hydi-recover.js --component=protoforge-core  # recover specific
 *   node scripts/hydi-recover.js --dry-run                    # Phase 4: policy evaluation only, no execution
 *   node scripts/hydi-recover.js --governed                   # Phase 4: governed recovery (policy + decision records)
 *   node scripts/hydi-recover.js --governed --component=protoforge-core
 *   node scripts/hydi-recover.js --json                       # JSON output
 *   npm run hydi:recover
 *
 * NEVER simply restarts the entire stack. Recovery is causal and bounded.
 * Phase 4: recovery is governed by policy — Heidi knows when it is allowed to recover.
 */

const path = require('path');

// Install the TypeScript runtime loader BEFORE requiring any .ts module.
// Must be the first require so the register hook is in place.
require('./babel-register');

async function main() {
  const jsonOutput = process.argv.includes('--json');
  const dryRun = process.argv.includes('--dry-run');
  const governed = process.argv.includes('--governed');
  const componentArg = process.argv.find((a) => a.startsWith('--component='));
  const targetComponent = componentArg ? componentArg.split('=')[1] : null;

  const { OperationalIntelligence } = require('../lib/operational/OperationalIntelligence');

  const oi = new OperationalIntelligence(path.resolve(__dirname, '..'));

  try {
    // Phase 4: Dry-run mode — evaluate policy without executing
    if (dryRun) {
      const output = await oi.dryRun(targetComponent ?? undefined);
      console.log(output);
      const overallState = oi.stateModel.getOverallState();
      await oi.destroy();
      process.exit(overallState === 'HEALTHY' ? 0 : 1);
    }

    // Phase 4: Governed recovery — uses policy model, action selector, decision records
    if (governed) {
      if (targetComponent) {
        const result = await oi.governedRecover(targetComponent, `governed recovery request for ${targetComponent}`);
        if (jsonOutput) {
          console.log(JSON.stringify({ component: targetComponent, result, governed: true }, null, 2));
        } else {
          console.log(result);
        }
      } else {
        // Governed auto-recover: run health checks, then governed recover each unhealthy
        await oi.healthChecker.checkAll();
        const unhealthy = oi.stateModel
          .getAllStates()
          .filter((h) => h.state === 'UNAVAILABLE' || h.state === 'FAILED' || h.state === 'BLOCKED')
          .sort((a, b) => {
            const aNode = oi.graph.nodes.get(a.component);
            const bNode = oi.graph.nodes.get(b.component);
            return (aNode?.recoveryOrder ?? 999) - (bNode?.recoveryOrder ?? 999);
          });

        if (unhealthy.length === 0) {
          console.log('All components healthy — no governed recovery needed.');
        } else {
          console.log(`GOVERNED AUTO-RECOVERY — ${unhealthy.length} unhealthy component(s):`);
          for (const comp of unhealthy) {
            console.log(`\nRecovering ${comp.component} (state: ${comp.state})...`);
            const result = await oi.governedRecover(comp.component, `governed auto-recovery: state was ${comp.state}`);
            console.log(result);
          }
        }
      }

      const finalState = oi.stateModel.getOverallState();
      await oi.destroy();
      process.exit(finalState === 'HEALTHY' ? 0 : 1);
    }

    // Phase 3: Standard recovery (backward compatible)
    if (targetComponent) {
      const result = await oi.recover(targetComponent, `manual recovery request for ${targetComponent}`);
      if (jsonOutput) {
        console.log(JSON.stringify({ component: targetComponent, result }, null, 2));
      } else {
        console.log(result);
      }
    } else {
      const result = await oi.autoRecover();
      if (jsonOutput) {
        const overallState = oi.stateModel.getOverallState();
        console.log(JSON.stringify({
          overallState,
          components: oi.stateModel.getAllStates(),
          activeIncidents: oi.correlator.getActiveIncidents(),
        }, null, 2));
      } else {
        console.log(result);
      }
    }

    const finalState = oi.stateModel.getOverallState();
    await oi.destroy();
    process.exit(finalState === 'HEALTHY' ? 0 : 1);
  } catch (e) {
    console.error(`hydi:recover failed: ${e.message}`);
    await oi.destroy();
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
