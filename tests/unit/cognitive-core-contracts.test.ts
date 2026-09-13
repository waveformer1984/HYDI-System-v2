/**
 * CognitiveCore contract migration.
 *
 * Asserts that the knowledge which used to live in the planner's if-chain now
 * lives in contracts, and that the observers read the real world rather than
 * the executor's opinion of it.
 */

import type { Pool } from 'pg';
import {
  VerificationRunner,
  validateContract,
  defaultState,
  computeAuthority,
} from '../../lib/capability-contract';
import {
  createHeidiVerificationRunner,
  createDatabaseObserver,
  createApiResponseObserver,
  heidiObservers,
  resolveTarget,
} from '../../lib/heidi/ContractVerification';
import type { VerificationDeps } from '../../lib/heidi/ContractVerification';
import { ALL_CONTRACTS, weaklyVerifiedWrites } from '../../lib/heidi/contracts';
import {
  TOOL_UPDATE_DATABASE,
  WORLD_SYNC,
  TOOL_SCHEDULE_EVENT,
  TOOL_SEND_EMAIL,
  OPS_CHECK_HEALTH,
} from '../../lib/heidi/contracts/extended-contracts';
import {
  COGNITIVE_CONTRACTS,
  GOAL_ADVANCE,
  GOAL_COMPLETE,
  TOOL_CREATE_TASK,
  REVENUE_UPDATE_PROSPECT_STATUS,
  WORLD_QUERY,
  COMM_SEND_MESSAGE,
  TOOL_CANCEL_TASK,
  weaklyVerified,
} from '../../lib/heidi/contracts/cognitive-contracts';

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

interface FakeQuery {
  sql: string;
  params: unknown[];
}

function fakeDeps(overrides: {
  rows?: Record<string, unknown>[];
  goal?: { status?: string; result?: unknown } | null;
  queries?: FakeQuery[];
  health?: () => Promise<unknown>;
  verifyService?: (id: string) => Promise<{ verified: boolean; result: string }>;
} = {}): VerificationDeps {
  const queries = overrides.queries ?? [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: overrides.rows ?? [] };
    },
  } as unknown as Pool;

  return {
    pool,
    goals: { getGoal: async () => overrides.goal ?? null },
    operationalIntelligence: overrides.health ? { checkHealth: overrides.health } : null,
    revenueLifecycle: overrides.verifyService
      ? { verifyService: overrides.verifyService }
      : null,
  };
}

const CTX = {
  sessionId: 'test',
  actorId: 'heidi',
  authorityId: null,
  state: defaultState(),
};

function runnerFor(deps: VerificationDeps): VerificationRunner {
  return createHeidiVerificationRunner(deps);
}

// ---------------------------------------------------------------------------

describe('migrated contracts are complete', () => {
  it('all validate with no errors', () => {
    for (const contract of COGNITIVE_CONTRACTS) {
      const result = validateContract(contract);
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect({ id: contract.identity.id, errors }).toEqual({
        id: contract.identity.id,
        errors: [],
      });
    }
  });

  it('covers every branch the legacy if-chain hand-coded', () => {
    const ids = COGNITIVE_CONTRACTS.map((c) => c.identity.id).sort();
    expect(ids).toEqual(
      [
        'cognitive.observe',
        'comm.send_message',
        'goal.advance',
        'goal.complete',
        'recovery.auto_recover',
        'recovery.governed_recover',
        'revenue.activate_service',
        'revenue.create_opportunity',
        'revenue.get_verified_revenue',
        'revenue.identify_prospect',
        'revenue.run_cycle',
        'revenue.update_prospect_status',
        'tool.cancel_task',
        'tool.create_task',
        'world.query',
      ].sort(),
    );
  });

  it('names the capabilities that only mark their own homework', () => {
    // These verify against the executor's return value. That is debt carried
    // over from the legacy chain, and it should stay visible.
    expect(weaklyVerified().sort()).toEqual(
      [
        'cognitive.observe',
        'revenue.get_verified_revenue',
        'revenue.run_cycle',
        'world.query',
      ].sort(),
    );
    // comm.send_message left this list by gaining a real observation source,
    // not by being reclassified: it now re-reads delivery from the durable
    // conversation store instead of trusting the send call's return value.
    expect(COMM_SEND_MESSAGE.verification.observation.source).toBe('process');
    expect(COMM_SEND_MESSAGE.verification.observation.target).toContain('delivery:');
  });

  it('rates an external, irreversible send above a database read', () => {
    const state = defaultState();
    const send = computeAuthority(COMM_SEND_MESSAGE, {}, state);
    const query = computeAuthority(WORLD_QUERY, {}, state);
    expect(['R3', 'R4']).toContain(send.tier);
    expect(query.tier).toBe('R0');
  });
});

