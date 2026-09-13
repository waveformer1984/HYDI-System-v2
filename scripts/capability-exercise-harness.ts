/**
 * Capability exercise harness.
 *
 * The cognitive loop only exercises whichever capabilities its goals happen to
 * select, which left 41 of 45 contracts NOT_EXERCISED — and an unexercised
 * contract is not validated, however well-formed. This drives each one
 * deliberately, through the real executor and the real contract verification.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * A harness that fired `tool.send_email` or `revenue.activate_service` to turn
 * a status green would be worse than the gap it closes: it would create real
 * external effects in order to produce a number, and it would have to
 * self-authorize past the governance model it is supposed to be qualifying.
 *
 * So capabilities are classified by what exercising them actually costs:
 *
 *   SAFE          reads, and writes confined to harness-created rows
 *   PREREQUISITE  a write whose only purpose is to set up a later exercise
 *   OPERATOR      needs an explicit approval token (R3+); off by default
 *   UNSAFE        real external or customer-visible effect; never automated
 *
 * `UNSAFE` entries are reported with the reason, which is the documented
 * justification the enforcement gate asks for — not a silent omission.
 *
 * Run:
 *   npm run capability:exercise
 *   npm run capability:exercise -- --approve "operator:owner"   # include R3
 *   npm run capability:exercise -- --json
 */

import { buildCognitiveCore } from '../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore, ExerciseRecord } from '../lib/heidi/CognitiveCore';
import { ALL_CONTRACTS } from '../lib/heidi/contracts';
import { safetyOf } from '../lib/heidi/contracts/exercise-safety';
import { Pool } from 'pg';

type Safety = 'SAFE' | 'PREREQUISITE' | 'OPERATOR' | 'NEEDS_FIXTURE' | 'UNSAFE';

interface Plan {
  capabilityId: string;
  safety: Safety;
  /** Why it cannot be safely automated. Required for UNSAFE. */
  reason?: string;
  /**
   * Built at run time so later steps can use ids produced by earlier ones.
   * Returns null when a prerequisite is missing — the step is then skipped
   * rather than run with an undefined id, which would produce a verification
   * error that looks like a contract defect but is a harness defect.
   */
  args?: (ctx: HarnessContext) => Record<string, unknown> | null;
  /** Capture ids from the result for later steps. */
  capture?: (result: ExerciseRecord, ctx: HarnessContext, raw: unknown) => void;
}

interface HarnessContext {
  prefix: string;
  goalId?: string;
  taskId?: string;
  prospectId?: string;
  serviceId?: string;
  probeId?: string;
  healthReports?: unknown[];
}

const PREFIX = `exercise_${Date.now()}`;

/**
 * Safety comes from lib/heidi/contracts/exercise-safety.ts, not from a
 * constant here, so the qualification report and the harness cannot disagree
 * about which capabilities are safe to run.
 */
function blockedReason(capabilityId: string): string | null {
  const c = safetyOf(capabilityId);
  if (!c) return null;
  if (c.safety === 'PROHIBITED') return `PROHIBITED: ${c.sideEffect} — ${c.evidence}`;
  if (c.safety === 'SANDBOX_REQUIRED' && c.sandbox === null) {
    return `SANDBOX_REQUIRED, none available: ${c.sideEffect} — ${c.evidence}`;
  }
  return null;
}

function readPlan(capabilityId: string): Plan {
  return { capabilityId, safety: 'SAFE', args: () => ({}) };
}

