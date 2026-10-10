/**
 * resolvePendingAction — the REAL approval-minting path (R2 contract).
 *
 * This is the only place an authorization is legitimately minted: a human
 * resolves a pending `actions` row that ProtoForge escalated. The R2 fix
 * requires the escalation to be backed by a real `decisions` row (decision =
 * 'escalate'), not merely a caller-set `protoforge_pending_approval` flag --
 * and it SIGNS the minted authorization so the chokepoint can verify it.
 *
 * Under test:
 *   - a genuine pending action backed by a real escalate decision resolves and
 *     mints a signed authorization that actually runs the action;
 *   - a pending row with no decision reference is refused (forged escalation);
 *   - a pending row whose decision does not exist is refused;
 *   - a pending row whose decision is not 'escalate' is refused.
 *
 * Supabase + fetch are stubbed; HYDI_APPROVAL_SECRET is set for signing.
 */

process.env.HYDI_APPROVAL_SECRET = process.env.HYDI_APPROVAL_SECRET || 'hydi-test-approval-secret';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { resolvePendingAction } from '../../lib/action-approval';
import { canonicalJson } from '../../lib/governance/approval-signing';

const mockCreateClient = createClient as jest.Mock;

// The R2 binding contract: decisions.hypothesis_id is
// sha256(session_id:planIndex:actionType:canonicalJson(actionPayload)) and the
// parked action row must carry the same fingerprint in
// protoforge_hypothesis_id + protoforge_plan_index. Build fixtures that are
// genuinely bound the way gateActions() produces them.
const SESSION_ID = 'sess-approval';
const PLAN_INDEX = 0;
const ACTION_TYPE = 'send_email';
const ACTION_PAYLOAD = { to: 'lead@example.com', subject: 'hi', body: 'x' };

function boundHypothesisId(): string {
  return createHash('sha256')
    .update(`${SESSION_ID}:${PLAN_INDEX}:${ACTION_TYPE}:${canonicalJson(ACTION_PAYLOAD)}`)
    .digest('hex');
}

function boundDecisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision-1',
    decision: 'escalate',
    hypothesis_id: boundHypothesisId(),
    outcome: null,
    ...overrides,
  };
}

interface StubOpts {
  actionRow?: Record<string, unknown> | null;
  decisionRow?: Record<string, unknown> | null;
}

function makeSupabase({ actionRow, decisionRow }: StubOpts) {
  const builder: any = {
    _table: '',
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    lt: () => builder,
    upsert: () => builder,
    single: async () => ({
      data: builder._table === 'decisions' ? decisionRow : actionRow,
      error: actionRow || builder._table === 'decisions' ? null : { message: 'not found' },
    }),
    maybeSingle: async () => ({
      data: builder._table === 'decisions' ? decisionRow : actionRow,
      error: null,
    }),
    then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
  };
  return { from: (table: string) => { builder._table = table; return builder; } };
}

function pendingActionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    session_id: SESSION_ID,
    status: 'pending',
    payload: {
      protoforge_pending_approval: true,
      protoforge_action_type: ACTION_TYPE,
      protoforge_action_payload: ACTION_PAYLOAD,
      protoforge_decision_id: 'decision-1',
      protoforge_hypothesis_id: boundHypothesisId(),
      protoforge_plan_index: PLAN_INDEX,
      ...overrides,
    },
  };
}

let fetchCalls: string[];
const realFetch = global.fetch;

beforeEach(() => {
  fetchCalls = [];
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'noreply@example.com';
  global.fetch = (async (url: any) => {
    fetchCalls.push(String(url));
    return { ok: true, json: async () => ({ id: 'email-1' }), text: async () => '' } as any;
  }) as any;
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe('resolvePendingAction — the genuine approval path', () => {
  test('a pending action backed by a real escalate decision resolves and sends (signed auth works end-to-end)', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow(),
      decisionRow: boundDecisionRow(),
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(true);
    // The signed authorization passed the chokepoint, so the email really sent.
    expect(fetchCalls.some((u) => u.includes('api.resend.com'))).toBe(true);
  });

  test('a pending row with NO decision reference is refused — the marker alone is forgeable', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow({ protoforge_decision_id: undefined }),
      decisionRow: null,
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/decision reference|forged/i);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a pending row whose decision does not exist is refused', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow(),
      decisionRow: null, // no matching decisions row
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not exist|forged/i);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a pending row whose decision is not an escalate verdict is refused', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow(),
      decisionRow: boundDecisionRow({ decision: 'approve' }), // not 'escalate'
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not 'escalate'|refus/i);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('resolvePendingAction — decision↔action binding (red-team 2026-09-18)', () => {
  test('a pending row missing its binding fields is refused — an escalation marker alone proves nothing', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow({ protoforge_hypothesis_id: undefined, protoforge_plan_index: undefined }),
      decisionRow: boundDecisionRow(),
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/binding|forged/i);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a decision produced for a DIFFERENT action cannot authorize this one — fingerprint mismatch', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow(),
      // An escalate decision exists, but for a different action (wrong fingerprint).
      decisionRow: boundDecisionRow({ hypothesis_id: 'f'.repeat(64) }),
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not produced for this action|mismatched/i);
    expect(fetchCalls).toHaveLength(0);
  });

  test('a parked row whose stored fingerprint does not match its own payload is refused', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      // Planted row: marker + real decision id, but a fabricated fingerprint.
      actionRow: pendingActionRow({ protoforge_hypothesis_id: 'e'.repeat(64) }),
      decisionRow: boundDecisionRow(),
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not produced for this action|mismatched/i);
    expect(fetchCalls).toHaveLength(0);
  });

  test('an already-resolved decision cannot be replayed onto a second parked action', async () => {
    mockCreateClient.mockReturnValue(makeSupabase({
      actionRow: pendingActionRow(),
      decisionRow: boundDecisionRow({ outcome: 'success' }), // already consumed
    }));
    const res = await resolvePendingAction('action-1', 'approve');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already resolved|replay|consumed/i);
    expect(fetchCalls).toHaveLength(0);
  });
});