describe('target resolution', () => {
  it('prefers an argument over a value echoed back by the executor', () => {
    const resolved = resolveTarget('sql:t:id={id}', { id: 'from-args' }, { id: 'from-result' });
    expect(resolved).toBe('sql:t:id=from-args');
  });

  it('falls back to the result when the argument is absent', () => {
    expect(resolveTarget('sql:t:id={id}', {}, { id: 'r1' })).toBe('sql:t:id=r1');
  });

  it('returns null rather than an empty target when nothing resolves', () => {
    expect(resolveTarget('sql:t:id={id}', {}, {})).toBeNull();
  });
});

describe('database observer reads the world back', () => {
  it('re-reads the goal for goal.advance instead of trusting the executor', async () => {
    const deps = fakeDeps({ goal: { status: 'in_progress' } });
    const result = await runnerFor(deps).verify(
      GOAL_ADVANCE,
      { targetGoalId: 'g-1' },
      CTX,
      { claimed: 'success' },
    );
    expect(result.outcome).toBe('verified');
  });

  it('fails goal.complete when the goal is still in progress', async () => {
    const deps = fakeDeps({ goal: { status: 'in_progress' } });
    const result = await runnerFor(deps).verify(GOAL_COMPLETE, { targetGoalId: 'g-1' }, CTX, {
      completed: true,
    });
    expect(result.outcome).toBe('failed');
    expect(result.failedConditions.join(' ')).toContain('status');
  });

  it('fails when the goal does not exist at all', async () => {
    const deps = fakeDeps({ goal: null });
    const result = await runnerFor(deps).verify(GOAL_ADVANCE, { targetGoalId: 'g-1' }, CTX, {});
    expect(result.outcome).toBe('failed');
  });

  it('binds the row id as a parameter, never into the SQL text', async () => {
    const queries: FakeQuery[] = [];
    const deps = fakeDeps({ queries, rows: [{ id: 't-1', status: 'pending' }] });
    const result = await runnerFor(deps).verify(TOOL_CREATE_TASK, {}, CTX, { task_id: 't-1' });

    expect(result.outcome).toBe('verified');
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('FROM actions WHERE id = $1');
    expect(queries[0].params).toEqual(['t-1']);
    expect(queries[0].sql).not.toContain('t-1');
  });

  it('reports unverifiable-by-error when the id cannot be resolved', async () => {
    const deps = fakeDeps({ rows: [] });
    // No task_id anywhere: the legacy chain fell through to "trust the
    // executor" here. The contract refuses to.
    const result = await runnerFor(deps).verify(TOOL_CREATE_TASK, {}, CTX, { ok: true });
    expect(result.outcome).toBe('error');
    expect(result.verified).toBe(false);
    expect(result.evidence).toContain('Could not resolve');
  });

  it('checks the status actually changed, not merely that the row exists', async () => {
    const deps = fakeDeps({ rows: [{ prospect_id: 'p-1', status: 'contacted' }] });
    const runner = runnerFor(deps);

    const matching = await runner.verify(
      REVENUE_UPDATE_PROSPECT_STATUS,
      { prospectId: 'p-1', newStatus: 'contacted' },
      CTX,
      {},
    );
    const mismatched = await runner.verify(
      REVENUE_UPDATE_PROSPECT_STATUS,
      { prospectId: 'p-1', newStatus: 'qualified' },
      CTX,
      {},
    );

    expect(matching.outcome).toBe('verified');
    expect(mismatched.outcome).toBe('failed');
    expect(mismatched.failedConditions.join(' ')).toContain('qualified');
  });

  it('refuses a table or column that is not a plain identifier', async () => {
    const observer = createDatabaseObserver(fakeDeps());
    await expect(
      observer(
        { source: 'database', target: 'sql:actions;DROP TABLE x:id=1', extractFields: [], settleMs: 0 },
        {},
        CTX,
        null,
      ),
    ).rejects.toThrow(/non-identifier/);
  });

  it('drops non-identifier extractFields rather than interpolating them', async () => {
    const queries: FakeQuery[] = [];
    const deps = fakeDeps({ queries, rows: [{}] });
    const observer = createDatabaseObserver(deps);
    await observer(
      {
        source: 'database',
        target: 'sql:actions:id=1',
        extractFields: ['status', '(SELECT 1)'],
        settleMs: 0,
      },
      {},
      CTX,
      null,
    );
    expect(queries[0].sql).toContain('SELECT status FROM actions');
    expect(queries[0].sql).not.toContain('(SELECT 1)');
  });
});

