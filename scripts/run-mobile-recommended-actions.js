#!/usr/bin/env node
'use strict';
/**
 * Run automatable mobile recommended actions (typed ops + objectives) and
 * print a JSON report. Safe for cloud agents — no confirms, no mutations.
 *
 *   node scripts/run-mobile-recommended-actions.js
 *   node scripts/run-mobile-recommended-actions.js --write docs/billing/MOBILE_RECOMMENDED_RUN.json
 */

const fs = require('fs');
const path = require('path');
const { executeTypedAction } = require('../lib/mobile-ops/typed-actions');
const { ExecutionGateway } = require('../lib/execution-fabric/gateway');
const { TaskStore } = require('../lib/execution-fabric/task-store');

const ROOT = path.resolve(__dirname, '..');
const ROLE = 'owner';

const TYPED_ACTIONS = [
  'health.check',
  'git.inspect',
  'billing.migration_status',
  'billing.webhook_config_check',
  'billing.identity_readiness',
  'billing.preflight',
  'billing.operator_checklist',
  'billing.verify_execution',
  'billing.ops_snapshot',
  'billing.verify_revocation',
  'ops.execution_readiness',
  'ops.recovery_preview',
];

const OBJECTIVES = ['ops.host-health-snapshot', 'ops.billing-sandbox-verify', 'ops.mobile-recommended'];

async function runTyped() {
  const results = [];
  for (const action of TYPED_ACTIONS) {
    const started = Date.now();
    try {
      const out = await executeTypedAction({
        action,
        args: {},
        confirm: false,
        role: ROLE,
        ctx: { repoRoot: ROOT },
      });
      results.push({ action, ok: out.ok !== false, ms: Date.now() - started, error: out.error || null });
    } catch (err) {
      results.push({
        action,
        ok: false,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : 'action_threw',
      });
    }
  }
  return results;
}

async function runObjectives() {
  const store = new TaskStore({ now: () => Date.now() });
  const gateway = new ExecutionGateway({ store, skipRecovery: true });
  const results = [];
  for (const objectiveId of OBJECTIVES) {
    const started = Date.now();
    try {
      const out = await gateway.orchestrator.submitObjective({
        objectiveId,
        role: ROLE,
        actor: 'run-mobile-recommended-actions',
        idempotencyKey: `mobile-rec-${objectiveId}`,
      });
      results.push({
        objectiveId,
        ok: out.ok !== false,
        state: out.task?.state,
        ms: Date.now() - started,
        error: out.error || null,
      });
    } catch (err) {
      results.push({
        objectiveId,
        ok: false,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : 'objective_threw',
      });
    }
  }
  return results;
}

async function main() {
  const report = {
    ts: new Date().toISOString(),
    root: ROOT,
    typed: await runTyped(),
    objectives: await runObjectives(),
  };
  report.summary = {
    typed_pass: report.typed.filter((r) => r.ok).length,
    typed_total: report.typed.length,
    objectives_pass: report.objectives.filter((r) => r.ok).length,
    objectives_total: report.objectives.length,
  };
  const outArg = process.argv.indexOf('--write');
  if (outArg >= 0 && process.argv[outArg + 1]) {
    const dest = path.resolve(ROOT, process.argv[outArg + 1]);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  const hardFail = report.typed.some((r) => r.error === 'action_threw' || r.error === 'objective_threw');
  const allOk =
    !hardFail
    && report.summary.typed_pass === report.summary.typed_total
    && report.summary.objectives_pass === report.summary.objectives_total;
  process.exit(allOk ? 0 : hardFail ? 2 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