function buildPlans(): Plan[] {
  const plans: Plan[] = [];

  for (const contract of ALL_CONTRACTS) {
    const id = contract.identity.id;

    const blocked = blockedReason(id);
    if (blocked) {
      plans.push({ capabilityId: id, safety: 'UNSAFE', reason: blocked });
      continue;
    }

    const readOnly = !contract.effects.some((e) => e.verb !== 'read');
    if (readOnly) {
      plans.push(readPlan(id));
      continue;
    }

    // Writes needing constructed arguments are declared explicitly below;
    // anything else is left for a human to add rather than guessed at.
    plans.push({ capabilityId: id, safety: 'OPERATOR' });
  }

  // --- explicit write plans, ordered so each has its prerequisites ---------
  const override = (id: string, patch: Partial<Plan>) => {
    const i = plans.findIndex((p) => p.capabilityId === id);
    if (i >= 0) plans[i] = { ...plans[i], ...patch };
  };

  override('goal.create', {
    safety: 'PREREQUISITE',
    // GoalSystem requires top-level goals be 'mission'; a parentless 'task'
    // is rejected. Caught by the harness on its first run.
    args: (c) => ({
      goalType: 'mission',
      title: `${c.prefix}_harness_goal`,
      priority: 1,
    }),
    capture: (_r, c, raw) => {
      const g = raw as { goalId?: string } | null;
      if (g?.goalId) c.goalId = g.goalId;
    },
  });

  override('goal.advance', {
    safety: 'SAFE',
    args: (c) => (c.goalId ? { targetGoalId: c.goalId, goalId: c.goalId } : null),
  });

  override('goal.complete', {
    safety: 'SAFE',
    args: (c) => (c.goalId ? { targetGoalId: c.goalId, goalId: c.goalId } : null),
  });

  override('tool.create_task', {
    safety: 'PREREQUISITE',
    args: (c) => ({ task_name: `${c.prefix}_harness_task` }),
    capture: (_r, c, raw) => {
      const t = raw as { task_id?: string } | null;
      if (t?.task_id) c.taskId = t.task_id;
    },
  });

  override('tool.cancel_task', {
    safety: 'SAFE',
    args: (c) => (c.taskId ? { task_id: c.taskId } : null),
  });

  override('tool.schedule_event', {
    safety: 'SAFE',
    args: (c) => ({ task_name: `${c.prefix}_harness_event`, scheduled_for: new Date(Date.now() + 3_600_000).toISOString() }),
  });

  override('world.sync', { safety: 'SAFE', args: () => ({}) });

  // --- sandboxed lifecycle writes -----------------------------------------
  // CustomerLifecycle.activateService/startProvisioning are pure UPDATEs on
  // customer_services with no Stripe call, so a synthetic row created and
  // removed by the harness is a complete sandbox with no commercial effect.
  override('revenue.start_onboarding', {
    safety: 'PREREQUISITE',
    args: (c) => ({
      customerId: `${c.prefix}_customer`,
      // A real catalog id — startOnboarding validates against OfferCatalog.
      offerId: 'protoforge_model_prep',
    }),
    capture: (_r, c, raw) => {
      const svc = raw as { serviceId?: string; service_id?: string } | null;
      const id = svc?.serviceId ?? svc?.service_id;
      if (id) c.serviceId = id;
    },
  });

  override('revenue.start_provisioning', {
    safety: 'SAFE',
    args: (c) => (c.serviceId ? { serviceId: c.serviceId } : null),
  });

  override('revenue.activate_service', {
    safety: 'SAFE',
    args: (c) => (c.serviceId ? { serviceId: c.serviceId } : null),
  });

  override('revenue.update_health_status', {
    safety: 'SAFE',
    args: (c) => (c.serviceId ? { serviceId: c.serviceId, healthStatus: 'healthy' } : null),
  });

  override('revenue.verify_service', {
    safety: 'SAFE',
    args: (c) => (c.serviceId ? { serviceId: c.serviceId } : null),
  });

  // LIVE_SAFE (it never sends) but parameterized: it needs a prospect to write
  // about, which must be constructed deliberately rather than guessed.
  // LIVE_SAFE (it never sends) but parameterized: it needs a prospect to write
  // about, which must be constructed deliberately rather than guessed.
  override('commercial.prepare_outreach', { safety: 'NEEDS_FIXTURE' });


  // --- parameterized READS ------------------------------------------------
  // A read still needs its arguments. Running these with `{}` produced
  // verification failures that looked like contract defects but were the
  // harness handing them nothing to read.
  override('tool.fetch_data', { safety: 'SAFE', args: () => ({ table: 'actions', limit: 1 }) });
  override('self_sufficiency.check_all_capabilities', {
    safety: 'SAFE',
    args: () => ({}),
    capture: (_r, c, raw) => {
      const summary = raw as { reports?: Array<{ capabilityId?: string }> } | null;
      const first = summary?.reports?.[0]?.capabilityId;
      if (first) c.probeId = first;
      if (Array.isArray(summary?.reports)) c.healthReports = summary.reports;
    },
  });

  override('self_sufficiency.check_capability', {
    safety: 'SAFE',
    // Derived from check_all_capabilities rather than hard-coded. The manager
    // probes infrastructure ('system.database', 'system.local_model'), and
    // which probes are registered depends on what this environment has
    // configured — so guessing an id produced a null and a verification
    // failure that was the harness's fault, not the contract's.
    args: (c) => (c.probeId ? { capabilityId: c.probeId } : null),
  });

  override('self_sufficiency.resolve_blockers', {
    safety: 'SAFE',
    // The executor takes `reports`, not the whole summary.
    args: (c) => (c.healthReports ? { reports: c.healthReports } : null),
  });

  for (const id of [
    'revenue.score_prospect',
    'revenue.verify_service',
    'commercial.create_authorization_package',
  ]) {
    override(id, { safety: 'NEEDS_FIXTURE' });
  }

  return plans;
}

