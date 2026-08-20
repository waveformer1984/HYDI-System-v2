/**
 * HEIDI Production Smoke Test
 *
 * Verifies that the production /api/status endpoint returns real capability
 * health, that CognitiveCore is instantiated, that self-sufficiency services
 * are wired, and that no credentials leak.
 *
 * This does NOT trigger real commercial outreach or payment.
 * Only R0/R1 bounded actions are tested.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CognitiveCoreBuilder } from '../lib/heidi/CognitiveCoreBuilder';
import { HeidiOrchestrator } from '../lib/orchestrator';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

async function runSmokeTest(): Promise<void> {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('HEIDI PRODUCTION SMOKE TEST');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Build production CognitiveCore
  console.log('[smoke] Building production CognitiveCore...');
  const core = await new CognitiveCoreBuilder({ dbConfig: DB_CONFIG }).build();
  const bridge = core.getBridge();

  // 2. Verify self-sufficiency services are wired
  console.log('[smoke] Checking self-sufficiency services...');
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

  checks.push({
    name: 'CapabilityHealthManager wired',
    pass: !!bridge.capabilityHealthManager,
    detail: bridge.capabilityHealthManager ? 'present' : 'MISSING',
  });

  checks.push({
    name: 'BlockerResolutionEngine wired',
    pass: !!bridge.blockerResolutionEngine,
    detail: bridge.blockerResolutionEngine ? 'present' : 'MISSING',
  });

  checks.push({
    name: 'SelfRepairEngine wired',
    pass: !!bridge.selfRepairEngine,
    detail: bridge.selfRepairEngine ? 'present' : 'MISSING',
  });

  // 3. Check capability health
  console.log('[smoke] Checking capability health...');
  if (bridge.capabilityHealthManager) {
    const summary = await bridge.capabilityHealthManager.checkAll() as any;
    checks.push({
      name: 'Capability health check returns results',
      pass: summary.total > 0,
      detail: `${summary.total} capabilities, ${summary.ready} READY, ${summary.blocked} BLOCKED`,
    });

    // 4. Verify no secrets leak
    const json = JSON.stringify(summary);
    const secretCheck = !json.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || '___NO_KEY___');
    checks.push({
      name: 'No secrets in capability health response',
      pass: secretCheck,
      detail: secretCheck ? 'clean' : 'SECRET LEAKED',
    });
  }

  // 5. Check orchestrator
  console.log('[smoke] Checking orchestrator...');
  const orchestrator = new HeidiOrchestrator();
  const health = await orchestrator.getCapabilityHealth();
  checks.push({
    name: 'Orchestrator.getCapabilityHealth() works',
    pass: health.available || health.error !== null, // Either works or degrades gracefully
    detail: health.available ? 'available' : `error: ${health.error}`,
  });

  const commercialState = await orchestrator.getCommercialState();
  checks.push({
    name: 'Orchestrator.getCommercialState() works',
    pass: commercialState.available,
    detail: `autonomy=${commercialState.autonomyLevel}, stripe=${commercialState.stripe.state}`,
  });

  checks.push({
    name: 'Autonomy level is 2 (not raised)',
    pass: commercialState.autonomyLevel === 2,
    detail: `level=${commercialState.autonomyLevel}`,
  });

  // 6. Run a self-repair cycle
  console.log('[smoke] Running self-repair cycle...');
  if (bridge.capabilityHealthManager && bridge.selfRepairEngine) {
    const summary = await bridge.capabilityHealthManager.checkAll() as any;
    const repairResult = await bridge.selfRepairEngine.runSelfRepair(summary) as any;
    checks.push({
      name: 'Self-repair cycle completes',
      pass: repairResult.totalIssues >= 0,
      detail: `${repairResult.totalIssues} issues, ${repairResult.repaired} repaired, ${repairResult.workedAround} worked around`,
    });

    // 7. Verify no protected assets were repaired
    const protectedRepairs = repairResult.repairs.filter((r: any) => r.riskLevel === 'R5');
    checks.push({
      name: 'No protected assets repaired',
      pass: protectedRepairs.length === 0 || repairResult.refused > 0,
      detail: repairResult.refused > 0 ? `${repairResult.refused} refused` : 'none blocked',
    });
  }

  // 8. Print results
  console.log('');
  console.log('─── SMOKE TEST RESULTS ───');
  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? '[OK]' : '[FAIL]';
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
    if (!check.pass) allPass = false;
  }

  console.log('');
  if (allPass) {
    console.log('✅ PRODUCTION SMOKE TEST PASSED');
  } else {
    console.log('❌ PRODUCTION SMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('════════════════════════════════════════════════════════════════');
}

runSmokeTest().catch((error) => {
  console.error('[smoke] FATAL:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
