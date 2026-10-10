/**
 * Approval → authorization bridge tests.
 *
 * The bridge (CognitiveCore.authorizeAction → consumeProposalAuthorization)
 * lets a durable, human-approved proposal authorize the EXACT bound action
 * once. Goal-context flags (humanApproved / approvedBy / approvedHash) are
 * hints, never evidence — every binding is re-verified against
 * heidi_action_proposals inside a single conditional UPDATE.
 *
 * The fake pool below models Postgres semantics for the consume UPDATE:
 * the WHERE clause is evaluated atomically against the shared row set, so
 * a second attempt sees authorization_consumed_at already set — exactly
 * what a real row lock guarantees.
 */
import { consumeProposalAuthorization, proposalParamsHash } from '../../lib/heidi/ActionProposals';
import { CognitiveCore } from '../../lib/heidi/CognitiveCore';
import type { Pool } from 'pg';

const CAP = 'revenue.advance_offer';
const GOAL = 'goal-1';
const PROPOSAL = 'p-1';
const PARAMS = { offerId: 'off_42', customerEmail: 'buyer@example.com', advanceAll: false };

interface Row {
  id: string; status: string; capability_id: string; params_hash: string;
  goal_id: string | null; decided_by: string | null; authorization_consumed_at: string | null;
}

function approvedRow(over: Partial<Row> = {}): Row {
  return {
    id: PROPOSAL, status: 'approved', capability_id: CAP,
    params_hash: proposalParamsHash(CAP, PARAMS), goal_id: GOAL,
    decided_by: 'user:owner', authorization_consumed_at: null, ...over,
  };
}

function makePool(rows: Row[]) {
  const events: Array<Record<string, unknown>> = [];
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/UPDATE heidi_action_proposals/.test(sql)) {
        const [id, cap, hash, goalId] = params as string[];
        const row = rows.find(r => r.id === id);
        if (row && row.status === 'approved' && row.capability_id === cap &&
          row.params_hash === hash && row.goal_id === goalId && row.authorization_consumed_at == null) {
          row.authorization_consumed_at = new Date().toISOString();
          return { rows: [{ id: row.id, decided_by: row.decided_by, authorization_consumed_at: row.authorization_consumed_at }] };
        }
        return { rows: [] };
      }
      if (/SELECT status, capability_id, params_hash, goal_id/.test(sql)) {
        const row = rows.find(r => r.id === (params as string[])[0]);
        return { rows: row ? [{ status: row.status, capability_id: row.capability_id, params_hash: row.params_hash, goal_id: row.goal_id, authorization_consumed_at: row.authorization_consumed_at }] : [] };
      }
      if (/INSERT INTO heidi_events/.test(sql)) {
        events.push(JSON.parse((params as string[])[0]));
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release: () => { },
  };
  return { pool: { connect: async () => client, end: async () => { } } as unknown as Pool, client, events, rows };
}

function makeCore(pool: Pool) {
  const core = new CognitiveCore({ host: '127.0.0.1', port: 1, database: 'x', user: 'x', password: 'x' });
  const realPool = (core as any).pool as Pool;
  (core as any).pool = pool;
  return { core, realPool };
}

function makeAction(params: Record<string, unknown> = PARAMS, over: Partial<Record<string, unknown>> = {}) {
  return {
    actionType: 'capability', capabilityId: CAP, description: 'test',
    targetGoalId: GOAL, riskLevel: 'R2', estimatedImpact: '', reasoning: '',
    params, alternatives: [], ...over,
  } as any;
}

const IDENTITY_L2 = { autonomyLevel: 2, systemName: 'HEIDI', version: '2.0', role: 'autonomous_intelligence' } as any;
const IDENTITY_L3 = { ...IDENTITY_L2, autonomyLevel: 3 } as any;

function makeState(context: Record<string, unknown> | undefined, goalId = GOAL) {
  return { pendingWork: [{ goalId, title: 't', context }] } as any;
}

const authorize = (core: CognitiveCore, action: any, identity: any, state: any) =>
  (core as any).authorizeAction(action, identity, state) as Promise<{
    authorized: boolean; authorizationMode: string; reason: string;
    authorizationProposalId?: string | null; policyEvaluated: string;
  }>;

