/**
 * Unit tests for lib/webhook-idempotency.js -- the claim/settle lease that
 * guards every Stripe webhook consumer against replays.
 *
 * The behaviour under test exists because a claim that is taken and never
 * settled turns replay protection into silent data loss: the failed delivery
 * returns 5xx, Stripe retries, the retry re-claims, sees the abandoned row,
 * and is answered "duplicate" -- so the event is dropped while every dashboard
 * reports success. These tests pin the three outcomes that keeps correct:
 * claim-vs-duplicate-vs-error, completion on success, release on failure.
 */

const {
  claimWebhookEvent,
  completeWebhookEvent,
  releaseWebhookEvent,
  STATUS_COMPLETED,
} = require('../../lib/webhook-idempotency');

/** Minimal Supabase stub covering just `.rpc()` and `.from().update|delete().eq()`. */
function makeSupabase({ rpcResult, updateResult = { error: null }, deleteResult = { error: null } } = {}) {
  const calls = { rpc: [], update: [], delete: [], eq: [] };

  const table = {
    update(patch) {
      calls.update.push(patch);
      this._op = 'update';
      return this;
    },
    delete() {
      calls.delete.push(true);
      this._op = 'delete';
      return this;
    },
    eq(column, value) {
      calls.eq.push([column, value]);
      return this._op === 'delete' ? deleteResult : updateResult;
    },
  };

  return {
    calls,
    rpc: jest.fn(async (name, args) => {
      calls.rpc.push([name, args]);
      return rpcResult;
    }),
    from: jest.fn(() => ({ ...table })),
  };
}

describe('claimWebhookEvent', () => {
  it('claims an unseen event and returns the row id', async () => {
    const supabase = makeSupabase({ rpcResult: { data: 'claim_abc', error: null } });

    const result = await claimWebhookEvent(supabase, { eventId: 'evt_1', type: 'invoice.paid' });

    expect(result).toEqual({ claimed: true, duplicate: false, claimId: 'claim_abc' });
    expect(supabase.calls.rpc[0]).toEqual([
      'claim_webhook_event',
      { p_event_id: 'evt_1', p_type: 'invoice.paid' },
    ]);
  });

  it('reports a duplicate when the RPC returns no row', async () => {
    const supabase = makeSupabase({ rpcResult: { data: null, error: null } });

    const result = await claimWebhookEvent(supabase, { eventId: 'evt_1', type: 'invoice.paid' });

    expect(result).toEqual({ claimed: false, duplicate: true, claimId: null });
  });

  it('throws on an RPC error instead of reporting a duplicate', async () => {
    // Regression: reading a failed RPC as "already processed" answers Stripe
    // 200 during a Supabase outage, cancelling every retry for a live payment.
    const supabase = makeSupabase({
      rpcResult: { data: null, error: { message: 'connection refused' } },
    });

    await expect(
      claimWebhookEvent(supabase, { eventId: 'evt_1', type: 'invoice.paid' })
    ).rejects.toThrow(/evt_1.*connection refused/);
  });
});

describe('completeWebhookEvent', () => {
  it('marks the claim terminal so genuine duplicates stay suppressed', async () => {
    const supabase = makeSupabase();

    await expect(completeWebhookEvent(supabase, 'claim_abc')).resolves.toBe(true);

    expect(supabase.from).toHaveBeenCalledWith('webhook_events');
    expect(supabase.calls.update[0]).toEqual({ status: STATUS_COMPLETED });
    expect(supabase.calls.eq[0]).toEqual(['id', 'claim_abc']);
  });

  it('merges caller-supplied columns alongside the status', async () => {
    const supabase = makeSupabase();

    await completeWebhookEvent(supabase, 'claim_abc', { task_id: 'task_1' });

    expect(supabase.calls.update[0]).toEqual({ status: STATUS_COMPLETED, task_id: 'task_1' });
  });

  it('is a no-op without a claim id', async () => {
    const supabase = makeSupabase();

    await expect(completeWebhookEvent(supabase, null)).resolves.toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('never throws when the update fails -- a settled delivery must not 500', async () => {
    const supabase = makeSupabase({ updateResult: { error: { message: 'write timeout' } } });

    await expect(completeWebhookEvent(supabase, 'claim_abc')).resolves.toBe(false);
  });

  it('never throws when the client itself throws', async () => {
    const supabase = {
      from: jest.fn(() => {
        throw new Error('client exploded');
      }),
    };

    await expect(completeWebhookEvent(supabase, 'claim_abc')).resolves.toBe(false);
  });
});

describe('releaseWebhookEvent', () => {
  it('deletes the claim so a Stripe retry can re-claim the event', async () => {
    // Deleting (rather than marking failed) is load-bearing: claim_webhook_event
    // dedupes with ON CONFLICT DO NOTHING, so any surviving row -- whatever its
    // status -- keeps answering retries with "duplicate".
    const supabase = makeSupabase();

    await expect(releaseWebhookEvent(supabase, 'claim_abc', 'ledger insert failed')).resolves.toBe(
      true
    );

    expect(supabase.from).toHaveBeenCalledWith('webhook_events');
    expect(supabase.calls.delete).toHaveLength(1);
    expect(supabase.calls.update).toHaveLength(0);
    expect(supabase.calls.eq[0]).toEqual(['id', 'claim_abc']);
  });

  it('is a no-op without a claim id', async () => {
    const supabase = makeSupabase();

    await expect(releaseWebhookEvent(supabase, null)).resolves.toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the delete errors', async () => {
    const supabase = makeSupabase({ deleteResult: { error: { message: 'permission denied' } } });

    await expect(releaseWebhookEvent(supabase, 'claim_abc')).resolves.toBe(false);
  });

  it('reports failure without throwing when the client throws', async () => {
    const supabase = {
      from: jest.fn(() => {
        throw new Error('client exploded');
      }),
    };

    await expect(releaseWebhookEvent(supabase, 'claim_abc')).resolves.toBe(false);
  });
});
