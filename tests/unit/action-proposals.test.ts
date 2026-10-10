/**
 * ActionProposals — governed proposal consume tests (mocked pg pool).
 *
 * Verifies: allowlist validation, params-hash binding, consume-once
 * race safety, expiry rejection, changed-content refusal, and that a
 * receipt/goal write failure rolls the approval back.
 */

import {
  validateProposalSpec, proposalParamsHash, resolveProposal,
  createActionProposal,
} from '../../lib/heidi/ActionProposals';
import { CapabilityRegistry, DEFAULT_CAPABILITIES } from '../../lib/heidi/CapabilityRegistry';
import { randomUUID } from 'crypto';

type Rows = Array<Record<string, unknown>>;

function makeClient(handlers: Array<{ match: RegExp; rows: Rows }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      for (const h of handlers) if (h.match.test(sql)) return { rows: h.rows };
      return { rows: [] };
    }),
    release: jest.fn(),
    calls,
  };
}
const sqlOf = (c: ReturnType<typeof makeClient>) => c.calls.map(x => x.sql);
const makePool = (client: ReturnType<typeof makeClient>) =>
  ({ connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [] })) }) as any;

const PID = randomUUID();
function proposalRow(over: Record<string, unknown> = {}) {
  const capabilityId = 'ops.coo_state';
  const params = {};
  return {
    id: PID, version: 1, capability_id: capabilityId, params,
    params_hash: proposalParamsHash(capabilityId, params),
    title: 'Run supervision', reason: 'test', status: 'pending',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
    producer_key: 'test', goal_id: null, ...over,
  };
}

describe('validateProposalSpec', () => {
  it('rejects non-allowlisted capabilities', () => {
    expect(validateProposalSpec('tool.send_email', {})).toMatch(/not on the approval allowlist/);
    expect(validateProposalSpec('ops.dev_patch', {})).toMatch(/not on the approval allowlist/);
    // dropped after review — superviseAgents can retry real work
    expect(validateProposalSpec('ops.agent_supervise', {})).toMatch(/not on the approval allowlist/);
  });
  it('rejects params on none-spec capabilities', () => {
    expect(validateProposalSpec('world.sync', { x: 1 })).toMatch(/takes no parameters/);
  });
  it('rejects forbidden param keys', () => {
    for (const k of ['path', 'url', 'command', 'sql', 'secret', 'file']) {
      const p: Record<string, unknown> = {}; p[k] = 'x';
      expect(validateProposalSpec('ops.coo_state', p)).toMatch(/forbidden/);
    }
  });
  it('v1 allowlist is R0-only — R1+ tools are refused', () => {
    expect(validateProposalSpec('tool.create_task', { title: 'x' })).toMatch(/not on the approval allowlist/);
    expect(validateProposalSpec('recovery.governed_recover', {})).toMatch(/not on the approval allowlist/);
    // removed at safety review: checkAll probes call Stripe/Twilio/etc.
    expect(validateProposalSpec('self_sufficiency.check_all_capabilities', {})).toMatch(/not on the approval allowlist/);
  });
});

