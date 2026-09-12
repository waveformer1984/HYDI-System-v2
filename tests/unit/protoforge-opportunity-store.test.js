'use strict';

/**
 * opportunity-store tests against a mocked Supabase client -- no real
 * database connection. Real-DB behavior (constraints, RLS, triggers) is
 * covered by tests/migrations/20260916000000.test.js instead.
 */

const {
  upsertOpportunity, listOpportunities, setApproval, recordMissionRun,
} = require('../../lib/missions/opportunity-store');

/** Minimal chainable Supabase query-builder mock. */
function makeSupabaseMock({ existing = null, insertResult = { data: { id: 'new-id' }, error: null }, updateResult, selectListResult } = {}) {
  const calls = [];
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: existing, error: null })),
    single: jest.fn(async () => insertResult),
    insert: jest.fn((payload) => { calls.push({ op: 'insert', payload }); return builder; }),
    update: jest.fn((payload) => { calls.push({ op: 'update', payload }); return builder; }),
    then: undefined,
  };
  // list path resolves the builder itself as the final awaited value
  builder[Symbol.for('nodejs.util.inspect.custom')] = undefined;
  const supabase = {
    from: jest.fn(() => builder),
    _calls: calls,
    _builder: builder,
  };
  if (selectListResult) {
    builder.limit = jest.fn(async () => selectListResult);
  }
  if (updateResult) {
    builder.maybeSingle = jest.fn(async () => updateResult);
  }
  return supabase;
}

describe('opportunity-store: upsertOpportunity', () => {
  const record = {
    product: 'rezonate', dedupHash: 'abc123', title: 'x', whyItMatters: 'y', requiredAction: 'z',
    estimatedValue: 'unknown', confidence: 60, status: 'needs_review', sourceType: 'hn_algolia',
    evidence: [], scoringDetail: {}, discoveredAt: new Date().toISOString(),
  };

  it('inserts when no existing row matches the dedup hash', async () => {
    const supabase = makeSupabaseMock({ existing: null, insertResult: { data: { id: 'new-id' }, error: null } });
    const result = await upsertOpportunity(record, { supabase });
    expect(result).toEqual({ inserted: true, id: 'new-id' });
    expect(supabase._calls.some((c) => c.op === 'insert')).toBe(true);
  });

  it('skips insert (reports duplicate) when a row with the same dedup hash exists', async () => {
    const supabase = makeSupabaseMock({ existing: { id: 'existing-id' } });
    const result = await upsertOpportunity(record, { supabase });
    expect(result).toEqual({ inserted: false, duplicate: true, id: 'existing-id' });
    expect(supabase._calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('opportunity-store: listOpportunities', () => {
  it('returns the rows and throws a plain Error (not a Supabase error object) on failure', async () => {
    const ok = makeSupabaseMock({ selectListResult: { data: [{ id: '1' }, { id: '2' }], error: null } });
    const rows = await listOpportunities({ limit: 10 }, { supabase: ok });
    expect(rows).toHaveLength(2);

    const failing = makeSupabaseMock({ selectListResult: { data: null, error: { message: 'boom' } } });
    await expect(listOpportunities({}, { supabase: failing })).rejects.toThrow('boom');
  });
});

describe('opportunity-store: setApproval', () => {
  it('rejects an invalid approval_status value before touching the database', async () => {
    const supabase = makeSupabaseMock();
    await expect(setApproval('id', 'not-a-real-status', 'human', { supabase }))
      .rejects.toThrow(/invalid approval_status/);
    expect(supabase._calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('accepts approved/rejected and records approved_by', async () => {
    const supabase = makeSupabaseMock({ updateResult: { data: { id: 'x', approval_status: 'approved', approved_by: 'human' }, error: null } });
    const result = await setApproval('id', 'approved', 'human', { supabase });
    expect(result.approval_status).toBe('approved');
    const updateCall = supabase._calls.find((c) => c.op === 'update');
    expect(updateCall.payload.approval_status).toBe('approved');
    expect(updateCall.payload.approved_by).toBe('human');
  });

  it('throws when no matching row exists', async () => {
    const supabase = makeSupabaseMock({ updateResult: { data: null, error: null } });
    await expect(setApproval('missing-id', 'approved', 'human', { supabase })).rejects.toThrow(/no opportunity/);
  });
});

describe('opportunity-store: recordMissionRun', () => {
  it('writes every field a run needs for verification', async () => {
    const supabase = makeSupabaseMock({ insertResult: { data: { id: 'run-1', run_at: '2026-01-01T00:00:00Z' }, error: null } });
    const result = await recordMissionRun({ status: 'success', opportunitiesFound: 3, briefingText: 'brief' }, { supabase });
    expect(result).toEqual({ id: 'run-1', run_at: '2026-01-01T00:00:00Z' });
    const insertCall = supabase._calls.find((c) => c.op === 'insert');
    expect(insertCall.payload.status).toBe('success');
    expect(insertCall.payload.opportunities_found).toBe(3);
  });
});