/** Order matters: prerequisites first, then the capabilities that consume them. */
const ORDER = [
  'goal.create',
  'goal.advance',
  'goal.complete',
  'tool.create_task',
  'tool.cancel_task',
  'tool.schedule_event',
  'world.sync',
  'tool.fetch_data',
  'self_sufficiency.check_all_capabilities',
  'self_sufficiency.check_capability',
  'self_sufficiency.resolve_blockers',
  'revenue.start_onboarding',
  'revenue.start_provisioning',
  'revenue.activate_service',
  'revenue.update_health_status',
  'revenue.verify_service',
];

async function main(): Promise<void> {
  const approveArg = process.argv.indexOf('--approve');
  const approval = approveArg >= 0 ? process.argv[approveArg + 1] : null;
  const asJson = process.argv.indexOf('--json') !== -1;

  const ctx: HarnessContext = { prefix: PREFIX };
  const plans = buildPlans();
  plans.sort((a, b) => {
    const ai = ORDER.indexOf(a.capabilityId);
    const bi = ORDER.indexOf(b.capabilityId);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a.capabilityId.localeCompare(b.capabilityId);
  });

  const core: CognitiveCore = await buildCognitiveCore();
  const records: Array<ExerciseRecord & { safety: Safety; reason?: string }> = [];

  for (const plan of plans) {
    if (plan.safety === 'UNSAFE') {
      records.push({
        capabilityId: plan.capabilityId,
        startedAt: new Date().toISOString(),
        contractRegistered: true,
        tier: null,
        requiresApproval: true,
        approvedBy: null,
        executed: false,
        executionOutcome: null,
        executionError: null,
        verificationOutcome: null,
        verificationEvidence: null,
        observationSource: null,
        skipped: `UNSAFE: ${plan.reason}`,
        safety: plan.safety,
        reason: plan.reason,
      });
      continue;
    }

    if (plan.safety === 'NEEDS_FIXTURE' || !plan.args) {
      records.push({
        capabilityId: plan.capabilityId,
        startedAt: new Date().toISOString(),
        contractRegistered: true,
        tier: null,
        requiresApproval: true,
        approvedBy: null,
        executed: false,
        executionOutcome: null,
        executionError: null,
        verificationOutcome: null,
        verificationEvidence: null,
        observationSource: null,
        skipped:
          plan.safety === 'NEEDS_FIXTURE'
            ? 'needs a fixture: this capability takes arguments (a prospect, a service, a health summary) that must be constructed deliberately, not guessed'
            : 'no argument fixture defined — inputs must be chosen by a human',
        safety: plan.safety,
      });
      continue;
    }

    const args = plan.args(ctx);
    if (args === null) {
      records.push({
        capabilityId: plan.capabilityId,
        startedAt: new Date().toISOString(),
        contractRegistered: true,
        tier: null,
        requiresApproval: false,
        approvedBy: null,
        executed: false,
        executionOutcome: null,
        executionError: null,
        verificationOutcome: null,
        verificationEvidence: null,
        observationSource: null,
        // Cascade skip. Running this anyway would report an observation error
        // that reads as a contract defect but is really "its prerequisite was
        // refused".
        skipped: 'prerequisite not available — an earlier step did not run',
        safety: plan.safety,
      });
      continue;
    }

    const record = await core.exerciseCapability(plan.capabilityId, args, {
      operatorApproval: approval ?? undefined,
    });

    // Chain from the executor's own result. Re-running the capability to
    // recover an id would double its side effect.
    if (plan.capture && record.executed) {
      plan.capture(record, ctx, record.rawResult ?? null);
    }

    records.push({ ...record, safety: plan.safety });
  }

  await persist(records);
  await cleanup(ctx.prefix);
  await core.close().catch(() => undefined);

  if (asJson) {
    process.stdout.write(JSON.stringify({ prefix: PREFIX, records }, null, 2) + '\n');
    process.exit(0);
  }

  report(records, approval);
  process.exit(0);
}

