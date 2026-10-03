/**
 * MissionLedger — atomic claim + dedup semantics (mocked pool).
 *
 * Verifies: claim transaction ordering (mission row + receipt in one tx),
 * idempotent re-claim rules, honest refusal reasons, and the runner's
 * synchronous reservation closing the check-then-set race.
 */

import { MissionLedger, computeIdempotencyKey } from '../../lib/heidi/MissionLedger';
import { MissionRunner } from '../../lib/heidi/MissionRunner';

type Rows = Array<Record<string, unknown>>;

function makeClient(handlers: Array<{ match: RegExp; rows: Rows }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      for (const h of handlers) {
        if (h.match.test(sql)) return { rows: h.rows };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
    calls,
  };
  return client;
}

const sqlOf = (c: ReturnType<typeof makeClient>) => c.calls.map((x) => x.sql);

function makePool(client: ReturnType<typeof makeClient>) {
  return { connect: jest.fn(async () => client) } as any;
}

const CLAIM = {
  goalId: '11111111-1111-1111-1111-111111111111', producerKey: 'mission_runner',
  capabilityId: 'ops.test', params: { a: 1 }, workSlot: 'ws-1', claimedBy: 'test',
};

function makeRunner(
  ledger: {
    claim?: jest.Mock; transition?: jest.Mock; finalize?: jest.Mock;
    reconcileExpiredClaims?: jest.Mock;
  },
  opts: { allowLegacyDispatch?: boolean } = {},
) {
  const goals = { updateGoal: jest.fn(async () => null), getGoal: jest.fn(async () => null) };
  const registry = { execute: jest.fn(async () => ({ executed: true, outcome: 'success' })) };
  const lifecycle = { recordTransition: jest.fn(async () => null) };
  const runner = new MissionRunner({
    pool: {} as any,
    goals: goals as any,
    registry: registry as any,
    lifecycle: lifecycle as any,
    ledger: ledger as any,
    allowLegacyDispatch: opts.allowLegacyDispatch,
    maxConcurrent: 3,
  });
  return { runner, goals, registry, lifecycle };
}