describe('resolveProposal — consume semantics', () => {
  it('approve consumes + inserts pending mission goal + receipt in ONE tx', async () => {
    const row = proposalRow();
    const client = makeClient([
      { match: /SELECT \* FROM heidi_action_proposals[\s\S]*FOR UPDATE/, rows: [row] },
      { match: /SET status='approved'/, rows: [{ id: PID }] },
      { match: /INSERT INTO heidi_goals/, rows: [{ id: 'goal-1' }] },
      { match: /UPDATE heidi_action_proposals SET goal_id/, rows: [] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r).toMatchObject({ ok: true, status: 'approved', goalId: 'goal-1' });
    const sql = sqlOf(client);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[sql.length - 1]).toBe('COMMIT');
    // goal carries the exact capability + params + proposal linkage
    const goalCall = client.calls.find(c => /INSERT INTO heidi_goals/.test(c.sql))!;
    const ctx = JSON.parse(goalCall.params[3] as string);
    expect(ctx).toMatchObject({
      capabilityId: 'ops.coo_state', proposalId: PID,
      producerKey: `proposal:${PID}`, humanApproved: true,
    });
    // the approval is bound to the exact displayed params_hash
    const upd = client.calls.find(c => /SET status='approved'/.test(c.sql))!;
    expect(upd.sql).toMatch(/params_hash=\$3/);
    expect(upd.params[2]).toBe(row.params_hash);
  });

  it('reject consumes without executing — no goal row is created', async () => {
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [proposalRow()] },
      { match: /SET status='rejected'/, rows: [{ id: PID }] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'reject', decidedBy: 'user:owner' });
    expect(r).toMatchObject({ ok: true, status: 'rejected' });
    expect(sqlOf(client).some(s => /INSERT INTO heidi_goals/.test(s))).toBe(false);
  });

  it('expired proposal → marked expired, refused, never executed', async () => {
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [proposalRow({ expires_at: new Date(Date.now() - 1000).toISOString() })] },
      { match: /SET status='expired'/, rows: [] },
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired/i);
    expect(sqlOf(client).some(s => /INSERT INTO heidi_goals/.test(s))).toBe(false);
  });

  it('tampered stored params → hash mismatch → refused before consume', async () => {
    const row = proposalRow({ params_hash: 'deadbeef' }); // doesn't match params
    const client = makeClient([{ match: /FOR UPDATE/, rows: [row] }]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/changed|fresh approval/i);
    expect(sqlOf(client)).toContain('ROLLBACK');
  });

  it('non-allowlisted capability stored in row → refused at consume', async () => {
    const row = proposalRow({ capability_id: 'tool.send_email', params: {} });
    row.params_hash = proposalParamsHash('tool.send_email', {}); // hash valid, capability not
    const client = makeClient([{ match: /FOR UPDATE/, rows: [row] }]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/allowlist/);
    expect(sqlOf(client)).toContain('ROLLBACK');
  });

  it('consume race lost (0-row update) → refused, rolled back', async () => {
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [proposalRow()] },
      { match: /SET status='approved'/, rows: [] },   // another writer won
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lost the race|changed/i);
    expect(sqlOf(client)).toContain('ROLLBACK');
    expect(sqlOf(client).some(s => /INSERT INTO heidi_goals/.test(s))).toBe(false);
  });

  it('goal insert failure → whole approval rolls back', async () => {
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [proposalRow()] },
      { match: /SET status='approved'/, rows: [{ id: PID }] },
    ]);
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      client.calls.push({ sql, params: params ?? [] });
      if (/INSERT INTO heidi_goals/.test(sql)) throw new Error('write failed');
      if (/FOR UPDATE/.test(sql)) return { rows: [proposalRow()] };
      if (/SET status='approved'/.test(sql)) return { rows: [{ id: PID }] };
      return { rows: [] };
    });
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(sqlOf(client)).toContain('ROLLBACK');
  });

  it('already-consumed proposal → refused, no tx side effects', async () => {
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [proposalRow({ status: 'approved' })] },
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/consume-once/i);
  });
});

describe('createActionProposal', () => {
  it('refuses non-allowlisted capabilities before touching the DB', async () => {
    const pool = { query: jest.fn() } as any;
    await expect(createActionProposal(pool, {
      capabilityId: 'tool.send_email', title: 'x', reason: 'x', producerKey: 'k',
    })).rejects.toThrow(/allowlist/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('dedupes on the pending unique index — returns existing', async () => {
    const dup = Object.assign(new Error('dup'), { code: '23505' });
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })                 // 24h cooldown check: clear
        .mockRejectedValueOnce(dup)                          // INSERT hits dedupe
        .mockResolvedValueOnce({ rows: [{ id: PID }] }),     // fetch existing
    } as any;
    const r = await createActionProposal(pool, {
      capabilityId: 'world.sync', title: 'Sync', reason: 'x', producerKey: 'k',
    });
    expect(r).toEqual({ id: PID, existing: true });
  });

  it('recent rejected proposal blocks re-proposal for 24h — no churn loop', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: PID, status: 'rejected' }] }),
    } as any;
    const r = await createActionProposal(pool, {
      capabilityId: 'world.sync', title: 'Sync', reason: 'x', producerKey: 'k',
    });
    expect(r).toEqual({ id: PID, existing: true });
    expect(pool.query).toHaveBeenCalledTimes(1);   // never reached the INSERT
  });
});