function harnessPool(): Pool {
  return new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    max: 2,
  });
}

/**
 * Record each exercise as evidence, so the qualification matrix has one source
 * of truth. Without this the matrix would keep reporting these capabilities as
 * NOT_EXERCISED while this report called them verified — two owned reports
 * disagreeing, which is the reporting equivalent of a false green.
 */
async function persist(
  records: Array<ExerciseRecord & { safety: Safety; reason?: string }>,
): Promise<void> {
  const pool = harnessPool();
  try {
    for (const r of records) {
      await pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ($1, $2, now())`,
        [
          'capability_exercise',
          JSON.stringify({
            capabilityId: r.capabilityId,
            safety: r.safety,
            tier: r.tier,
            executed: r.executed,
            verificationOutcome: r.verificationOutcome,
            verificationEvidence: r.verificationEvidence,
            observationSource: r.observationSource,
            skipped: r.skipped,
            approvedBy: r.approvedBy,
          }),
        ],
      );
    }
  } catch {
    // Evidence persistence failing must not be mistaken for exercise failure.
    process.stderr.write('[harness] could not persist exercise evidence' + String.fromCharCode(10));
  } finally {
    await pool.end();
  }
}

/** Everything the harness created is prefixed, so cleanup is exact. */
async function cleanup(prefix: string): Promise<void> {
  const pool = harnessPool();
  try {
    await pool.query(`DELETE FROM actions WHERE task_name LIKE $1`, [`${prefix}%`]);
    await pool.query(`DELETE FROM heidi_goals WHERE title LIKE $1`, [`${prefix}%`]);
    // Synthetic customer rows created for the lifecycle sandbox.
    await pool.query(`DELETE FROM customer_job_events WHERE customer_id LIKE $1`, [`${prefix}%`]).catch(() => undefined);
    await pool.query(`DELETE FROM customer_services WHERE customer_id LIKE $1`, [`${prefix}%`]);
  } catch {
    // Cleanup failure must not mask the qualification result.
  } finally {
    await pool.end();
  }
}

function shortReason(skipped: string): string {
  if (skipped.startsWith('UNSAFE')) return 'UNSAFE — not automated';
  if (skipped.startsWith('needs a fixture')) return 'needs fixture';
  if (skipped.startsWith('no argument fixture')) return 'needs fixture';
  if (skipped.startsWith('prerequisite')) return 'prerequisite unavailable';
  if (skipped.includes('no wired executor')) return 'NO EXECUTOR (bridge unavailable)';
  if (skipped.includes('requires approval')) return 'refused — needs approval';
  if (skipped.includes('no contract')) return 'no contract';
  return skipped.slice(0, 40);
}

function report(
  records: Array<ExerciseRecord & { safety: Safety; reason?: string }>,
  approval: string | null,
): void {
  const line = (s = '') => process.stdout.write(s + '\n');

  line('HYDI capability exercise harness');
  line('='.repeat(104));
  line(`contracts: ${records.length}    operator approval: ${approval ?? 'none (R3+ refused)'}`);
  line();
  line(
    'capability'.padEnd(42) +
      'safety'.padEnd(14) +
      'tier'.padEnd(6) +
      'exec'.padEnd(6) +
      'outcome / why not',
  );
  line('-'.repeat(120));

  for (const r of records) {
    // Always show the REASON, never a bare "skipped". A report that hides why
    // something did not run is the same class of problem as a contract that
    // hides why something was not verified.
    const outcome =
      r.verificationOutcome ??
      (r.skipped ? shortReason(r.skipped) : r.executionError ? `exec error: ${r.executionError}` : '—');
    line(
      r.capabilityId.padEnd(42) +
        r.safety.padEnd(14) +
        (r.tier ?? '—').padEnd(6) +
        (r.executed ? 'yes' : 'no').padEnd(6) +
        outcome,
    );
  }

  const verified = records.filter((r) => r.verificationOutcome === 'verified');
  const failedV = records.filter((r) => r.verificationOutcome === 'failed');
  const errored = records.filter((r) => r.verificationOutcome === 'error');
  const unverifiable = records.filter((r) => r.verificationOutcome === 'unverifiable');
  const unsafe = records.filter((r) => r.safety === 'UNSAFE');
  const noFixture = records.filter(
    (r) => r.skipped?.startsWith('no argument fixture') || r.skipped?.startsWith('needs a fixture'),
  );
  const cascaded = records.filter((r) => r.skipped?.startsWith('prerequisite not available'));
  const noExecutor = records.filter((r) => r.skipped?.includes('no wired executor'));
  const execFailed = records.filter((r) => !r.skipped && !r.executed && r.executionOutcome !== null);
  const refused = records.filter((r) => r.skipped?.includes('requires approval'));

  line();
  line('— outcome —');
  line(`  verified                       ${verified.length}`);
  line(`  verification failed            ${failedV.length}`);
  line(`    ...of which sandbox-limited  ${[...failedV, ...errored].filter((r) => safetyOf(r.capabilityId)?.sandboxLimitation).length}`);
  line(`  verification error             ${errored.length}`);
  line(`  unverifiable                   ${unverifiable.length}`);
  line(`  refused (needs approval)       ${refused.length}`);
  line(`  needs a fixture                ${noFixture.length}`);
  line(`  skipped, prerequisite refused  ${cascaded.length}`);
  line(`  UNSAFE to automate             ${unsafe.length}`);
  line(`  no wired executor              ${noExecutor.length}`);
  line(`  executor declined              ${execFailed.length}`);

  // A verification failure is only a CONTRACT failure once execution, fixture
  // validity and sandbox fidelity have each been ruled out. Filing a correct
  // refusal as a bug would make the qualification apparatus its own source of
  // false positives.
  const sandboxLimited = [...failedV, ...errored].filter(
    (r) => safetyOf(r.capabilityId)?.sandboxLimitation,
  );
  const genuineFailures = [...failedV, ...errored].filter(
    (r) => !safetyOf(r.capabilityId)?.sandboxLimitation,
  );

  if (genuineFailures.length > 0) {
    line();
    line('— verification failures (execution succeeded, fixture valid) —');
    for (const r of genuineFailures) {
      line(`  ${r.capabilityId}: ${r.verificationEvidence ?? 'no evidence'}`);
    }
  }

  if (sandboxLimited.length > 0) {
    line();
    line('— sandbox-limited (correct refusal, not a defect) —');
    for (const r of sandboxLimited) {
      line(`  ${r.capabilityId}: ${r.verificationEvidence ?? ''}`);
      line(`      ${safetyOf(r.capabilityId)?.sandboxLimitation}`);
    }
  }

  if (noExecutor.length > 0) {
    line();
    line('— no wired executor (bridge dependency unavailable in this environment) —');
    for (const r of noExecutor) line(`  ${r.capabilityId}`);
  }

  if (execFailed.length > 0) {
    line();
    line('— executor declined —');
    for (const r of execFailed) {
      line(`  ${r.capabilityId}: ${r.executionError ?? r.executionOutcome}`);
    }
  }

  line();
  line('— not exercised, with reasons —');
  for (const r of unsafe) line(`  ${r.capabilityId}: ${r.reason}`);
  if (noFixture.length > 0) {
    line();
    for (const r of noFixture) line(`  ${r.capabilityId}: ${r.skipped}`);
  }

  line();
  line('An UNSAFE entry is a documented reason, not a pass. It satisfies the');
  line('enforcement gate only as an explicit justification for non-exercise.');
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
