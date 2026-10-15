#!/usr/bin/env node
'use strict';

/**
 * Billing sandbox verification workflow (test mode only).
 * Produces a durable task file under .hydi/billing-verify/ for pause/resume.
 * Never prints secret values.
 *
 *   node scripts/billing-sandbox-workflow.js start
 *   node scripts/billing-sandbox-workflow.js run-automated [--task-id <id>]
 *   node scripts/billing-sandbox-workflow.js report [--task-id <id>]
 *   node scripts/billing-sandbox-workflow.js snapshot --tenant-id <uuid> [--task-id <id>]
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const {
  createTask,
  loadTask,
  saveTask,
  runAutomatedSteps,
  snapshotTenantState,
  finalReport,
  defaultStoreRoot,
} = require('../lib/billing/sandbox-workflow');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const cmd = process.argv[2] || 'start';
  const root = defaultStoreRoot();
  let taskId = arg('task-id');

  if (cmd === 'start') {
    const task = createTask(root);
    console.log(JSON.stringify({ ok: true, task_id: task.id, path: `.hydi/billing-verify/${task.id}.json` }, null, 2));
    return;
  }

  if (!taskId) {
    console.error('missing --task-id (or run start first)');
    process.exit(1);
  }
  const task = loadTask(root, taskId);
  if (!task) {
    console.error('task not found');
    process.exit(1);
  }

  if (cmd === 'run-automated') {
    await runAutomatedSteps(task, root, { catalogCheck: true, runTier2Hint: true });
    console.log(JSON.stringify(finalReport(task), null, 2));
    return;
  }

  if (cmd === 'snapshot') {
    const tenantId = arg('tenant-id');
    const snap = await snapshotTenantState(tenantId);
    if (snap.ok) {
      task.steps.push({
        id: 'db_snapshot',
        title: 'Operator DB snapshot',
        kind: 'automated',
        status: 'PASS',
        evidence: snap,
        updated_at: new Date().toISOString(),
      });
      saveTask(root, task);
    }
    console.log(JSON.stringify(snap, null, 2));
    if (!snap.ok) process.exit(1);
    return;
  }

  if (cmd === 'report') {
    console.log(JSON.stringify({ task, report: finalReport(task) }, null, 2));
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'workflow failed');
  process.exit(1);
});