describe('api_response observer', () => {
  it('exposes shape metadata and response fields side by side', async () => {
    const observer = createApiResponseObserver();
    const observed = await observer(
      { source: 'api_response', target: 'response', extractFields: [], settleMs: 0 },
      {},
      CTX,
      { deliveryStatus: 'sent', messageId: 'm-1' },
    );
    expect(observed.present).toBe(true);
    expect(observed.type).toBe('object');
    expect(observed.deliveryStatus).toBe('sent');
  });

  it('does not let a response field shadow the observation metadata', async () => {
    const observer = createApiResponseObserver();
    const observed = await observer(
      { source: 'api_response', target: 'response', extractFields: [], settleMs: 0 },
      {},
      CTX,
      { present: false, type: 'lies' },
    );
    expect(observed.present).toBe(true);
    expect(observed.type).toBe('object');
  });

  it('verifies world.query only on a non-empty answer', async () => {
    const runner = runnerFor(fakeDeps());
    const good = await runner.verify(WORLD_QUERY, {}, CTX, 'the answer');
    const empty = await runner.verify(WORLD_QUERY, {}, CTX, '');
    const wrongType = await runner.verify(WORLD_QUERY, {}, CTX, { answer: 'x' });

    expect(good.outcome).toBe('verified');
    expect(empty.outcome).toBe('failed');
    expect(wrongType.outcome).toBe('failed');
  });
});

describe('missing dependencies fail closed', () => {
  it('does not register the process observer when nothing can answer it', () => {
    const entries = heidiObservers(fakeDeps());
    expect(entries.map((e) => e[0]).sort()).toEqual(['api_response', 'database']);
  });

  it('reports unverifiable — not verified — when the observer is absent', async () => {
    const runner = runnerFor(fakeDeps());
    const recovery = COGNITIVE_CONTRACTS.find(
      (c) => c.identity.id === 'recovery.auto_recover',
    )!;
    const result = await runner.verify(recovery, { component: 'heidi-web' }, CTX, {});
    expect(result.outcome).toBe('unverifiable');
    expect(result.verified).toBe(false);
  });

  it('treats a throwing health probe as a failed verification', async () => {
    const deps = fakeDeps({
      health: async () => {
        throw new Error('probe down');
      },
    });
    const recovery = COGNITIVE_CONTRACTS.find(
      (c) => c.identity.id === 'recovery.auto_recover',
    )!;
    const result = await runnerFor(deps).verify(recovery, { component: 'heidi-web' }, CTX, {});
    expect(result.outcome).toBe('error');
    expect(result.verified).toBe(false);
  });
});

