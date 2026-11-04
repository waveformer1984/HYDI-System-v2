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

  const store = engine._components.runStore;
  const tag = randomBytes(4).toString('hex');
  const { run } = store.createRun({
    idempotency_key: `demo-${tag}`,
    item_id: plan.backlog?.[0]?.id,
    initiator: 'vertical-slice-demo',
  });
  const runId = run.run_id;
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

  const summary = {
    job,
    run_id: runId,
    poll: `evolution.run_status with run_id=${runId}`,
    evidence_dir: path.join(repoRoot, '.runtime/evolution/evidence'),
  };
  if (job.ok && job.job) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const j = jm.get({ id: job.job.id, role: 'owner', since: 0 });
      if (j.ok && j.job && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(j.job.state)) {
        summary.job_final = j.job;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const finalRun = store.get(runId);
    summary.run_final = finalRun;
    if (finalRun?.evidence_path) summary.evidence_file = finalRun.evidence_path;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