describe('revenue.advance_offer — proposal admission', () => {
  it('accepts the legitimate param shapes', () => {
    expect(validateProposalSpec('revenue.advance_offer', {})).toBeNull();
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 'offer-abc123def456' })).toBeNull();
    expect(validateProposalSpec('revenue.advance_offer', { customerEmail: 'buyer@example.com' })).toBeNull();
    expect(validateProposalSpec('revenue.advance_offer', { advanceAll: true })).toBeNull();
    expect(validateProposalSpec('revenue.advance_offer', {
      offerId: 'offer-abc123def456', customerEmail: 'buyer@example.com', advanceAll: false,
    })).toBeNull();
  });

  it('rejects unknown params, malformed values, and ambiguous targeting', () => {
    expect(validateProposalSpec('revenue.advance_offer', { jobId: 'j' })).toMatch(/not permitted/);
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 42 })).toMatch(/offerId/);
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 'a'.repeat(121) })).toMatch(/offerId/);
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 'offer x; DROP' })).toMatch(/offerId/);
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 'https://evil/x' })).toMatch(/offerId/);
    expect(validateProposalSpec('revenue.advance_offer', { customerEmail: 'not-an-email' })).toMatch(/customerEmail/);
    expect(validateProposalSpec('revenue.advance_offer', { customerEmail: 5 })).toMatch(/customerEmail/);
    expect(validateProposalSpec('revenue.advance_offer', { advanceAll: 'yes' })).toMatch(/advanceAll/);
    expect(validateProposalSpec('revenue.advance_offer', { offerId: 'offer-x', advanceAll: true })).toMatch(/mutually exclusive/);
  });

  it('forbidden param keys are still refused before the spec branch', () => {
    for (const k of ['url', 'secret', 'sql', 'command', 'path']) {
      const p: Record<string, unknown> = {}; p[k] = 'x';
      expect(validateProposalSpec('revenue.advance_offer', p)).toMatch(/forbidden/);
    }
  });

  it('the capability remains R2 — admission does not weaken authorization', () => {
    const spec = DEFAULT_CAPABILITIES.find(c => c.capabilityId === 'revenue.advance_offer');
    expect(spec).toBeDefined();
    expect(spec!.riskLevel).toBe('R2');
    expect(spec!.autonomyRequirement).toBe(2);
  });

  it('admission does not bypass the executor/authorization gates', () => {
    const reg = new CapabilityRegistry();
    const spec = DEFAULT_CAPABILITIES.find(c => c.capabilityId === 'revenue.advance_offer')!;
    const spy = jest.fn();
    reg.register(spec, spy);
    // Below the autonomy requirement the registry gate itself refuses —
    // an approved proposal cannot change that.
    expect(reg.isExecutable('revenue.advance_offer', 1).executable).toBe(false);
    expect(reg.isExecutable('revenue.advance_offer', 1).reason).toMatch(/autonomy level 2/);
    // At/above the requirement the registry admits, and the R2 risk gate in
    // CognitiveCore.authorizeAction still applies (autonomy >= 3) — proven by
    // heidi-autonomous-loop / heidi-cognitive-loop-qualification R2-refusal tests.
    expect(reg.isExecutable('revenue.advance_offer', 2).executable).toBe(true);
    // The proposal path never invokes the executor directly.
    expect(spy).not.toHaveBeenCalled();
  });

  it('an approved proposal dispatches a goal bound to the capability + params', async () => {
    const capabilityId = 'revenue.advance_offer';
    const params = { offerId: 'offer-abc123def456', customerEmail: 'buyer@example.com' };
    const row = proposalRow({
      capability_id: capabilityId,
      params,
      params_hash: proposalParamsHash(capabilityId, params),
    });
    const client = makeClient([
      { match: /FOR UPDATE/, rows: [row] },
      { match: /SET status='approved'/, rows: [{ id: PID }] },
      { match: /INSERT INTO heidi_goals/, rows: [{ id: 'goal-2' }] },
      { match: /UPDATE heidi_action_proposals SET goal_id/, rows: [] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const r = await resolveProposal(makePool(client), { id: PID, decision: 'approve', decidedBy: 'user:owner' });
    expect(r).toMatchObject({ ok: true, status: 'approved', goalId: 'goal-2' });
    const goalCall = client.calls.find(c => /INSERT INTO heidi_goals/.test(c.sql))!;
    const ctx = JSON.parse(goalCall.params[3] as string);
    // planner binds capabilityId -> registry -> authorizeAction; the
    // proposal only carries the contract — execution stays gated.
    expect(ctx).toMatchObject({
      capabilityId,
      capabilityParams: params,
      proposalId: PID,
      humanApproved: true,
    });
  });

  it('createActionProposal admits a revenue proposal past validation into the DB path', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })                    // 24h cooldown: clear
        .mockResolvedValueOnce({ rows: [{ id: PID }] })         // INSERT returns id
        .mockResolvedValueOnce({ rows: [] }),                   // receipt event insert
    } as any;
    const r = await createActionProposal(pool, {
      capabilityId: 'revenue.advance_offer',
      params: { offerId: 'offer-abc123def456' },
      title: 'Advance offer', reason: 'approved opportunity',
      producerKey: 'test:revenue',
    });
    expect(r).toEqual({ id: PID, existing: false });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});