describe('create_task has a real undo', () => {
  it('names a registered inverse rather than claiming none', () => {
    expect(TOOL_CREATE_TASK.reversibility.kind).toBe('inverse_capability');
    expect(TOOL_CREATE_TASK.reversibility.inverseCapabilityId).toBe('tool.cancel_task');
    expect(COGNITIVE_CONTRACTS.map((c) => c.identity.id)).toContain('tool.cancel_task');
  });

  it('states the undo is bounded by state, not time', () => {
    // The row can be retracted only while pending. Saying so in the caveat is
    // what keeps `windowMs: Infinity` from overstating the guarantee.
    expect(TOOL_CREATE_TASK.reversibility.caveat).toMatch(/pending/i);
  });

  it('does not claim the undo is itself undoable', () => {
    expect(TOOL_CANCEL_TASK.reversibility.kind).toBe('none');
    expect(TOOL_CANCEL_TASK.reversibility.caveat).toMatch(/new task|does not restore/i);
  });

  it('verifies the cancellation by the row being gone', () => {
    expect(TOOL_CANCEL_TASK.verification.observation.source).toBe('database');
    expect(TOOL_CANCEL_TASK.verification.conditions).toEqual([
      { field: 'found', operator: 'eq', expected: false },
    ]);
  });

  it('drops create_task to an autonomous tier now the undo exists', () => {
    const state = defaultState({ humanPresent: false });
    // Was R3 on 100% of invocations while `undo=none`.
    expect(computeAuthority(TOOL_CREATE_TASK, {}, state).tier).toBe('R2');
  });
});

describe('the remaining 28 are migrated', () => {
  it('leaves nothing on the legacy chain', () => {
    // 45 = 14 first-wave + tool.cancel_task + 28 + the two operations that
    // closing the run_cycle bypass revealed had no contract at all
    // (revenue.start_provisioning, revenue.update_health_status).
    expect(ALL_CONTRACTS).toHaveLength(45);
    const ids0 = ALL_CONTRACTS.map((c) => c.identity.id);
    expect(ids0).toContain('revenue.start_provisioning');
    expect(ids0).toContain('revenue.update_health_status');
    const ids = new Set(ALL_CONTRACTS.map((c) => c.identity.id));
    expect(ids.size).toBe(ALL_CONTRACTS.length); // no duplicate registrations
  });

  it('all validate with no errors', () => {
    for (const contract of ALL_CONTRACTS) {
      const errors = validateContract(contract).issues.filter((i) => i.severity === 'error');
      expect({ id: contract.identity.id, errors }).toEqual({ id: contract.identity.id, errors: [] });
    }
  });

  it('counts only WRITES verified by their own response as debt', () => {
    // For a read the response IS the outcome, so api_response is honest
    // verification. Eighteen reads use it; counting them as debt would bury
    // the four cases that actually are.
    expect(weaklyVerifiedWrites().sort()).toEqual(
      ['revenue.run_cycle', 'self_sufficiency.run_self_repair', 'tool.send_email'].sort(),
    );
    expect(weaklyVerifiedWrites()).not.toContain('cognitive.observe');
    expect(weaklyVerifiedWrites()).not.toContain('world.query');
  });

  it('gives reads predicates that can actually fail', () => {
    // `exists` on a field the executor always sets is a predicate that cannot
    // fail — worse than none, because it looks like one.
    const health = OPS_CHECK_HEALTH.verification.conditions;
    expect(health.length).toBeGreaterThan(0);
    for (const contract of ALL_CONTRACTS) {
      for (const condition of contract.verification.conditions) {
        expect(condition.field).not.toBe('');
      }
    }
  });

  it('scopes tool.update_database to the executor real writable table', () => {
    // ActionExecutor's WRITABLE_TABLES is exactly ['sessions']. Declaring the
    // whole database would read as system scope on every call.
    expect(TOOL_UPDATE_DATABASE.effects[0].resourcePatterns).toEqual(['sessions']);
  });

  it('routes scheduled events through the same undo as tasks', () => {
    // Scheduled events are rows in `actions`, so cancel_task retracts them on
    // identical terms.
    expect(TOOL_SCHEDULE_EVENT.reversibility.inverseCapabilityId).toBe('tool.cancel_task');
  });

  it('keeps an irreversible external send at the top tier', () => {
    const tier = computeAuthority(TOOL_SEND_EMAIL, {}, defaultState({ humanPresent: false })).tier;
    expect(tier).toBe('R4');
  });
});

