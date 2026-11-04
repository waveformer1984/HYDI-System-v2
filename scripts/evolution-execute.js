#!/usr/bin/env node
'use strict';

/**
 * Long-running evolution execute step (mobile job runner).
 *
 *   node scripts/evolution-execute.js --run-id <id> --item-id <id> --idempotency-key <key> [--git] [--approve-pr]
 */

const path = require('path');
const { createEvolutionEngine } = require('../lib/evolution-engine');
const { createMemoryAuditRunner } = require('../lib/evolution-engine/memory-audit-runner');
const { TEST_SUITES } = require('../lib/mobile-ops/action-catalog');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const repoRoot = process.env.HYDI_REPO_ROOT || path.join(__dirname, '..');
  const runId = arg('--run-id');
  const itemId = arg('--item-id');
  const idempotencyKey = arg('--idempotency-key') || runId;
  const useGit = process.argv.includes('--git');
  const approvePr = process.argv.includes('--approve-pr');

  if (!runId) {
    console.error('--run-id required');
    process.exit(1);
  }

  const engine = createEvolutionEngine({
    repoRoot,
    memoryDir: path.join(repoRoot, '.runtime', 'evolution'),
    runMemoryAudit: createMemoryAuditRunner({ repoRoot }),
  });

  engine.runArchitectureAudit();
  await engine.runAudit('owner');
  engine.generatePlan();

  const result = await engine.executeImprovement(itemId, {
    approved: true,
    run_id: runId,
    idempotency_key: idempotencyKey,
    operatorId: 'evolution-job',
    workerId: `job-${process.pid}`,
    testFiles: TEST_SUITES.evolution,
    simulatePatch: process.env.EVOLUTION_ALLOW_EXECUTE !== 'true',
    useGit,
    approve_pr: approvePr,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