describe('computeIdempotencyKey', () => {
  it('is stable across retries and key order, distinct for new work', () => {
    const a = computeIdempotencyKey({ ...CLAIM });
    const b = computeIdempotencyKey({ ...CLAIM, params: { a: 1 } });
    const c = computeIdempotencyKey({ ...CLAIM, workSlot: 'ws-2' });
    expect(a).toBe(b);           // retry = same key
    expect(a).not.toBe(c);       // new work = new key
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('MissionLedger.claim', () => {
  it('fresh claim: INSERT + receipt + COMMIT in one transaction', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [{ id: '33333333-3333-3333-3333-333333333333', attempt: 1, claim_generation: 1 }] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const ledger = new MissionLedger(makePool(client));
    const r = await ledger.claim(CLAIM);
    expect(r).toEqual({ claimed: true, missionId: '33333333-3333-3333-3333-333333333333', claimGeneration: 1, attempt: 1 });
    // ordering: BEGIN → INSERT missions → INSERT receipt → COMMIT
    const sql = sqlOf(client);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/INSERT INTO heidi_missions/);
    expect(sql[2]).toMatch(/INSERT INTO heidi_events/);
    expect(sql[3]).toBe('COMMIT');
    expect(sql).toHaveLength(4);
    // fresh claim receipt reads PLANNED as its origin
    const payload = JSON.parse(client.calls[2].params[0] as string);
    expect(payload).toMatchObject({ fromStage: 'PLANNED', toStage: 'DISPATCHED', attempt: 1 });
  });

  it('re-claim preserves retry history: prior state read under lock, receipt carries it', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [] },                       // conflict
      { match: /FOR UPDATE/, rows: [{ id: '33333333-3333-3333-3333-333333333333', status: 'failed', stage: 'FAILED', attempt: 2, claim_generation: 3, lease_expires_at: null }] },
      { match: /UPDATE heidi_missions/, rows: [{ id: '33333333-3333-3333-3333-333333333333', attempt: 3, claim_generation: 4 }] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const r = await new MissionLedger(makePool(client)).claim(CLAIM);
    expect(r.claimed).toBe(true);
    expect(r.claimGeneration).toBe(4);    // monotonic
    expect(r.attempt).toBe(3);
    // retry receipt preserves the prior attempt's terminal state
    // (call order: BEGIN, INSERT-conflict, SELECT FOR UPDATE, UPDATE, receipt)
    const payload = JSON.parse(client.calls[4].params[0] as string);
    expect(payload).toMatchObject({
      fromStage: 'FAILED', toStage: 'DISPATCHED',
      fromStatus: 'failed', attempt: 3, claimGeneration: 4,
    });
    expect(payload.evidence.retryOf).toMatchObject({
      status: 'failed', attempt: 2, claimGeneration: 3,
    });
  });

  it('refuses waiting_human with the honest reason', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [] },
      { match: /FOR UPDATE/, rows: [{ status: 'waiting_human', stage: 'ESCALATED', attempt: 1, claim_generation: 1, lease_expires_at: null }] },
    ]);
    const r = await new MissionLedger(makePool(client)).claim(CLAIM);
    expect(r).toMatchObject({ claimed: false, reason: 'awaiting_human' });
    expect(sqlOf(client)).toContain('ROLLBACK');
  });

  it('refuses succeeded with reason terminal', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [] },
      { match: /FOR UPDATE/, rows: [{ status: 'succeeded', stage: 'SUCCEEDED', attempt: 1, claim_generation: 1, lease_expires_at: null }] },
    ]);
    const r = await new MissionLedger(makePool(client)).claim(CLAIM);
    expect(r).toMatchObject({ claimed: false, reason: 'terminal' });
  });

  it('refuses a live lease as already_claimed', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [] },
      { match: /FOR UPDATE/, rows: [{ status: 'running', stage: 'RUNNING', attempt: 1, claim_generation: 1, lease_expires_at: new Date(Date.now() + 60000).toISOString() }] },
    ]);
    const r = await new MissionLedger(makePool(client)).claim(CLAIM);
    expect(r).toMatchObject({ claimed: false, reason: 'already_claimed' });
  });

  it('an expired transitional claim is NOT reclaimable — stale_claim for supervised recovery', async () => {
    const client = makeClient([
      { match: /INSERT INTO heidi_missions/, rows: [] },
      { match: /FOR UPDATE/, rows: [{ status: 'claimed', stage: 'DISPATCHED', attempt: 1, claim_generation: 1, lease_expires_at: new Date(Date.now() - 60000).toISOString() }] },
    ]);
    const r = await new MissionLedger(makePool(client)).claim(CLAIM);
    expect(r).toMatchObject({ claimed: false, reason: 'stale_claim' });
    // no UPDATE was even attempted for a transitional row
    expect(sqlOf(client).some((s) => /UPDATE heidi_missions/.test(s))).toBe(false);
  });
});

describe('MissionLedger.transition — fenced lifecycle writes', () => {
  const GEN = 3;
  const TRANS = { toStatus: 'running' as const, toStage: 'RUNNING', fromStage: 'DISPATCHED', evidence: {} };

  it('conditional update + receipt in one transaction', async () => {
    const client = makeClient([
      { match: /UPDATE heidi_missions/, rows: [{ attempt: 1, claim_generation: GEN }] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const r = await new MissionLedger(makePool(client)).transition('33333333-3333-3333-3333-333333333333', GEN, TRANS);
    expect(r).toEqual({ ok: true });
    const sql = sqlOf(client);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/UPDATE heidi_missions/);
    expect(sql[2]).toMatch(/INSERT INTO heidi_events/);
    expect(sql[3]).toBe('COMMIT');
    // generation + legal-predecessor guards are part of the write predicate
    expect(sql[1]).toMatch(/claim_generation=\$7/);
    expect(sql[1]).toMatch(/status = ANY\(\$8::text\[\]\)/);
    // 'running' is only legal from 'claimed'
    expect(client.calls[1].params[7]).toEqual(['claimed']);
  });

  it('stale generation is fenced — no state change, no receipt', async () => {
    const client = makeClient([
      { match: /UPDATE heidi_missions/, rows: [] },   // generation mismatch → 0 rows
    ]);
    const r = await new MissionLedger(makePool(client)).transition('33333333-3333-3333-3333-333333333333', GEN, TRANS);
    expect(r).toEqual({ ok: false, reason: 'fenced' });
    expect(sqlOf(client)).toContain('ROLLBACK');
    expect(sqlOf(client).some((s) => /INSERT INTO heidi_events/.test(s))).toBe(false);
  });

  it('infrastructure failure is reported as error, not fenced', async () => {
    const client = makeClient([
      { match: /UPDATE heidi_missions/, rows: [] },
    ]);
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      client.calls.push({ sql, params: params ?? [] });
      if (/UPDATE heidi_missions/.test(sql)) throw new Error('connection terminated');
      return { rows: [] };
    });
    const r = await new MissionLedger(makePool(client)).transition('33333333-3333-3333-3333-333333333333', GEN, TRANS);
    expect(r).toMatchObject({ ok: false, reason: 'error', error: 'connection terminated' });
    expect(sqlOf(client)).toContain('ROLLBACK');
  });
});