describe('count observation', () => {
  it('verifies world.sync by the model not being empty', async () => {
    const queries: FakeQuery[] = [];
    const populated = await runnerFor(
      fakeDeps({ queries, rows: [{ count: 42 }] }),
    ).verify(WORLD_SYNC, {}, CTX, {});
    expect(populated.outcome).toBe('verified');
    expect(queries[0].sql).toContain('count(*)');
    expect(queries[0].sql).toContain('FROM heidi_world_model');

    const empty = await runnerFor(fakeDeps({ rows: [{ count: 0 }] })).verify(
      WORLD_SYNC,
      {},
      CTX,
      {},
    );
    expect(empty.outcome).toBe('failed');
  });

  it('refuses to count a table name that is not an identifier', async () => {
    const observer = createDatabaseObserver(fakeDeps());
    await expect(
      observer(
        { source: 'database', target: 'count:actions; DROP TABLE x', extractFields: [], settleMs: 0 },
        {},
        CTX,
        null,
      ),
    ).rejects.toThrow(/non-identifier/);
  });

  it('identifier-checks a table supplied by the caller', async () => {
    // tool.update_database takes its table from the invocation, so the guard
    // is what stands between an argument and the SQL text.
    const observer = createDatabaseObserver(fakeDeps({ rows: [{ id: 's-1' }] }));
    await expect(
      observer(
        { source: 'database', target: 'sql:{table}:id={id}', extractFields: ['id'], settleMs: 0 },
        { table: 'sessions; DELETE FROM actions', id: 's-1' },
        CTX,
        null,
      ),
    ).rejects.toThrow(/non-identifier/);
  });
});

describe('the four weak writes, resolved individually', () => {
  it('comm.send_message reads delivery from the durable store', () => {
    // Independent: the observation source is not the thing that did the send.
    expect(COMM_SEND_MESSAGE.verification.observation.source).toBe('process');
    expect((COMM_SEND_MESSAGE.metadata as Record<string, unknown>).verificationClass).toBe(
      'independent',
    );
    // And the environment blocker is recorded rather than worked around.
    expect((COMM_SEND_MESSAGE.metadata as Record<string, unknown>).environmentBlocker).toContain(
      'message_id',
    );
  });

  it('tool.send_email checks the field the executor actually returns', () => {
    // ActionExecutor.sendEmail returns { email_id, to }. The previous predicate
    // checked `id`, so it could never match — the capability would have
    // reported failure on every successful send.
    expect(TOOL_SEND_EMAIL.verification.conditions).toEqual([
      { field: 'email_id', operator: 'not_null', expected: null },
    ]);
    expect((TOOL_SEND_EMAIL.metadata as Record<string, unknown>).verificationClass).toBe(
      'provider_acceptance',
    );
  });

  it('does not claim provider acceptance is delivery', () => {
    expect(TOOL_SEND_EMAIL.verification.description).toMatch(/not delivery/i);
  });

  it('self_repair is marked unverifiable and forced to human confirmation', () => {
    const repair = ALL_CONTRACTS.find(
      (c) => c.identity.id === 'self_sufficiency.run_self_repair',
    )!;
    expect(repair.verification.requiresHumanConfirmation).toBe(true);
    expect((repair.metadata as Record<string, unknown>).verificationClass).toBe('unverifiable');
    // requiresHumanConfirmation forces R3 minimum, so a shape check can never
    // let this run unattended.
    expect(computeAuthority(repair, {}, defaultState({ humanPresent: false })).requiresApproval).toBe(
      true,
    );
  });

  it('records run_cycle honestly now the bypass is closed', () => {
    // It calls pipeline/lifecycle methods directly rather than dispatching
    // through the registry. Rather than credit it with verification that does
    // not happen, each of those calls is now authorized against its own
    // contract by a governor — and run_cycle keeps subsystem scope, because
    // one decision still admits a sequence of writes.
    const cycle = ALL_CONTRACTS.find((c) => c.identity.id === 'revenue.run_cycle')!;
    const meta = cycle.metadata as Record<string, unknown>;
    expect(meta.verificationClass).toBe('self_report');
    expect(meta.governanceBypass).toContain('CLOSED');
    // One authorization admitting unbounded pipeline writes is subsystem scope.
    expect(cycle.effects[0].worstCaseScope).toBe('subsystem');
    expect(computeAuthority(cycle, {}, defaultState({ humanPresent: false })).tier).toBe('R4');
  });
});