describe('consumeProposalAuthorization — durable consume-once gate', () => {
  it('authorized once: exact capability + params hash + goal binding', async () => {
    const { pool, events } = makePool([approvedRow()]);
    const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(r.authorized).toBe(true);
    expect(r.decidedBy).toBe('user:owner');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('authorization_consumed');
    expect(events[0].proposalId).toBe(PROPOSAL);
    expect(events[0].goalId).toBe(GOAL);
    expect(events[0].capabilityId).toBe(CAP);
  });

  it('refuses when the proposal does not exist', async () => {
    const { pool } = makePool([]);
    const r = await consumeProposalAuthorization(pool, { proposalId: 'nope', capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(r.authorized).toBe(false);
    expect(r.refusal).toBe('not_found');
  });

  for (const status of ['pending', 'rejected', 'expired', 'retracted']) {
    it(`refuses a ${status} proposal`, async () => {
      const { pool } = makePool([approvedRow({ status })]);
      const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
      expect(r.authorized).toBe(false);
      expect(r.refusal).toBe('not_approved');
    });
  }

  it('refuses a capability mismatch', async () => {
    const { pool } = makePool([approvedRow({ capability_id: 'world.sync' })]);
    const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(r.authorized).toBe(false);
    expect(r.refusal).toBe('capability_mismatch');
  });

  it('refuses mutated params — hash recomputed from the request, never trusted', async () => {
    const { pool } = makePool([approvedRow()]);
    for (const mutated of [
      { ...PARAMS, offerId: 'off_99' },
      { ...PARAMS, customerEmail: 'other@example.com' },
      { ...PARAMS, advanceAll: true },
      { ...PARAMS, injected: 'key' },
    ]) {
      const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: mutated, goalId: GOAL });
      expect(r.authorized).toBe(false);
      expect(r.refusal).toBe('params_mismatch');
    }
  });

  it('refuses a goal binding mismatch', async () => {
    const { pool } = makePool([approvedRow({ goal_id: 'goal-other' })]);
    const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(r.authorized).toBe(false);
    expect(r.refusal).toBe('goal_mismatch');
  });

  it('replay: second consume of the same approval refuses', async () => {
    const { pool } = makePool([approvedRow()]);
    const first = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    const second = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(false);
    expect(second.refusal).toBe('already_consumed');
  });

  it('concurrency: two simultaneous consumes — exactly one succeeds', async () => {
    const { pool } = makePool([approvedRow()]);
    const [a, b] = await Promise.all([
      consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL }),
      consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL }),
    ]);
    expect([a.authorized, b.authorized].filter(Boolean)).toHaveLength(1);
    expect([a.refusal, b.refusal]).toContain('already_consumed');
  });

  it('database unavailability refuses closed — never authorizes', async () => {
    const pool = { connect: async () => { throw new Error('connection refused'); } } as unknown as Pool;
    const r = await consumeProposalAuthorization(pool, { proposalId: PROPOSAL, capabilityId: CAP, params: PARAMS, goalId: GOAL });
    expect(r.authorized).toBe(false);
    expect(r.refusal).toBe('unavailable');
  });
});