describe('MissionRunner dispatch — reservation + claim integration', () => {
  it('second concurrent dispatch loses the reservation race — one execution', async () => {
    let resolveClaim: ((v: unknown) => void) | undefined;
    const ledger = {
      claim: jest.fn(() => new Promise((r) => { resolveClaim = r; })),
      transition: jest.fn(async () => ({ ok: true })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, registry } = makeRunner(ledger);

    const d1 = runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    const d2 = runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);

    await expect(d2).resolves.toMatchObject({ dispatched: false, reason: 'already_running' });
    resolveClaim!({ claimed: true, missionId: '33333333-3333-3333-3333-333333333333', claimGeneration: 1, attempt: 1 });
    await expect(d1).resolves.toMatchObject({ dispatched: true, missionId: '33333333-3333-3333-3333-333333333333' });
    await new Promise((res) => setImmediate(res));
    expect(ledger.claim).toHaveBeenCalledTimes(1);
    expect(registry.execute).toHaveBeenCalledTimes(1);
  });

  it('successful run settles the mission row to succeeded via fenced finalize', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '44444444-4444-4444-4444-444444444444', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: true })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, registry, goals } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true, missionId: '44444444-4444-4444-4444-444444444444' });
    await new Promise((res) => setImmediate(res));
    expect(registry.execute).toHaveBeenCalledTimes(1);
    // RUNNING transition under generation 1
    expect(ledger.transition).toHaveBeenCalledWith('44444444-4444-4444-4444-444444444444', 1,
      expect.objectContaining({ toStatus: 'running', toStage: 'RUNNING' }));
    // VERIFYING transition then terminal SUCCEEDED
    expect(ledger.transition).toHaveBeenCalledWith('44444444-4444-4444-4444-444444444444', 1,
      expect.objectContaining({ toStatus: 'verifying', toStage: 'VERIFYING' }));
    expect(ledger.finalize).toHaveBeenCalledWith('44444444-4444-4444-4444-444444444444', 1,
      expect.objectContaining({ toStatus: 'succeeded', toStage: 'SUCCEEDED' }));
    expect(goals.updateGoal).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ status: 'completed' }));
  });

  it('a fenced RUNNING transition stops the worker before any capability effect', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '55555555-5555-5555-5555-555555555555', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: false, reason: 'fenced' })),
      finalize: jest.fn(async () => ({ ok: false, reason: 'fenced' })),
    };
    const { runner, registry, goals } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true, missionId: '55555555-5555-5555-5555-555555555555' });
    await new Promise((res) => setImmediate(res));
    // fenced before execute → no capability effects; goal marked
    // dispatch_blocked (work provably never ran — NOT reconciliation_pending)
    expect(registry.execute).not.toHaveBeenCalled();
    expect(goals.updateGoal).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ status: 'blocked', result: expect.stringContaining('dispatch_blocked') }));
    expect(goals.updateGoal).not.toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222', expect.objectContaining({ status: 'completed' }));
    expect(runner.stats().dispatchBlocked).toBe(1);
    expect(runner.stats().reconcilePending).toBe(0);
    expect(ledger.finalize).not.toHaveBeenCalled();
  });

  it('an infrastructure-error RUNNING transition blocks effects and marks dispatch_blocked', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '66666666-6666-6666-6666-666666666666', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: false, reason: 'error', error: 'connection terminated' })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, registry, lifecycle, goals } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true });
    await new Promise((res) => setImmediate(res));
    expect(registry.execute).not.toHaveBeenCalled();
    // diagnostic receipt carries infraError, not fenced
    expect(lifecycle.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: expect.objectContaining({ infraError: true }) }),
    );
    // pre-execution block → dispatch_blocked, not reconciliation_pending
    expect(goals.updateGoal).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ status: 'blocked', result: expect.stringContaining('dispatch_blocked') }));
    expect(goals.updateGoal).not.toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ result: expect.stringContaining('reconciliation_pending') }));
    expect(runner.stats().dispatchBlocked).toBe(1);
    expect(runner.stats().lastClaimError).toContain('transition:connection terminated');
  });

  it('a VERIFYING transition failure after capability success marks reconciliation_pending — never completed', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '77777777-7777-7777-7777-777777777777', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn()
        .mockResolvedValueOnce({ ok: true })                                  // RUNNING
        .mockResolvedValueOnce({ ok: false, reason: 'error', error: 'tx aborted' }), // VERIFYING fails
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, goals, registry } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true });
    await new Promise((res) => setImmediate(res));
    // capability DID run — outcome now unproven
    expect(registry.execute).toHaveBeenCalledTimes(1);
    // goal must NOT be completed — nothing durably records the success
    const statuses = goals.updateGoal.mock.calls.map((c) => c[1]?.status);
    expect(statuses).not.toContain('completed');
    expect(goals.updateGoal).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ status: 'blocked', result: expect.stringContaining('reconciliation_pending') }));
    expect(runner.stats().reconcilePending).toBe(1);
    // finalize never attempted — the prior transition didn't commit
    expect(ledger.finalize).not.toHaveBeenCalled();
  });

  it('goal-update failure after a successful claim releases slot AND releases the claim', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: true })),   // claim release → 'planned'
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, goals, registry } = makeRunner(ledger);
    goals.updateGoal.mockRejectedValueOnce(new Error('goals db down')); // in_progress write fails
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: false, reason: 'goal_claim_failed' });
    expect(registry.execute).not.toHaveBeenCalled();
    // mission released back to 'planned' — not silently stranded 'claimed'
    expect(ledger.transition).toHaveBeenCalledWith('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1,
      expect.objectContaining({ toStatus: 'planned', evidence: expect.objectContaining({ reason: 'goal_update_failed' }) }));
    expect(runner.stats().dispatchBlocked).toBe(1);
    // slot released — a later dispatch is not wedged on the placeholder
    const r2 = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r2).toMatchObject({ dispatched: true });
  });

  it('when claim release also fails, persistFailures counts it', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: false, reason: 'error', error: 'db down' })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, goals } = makeRunner(ledger);
    goals.updateGoal.mockRejectedValueOnce(new Error('goals db down'));
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: false, reason: 'goal_claim_failed' });
    const s = runner.stats();
    expect(s.persistFailures).toBe(1);
    expect(s.lastClaimError).toContain('claim release also failed');
  });

  it('when even the reconciliation write fails, persistFailures surfaces it', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '99999999-9999-9999-9999-999999999999', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: false, reason: 'error', error: 'db gone' })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, goals, lifecycle } = makeRunner(ledger);
    // Both the diagnostic receipt AND the goal write fail.
    lifecycle.recordTransition.mockRejectedValueOnce(new Error('events db down'));
    goals.updateGoal
      .mockResolvedValueOnce(null)                            // claim-goal update ok
      .mockRejectedValueOnce(new Error('goals db down'));     // dispatch_blocked write fails
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true });
    await new Promise((res) => setImmediate(res));
    const s = runner.stats();
    expect(s.persistFailures).toBe(2);                        // receipt + goal write
    expect(s.dispatchBlocked).toBe(1);
    expect(s.lastClaimError).toContain('goal-persist');
  });

  it('failed finalize marks the goal reconciliation_pending — never completed', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: '88888888-8888-8888-8888-888888888888', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: true })),
      finalize: jest.fn(async () => ({ ok: false, reason: 'error', error: 'tx aborted' })),
    };
    const { runner, goals, lifecycle } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true });
    await new Promise((res) => setImmediate(res));
    // goal must NOT be completed — settle didn't commit
    const statuses = goals.updateGoal.mock.calls.map((c) => c[1]?.status);
    expect(statuses).not.toContain('completed');
    expect(statuses).toContain('blocked');
    expect(goals.updateGoal).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222',
      expect.objectContaining({ result: expect.stringContaining('reconciliation_pending') }));
    expect(runner.stats().reconcilePending).toBe(1);
    void lifecycle;
  });

  it('refused claim releases the slot and reports the reason', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: false, missionId: null, claimGeneration: null, attempt: null, reason: 'awaiting_human' })),
      transition: jest.fn(async () => ({ ok: true })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner, registry } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: false, reason: 'claim_refused:awaiting_human' });
    expect(registry.execute).not.toHaveBeenCalled();
    // slot released → a later dispatch can proceed
    ledger.claim.mockResolvedValueOnce({ claimed: true, missionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', claimGeneration: 1, attempt: 1 });
    const r2 = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r2).toMatchObject({ dispatched: true, missionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' });
  });

  it('fails closed on claim error by default — no execution, honest reason', async () => {
    const err = Object.assign(new Error('relation "heidi_missions" does not exist'), { code: '42P01' });
    const ledger = { claim: jest.fn(async () => { throw err; }) };
    const { runner, registry, lifecycle } = makeRunner(ledger);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: false, reason: 'claim_unavailable:42P01' });
    expect(registry.execute).not.toHaveBeenCalled();
    expect(lifecycle.recordTransition).not.toHaveBeenCalled();
    // slot released → later dispatch can proceed when the ledger recovers
    ledger.claim.mockResolvedValueOnce({ claimed: true, missionId: 'm-9', claimGeneration: 1, attempt: 1 });
    const r2 = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r2).toMatchObject({ dispatched: true, missionId: 'm-9' });
  });

  it('uses the legacy path only when allowLegacyDispatch is explicitly set', async () => {
    const err = Object.assign(new Error('relation "heidi_missions" does not exist'), { code: '42P01' });
    const ledger = { claim: jest.fn(async () => { throw err; }) };
    const { runner, lifecycle, registry } = makeRunner(ledger, { allowLegacyDispatch: true });
    expect(runner.stats().legacyDispatchAllowed).toBe(true);
    const r = await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(r).toMatchObject({ dispatched: true });
    await new Promise((res) => setImmediate(res));
    expect(lifecycle.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toStage: 'DISPATCHED', evidence: expect.objectContaining({ legacyClaim: true }) }),
    );
    expect(registry.execute).toHaveBeenCalledTimes(1);
  });
});

