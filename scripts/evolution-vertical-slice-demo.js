#!/usr/bin/env node
'use strict';

/**
 * Operator demo on Frank/heidi-pc (read-only audit + plan; execute needs env gates).
 *
 *   EVOLUTION_ALLOW_EXECUTE=true node scripts/evolution-vertical-slice-demo.js
 *   EVOLUTION_ALLOW_EXECUTE=true EVOLUTION_ALLOW_GIT=true EVOLUTION_ALLOW_PR=true node scripts/evolution-vertical-slice-demo.js --git --approve-pr
 */

const path = require('path');
const { createEvolutionEngine } = require('../lib/evolution-engine');
const { createMemoryAuditRunner } = require('../lib/evolution-engine/memory-audit-runner');
const { getJobManager } = require('../lib/mobile-ops/job-manager');
const { randomBytes } = require('crypto');

const repoRoot = process.env.HYDI_REPO_ROOT || path.join(__dirname, '..');

async function main() {
  const engine = createEvolutionEngine({
    repoRoot,
    memoryDir: path.join(repoRoot, '.runtime', 'evolution'),
    runMemoryAudit: createMemoryAuditRunner({ repoRoot }),
  });

  const arch = engine.runArchitectureAudit();
  console.log('Architecture audit base_sha:', arch.base_sha);

  const audit = await engine.runAudit('owner');
  console.log('Findings:', audit.counts);

  const plan = engine.generatePlan();
  console.log('Top backlog item:', plan.backlog?.[0]?.title);

  const runId = randomBytes(4).toString('hex');
  const jm = getJobManager();
  const job = jm.start({
    kind: 'evolution.improvement',
    args: {
      run_id: runId,
      item_id: plan.backlog?.[0]?.id,
      idempotency_key: `demo-${runId}`,
      use_git: process.argv.includes('--git'),
      approve_pr: process.argv.includes('--approve-pr'),
    },
    confirm: true,
    role: 'owner',
    actor: 'vertical-slice-demo',
  });

  console.log(JSON.stringify({ job, poll: `evolution.run_status run_id=${runId}`, evidence_dir: '.runtime/evolution/evidence' }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