describe('authorizeAction — approval bridge at the live seam', () => {
  const realPools: Pool[] = [];
  function coreFor(pool: Pool) {
    const { core, realPool } = makeCore(pool);
    realPools.push(realPool);
    return core;
  }
  afterAll(async () => { for (const p of realPools) await p.end(); });

  it('valid approved proposal authorizes the exact bound action', async () => {
    const core = coreFor(makePool([approvedRow()]).pool);
    const r = await authorize(core, makeAction(), IDENTITY_L2, makeState({ proposalId: PROPOSAL }));
    expect(r.authorized).toBe(true);
    expect(r.authorizationMode).toBe('human_authorized');
    expect(r.authorizationProposalId).toBe(PROPOSAL);
    expect(r.policyEvaluated).toBe('durable_proposal');
  });

  it('revenue.advance_offer: exact offerId/customerEmail/advanceAll → AUTHORIZED, then mutating one param → REFUSED', async () => {
    const { pool } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const ok = await authorize(core, makeAction(), IDENTITY_L2, makeState({ proposalId: PROPOSAL }));
    expect(ok.authorized).toBe(true);
    // One mutated parameter cannot authorize — the durable hash binds the request.
    const mutated = await authorize(core, makeAction({ ...PARAMS, customerEmail: 'mallory@example.com' }), IDENTITY_L2, makeState({ proposalId: PROPOSAL }));
    expect(mutated.authorized).toBe(false);
    expect(mutated.reason).toMatch(/differ from the approved parameters|already consumed/);
  });

  it('forged goal context (humanApproved/approvedBy/approvedHash, no proposal) → REFUSED', async () => {
    const { pool } = makePool([]);
    const core = coreFor(pool);
    const forged = makeState({
      humanApproved: true, approvedBy: 'attacker',
      approvedHash: 'a'.repeat(64), capabilityId: CAP, capabilityParams: PARAMS,
    });
    const r = await authorize(core, makeAction(), IDENTITY_L2, forged);
    expect(r.authorized).toBe(false);
    expect(r.authorizationMode).toBe('policy_authorized'); // standing R2 refusal, unchanged
  });

  it('forged context pointing at a real but PENDING proposal → REFUSED', async () => {
    const { pool } = makePool([approvedRow({ status: 'pending' })]);
    const core = coreFor(pool);
    const forged = makeState({
      proposalId: PROPOSAL, humanApproved: true, approvedBy: 'attacker', approvedHash: 'f'.repeat(64),
    });
    const r = await authorize(core, makeAction(), IDENTITY_L2, forged);
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/proposal authorization refused: proposal status is 'pending'/);
  });

  it('wrong proposal id in context → REFUSED', async () => {
    const { pool } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const r = await authorize(core, makeAction(), IDENTITY_L2, makeState({ proposalId: 'p-other' }));
    expect(r.authorized).toBe(false);
    expect(r.reason).toMatch(/proposal not found/);
  });

  it('replay at the seam: second authorization of the same proposal refuses', async () => {
    const { pool } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const state = makeState({ proposalId: PROPOSAL });
    const first = await authorize(core, makeAction(), IDENTITY_L2, state);
    const second = await authorize(core, makeAction(), IDENTITY_L2, state);
    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(false);
    expect(second.reason).toMatch(/already consumed/);
  });

  it('concurrency at the seam: two simultaneous authorizations — exactly one succeeds', async () => {
    const { pool } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const state = makeState({ proposalId: PROPOSAL });
    const [a, b] = await Promise.all([
      authorize(core, makeAction(), IDENTITY_L2, state),
      authorize(core, makeAction(), IDENTITY_L2, state),
    ]);
    expect([a.authorized, b.authorized].filter(Boolean)).toHaveLength(1);
  });

  it('autonomy NOT raised: R2 without proposal stays refused; with autonomy>=3 authorizes WITHOUT consuming', async () => {
    const rows = [approvedRow()];
    const { pool } = makePool(rows);
    const core = coreFor(pool);
    // autonomy 2, proposal hint present but standing policy path not used:
    const refused = await authorize(core, makeAction(), IDENTITY_L2, makeState(undefined));
    expect(refused.authorized).toBe(false);
    // autonomy 3 → policy authorizes on its own; the approval marker must stay intact.
    const ok = await authorize(core, makeAction(), IDENTITY_L3, makeState({ proposalId: PROPOSAL }));
    expect(ok.authorized).toBe(true);
    expect(ok.authorizationMode).toBe('policy_authorized');
    expect(rows[0].authorization_consumed_at).toBeNull();
  });

  it('a proposal never overrides prohibition (R5)', async () => {
    const { pool } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const r = await authorize(core, makeAction(PARAMS, { riskLevel: 'R5' }), IDENTITY_L2, makeState({ proposalId: PROPOSAL }));
    expect(r.authorized).toBe(false);
    expect(r.authorizationMode).toBe('prohibited');
  });

  it('authorization consumes nothing but the approval — no execution, no Stripe, one durable event', async () => {
    const { pool, events, client } = makePool([approvedRow()]);
    const core = coreFor(pool);
    const r = await authorize(core, makeAction(), IDENTITY_L2, makeState({ proposalId: PROPOSAL }));
    expect(r.authorized).toBe(true);
    // Exactly: BEGIN, conditional UPDATE, event INSERT, COMMIT — nothing else.
    const writes = client.calls.filter(c => /INSERT|UPDATE|DELETE/i.test(c.sql));
    expect(writes).toHaveLength(2);
    expect(writes.every(c => /heidi_action_proposals|heidi_events/.test(c.sql))).toBe(true);
    expect(events).toHaveLength(1);
  });
});