describe('MissionLedger.reconcileExpiredClaims — stale-claim sweep', () => {
  const HOST = 'test-host';
  const dead = () => false;
  const alive = () => true;
  const ROW = (over: Record<string, unknown> = {}) => ({
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    claim_generation: 3, status: 'running',
    claimed_by: `heidi-daemon@${HOST}:4242`,
    capability_id: 'ops.test', ...over,
  });
  function sweepPool(scanRows: Rows, client: ReturnType<typeof makeClient>) {
    return {
      query: jest.fn(async () => ({ rows: scanRows })),
      connect: jest.fn(async () => client),
    } as any;
  }

  it('scans only expired transitional claims, bounded by maxRows', async () => {
    const client = makeClient([]);
    const pool = sweepPool([], client);
    await new MissionLedger(pool).reconcileExpiredClaims({ maxRows: 5, hostname: HOST, isAlive: dead });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/status IN \('claimed','running','verifying'\)[\s\S]*lease_expires_at < now\(\)/),
      [5],
    );
  });

  it('dead worker → fenced interrupt: timed_out + INTERRUPTED receipt in one tx', async () => {
    const client = makeClient([
      { match: /UPDATE heidi_missions/, rows: [{ claim_generation: 4 }] },
      { match: /INSERT INTO heidi_events/, rows: [] },
    ]);
    const pool = sweepPool([ROW()], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r).toMatchObject({ scanned: 1, interrupted: 1, alive: 0, ambiguous: 0, errors: 0 });
    const sql = sqlOf(client);
    expect(sql[0]).toBe('BEGIN');
    // fencing: generation predicate + generation increment, lease re-checked in tx
    expect(sql[1]).toMatch(/claim_generation=claim_generation\+1/);
    expect(sql[1]).toMatch(/claim_generation=\$3/);
    expect(sql[1]).toMatch(/lease_expires_at < now\(\)/);
    expect(sql[1]).toMatch(/status='timed_out'/);
    expect(sql[2]).toMatch(/INSERT INTO heidi_events/);
    expect(sql[3]).toBe('COMMIT');
    // receipt carries the interruption evidence, not a fabricated outcome
    const payload = JSON.parse(client.calls[2].params[0] as string);
    expect(payload.toStage).toBe('INTERRUPTED');
    expect(payload.claimGeneration).toBe(4);
    expect(payload.evidence).toMatchObject({
      interrupted: true, priorClaimGeneration: 3,
      deadWorker: `heidi-daemon@${HOST}:4242`,
    });
  });

  it('live worker is left untouched even with an expired lease', async () => {
    const client = makeClient([]);
    const pool = sweepPool([ROW()], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: alive });
    expect(r).toMatchObject({ scanned: 1, interrupted: 0, alive: 1 });
    expect(client.query).not.toHaveBeenCalled();   // no tx opened at all
  });

  it('ambiguous worker identity (no host:pid) → suspect, row untouched, batched evidence event', async () => {
    const client = makeClient([]);
    const pool = sweepPool([ROW({ claimed_by: 'heidi-daemon' })], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r).toMatchObject({ scanned: 1, ambiguous: 1, interrupted: 0 });
    expect(r.suspects).toEqual(['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']);
    expect(client.query).not.toHaveBeenCalled();   // no settle attempt
    // one mission_sweep visibility event via pool (not a mission mutation)
    const ev = (pool.query as jest.Mock).mock.calls
      .map((c) => c[0] as string).find((s) => /mission_sweep/.test(s));
    expect(ev).toBeDefined();
  });

  it('foreign-host worker identity is ambiguous — never trust a remote pid', async () => {
    const client = makeClient([]);
    const pool = sweepPool([ROW({ claimed_by: 'heidi-daemon@other-host:4242' })], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r.ambiguous).toBe(1);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('repeated sweep is idempotent: raced settle → ROLLBACK, no receipt', async () => {
    const client = makeClient([
      { match: /UPDATE heidi_missions/, rows: [] },   // another writer won
    ]);
    const pool = sweepPool([ROW()], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r.interrupted).toBe(0);
    expect(r.errors).toBe(0);
    const sql = sqlOf(client);
    expect(sql).toContain('ROLLBACK');
    expect(sql.some((s) => /INSERT INTO heidi_events/.test(s))).toBe(false);
  });

  it('settle DB failure → ROLLBACK, errors counted, row left transitional', async () => {
    const client = makeClient([]);
    client.query.mockImplementation(async (sql: string) => {
      client.calls.push({ sql, params: [] });
      if (/UPDATE heidi_missions/.test(sql)) throw new Error('connection lost');
      return { rows: [] };
    });
    const pool = sweepPool([ROW()], client);
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r.errors).toBe(1);
    expect(r.interrupted).toBe(0);
    expect(sqlOf(client)).toContain('ROLLBACK');
  });

  it('scan failure returns an error result without touching any row', async () => {
    const client = makeClient([]);
    const pool = {
      query: jest.fn(async () => { throw new Error('db down'); }),
      connect: jest.fn(async () => client),
    } as any;
    const r = await new MissionLedger(pool).reconcileExpiredClaims({ hostname: HOST, isAlive: dead });
    expect(r).toMatchObject({ scanned: 0, errors: 1 });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('MissionRunner.sweepStaleClaims', () => {
  it('aggregates sweep telemetry into stats()', async () => {
    const ledger = {
      claim: jest.fn(),
      transition: jest.fn(),
      finalize: jest.fn(),
      reconcileExpiredClaims: jest.fn(async () => ({
        scanned: 3, interrupted: 2, alive: 0, ambiguous: 1, errors: 0,
        suspects: ['x'],
      })),
    };
    const { runner } = makeRunner(ledger);
    await runner.sweepStaleClaims();
    const s = runner.stats();
    expect(s.sweepRuns).toBe(1);
    expect(s.sweepInterrupted).toBe(2);
    expect(s.sweepAmbiguous).toBe(1);
    expect(s.lastSweepAt).not.toBeNull();
    // passes the injected liveness + hostname to the ledger
    expect(ledger.reconcileExpiredClaims).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: expect.any(String), isAlive: expect.any(Function) }),
    );
  });

  it('sweep throw is contained to telemetry — never propagates', async () => {
    const ledger = {
      reconcileExpiredClaims: jest.fn(async () => { throw new Error('pool gone'); }),
    };
    const { runner } = makeRunner(ledger);
    await expect(runner.sweepStaleClaims()).resolves.toBeUndefined();
    expect(runner.stats().sweepErrors).toBe(1);
    expect(runner.stats().lastClaimError).toContain('sweep:');
  });

  it('dispatch stamps claimed_by with host:pid worker identity', async () => {
    const ledger = {
      claim: jest.fn(async () => ({ claimed: true, missionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', claimGeneration: 1, attempt: 1 })),
      transition: jest.fn(async () => ({ ok: true })),
      finalize: jest.fn(async () => ({ ok: true })),
    };
    const { runner } = makeRunner(ledger);
    await runner.dispatch('22222222-2222-2222-2222-222222222222', 'ops.test', {}, {} as any);
    expect(ledger.claim).toHaveBeenCalledWith(
      expect.objectContaining({ claimedBy: expect.stringMatching(/^heidi-daemon@.+:\d+$/) }),
    );
  });
});
