/**
 * /api/proposals API contract tests — mocked durable layer, REAL auth
 * path (service token → requireAuth → role 'owner').
 *
 * The critical contract under test: the browser can only supply
 * {decision}. Browser-injected humanApproved / approvedHash / approvedBy
 * fields can never reach the durable layer — resolveProposal receives
 * exactly {id, decision, decidedBy} where decidedBy is derived from the
 * authenticated role server-side.
 */

const { createHmac } = require('crypto');
const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}
function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })),
  })),
}));

const mockResolve = jest.fn();
const mockList = jest.fn();
jest.mock('../../lib/heidi/ActionProposals', () => ({
  resolveProposal: (...args) => mockResolve(...args),
  listProposals: (...args) => mockList(...args),
  getProposalPool: jest.fn(() => ({})),
  PROPOSAL_ALLOWLIST: {
    'revenue.advance_offer': { label: 'Advance a commercial offer one governed step toward checkout/reconcile', params: 'offer_advance' },
  },
}));

const ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const handlerId = require('../../pages/api/proposals/[id]').default;
const handlerIndex = require('../../pages/api/proposals/index').default;

function makeReq(over = {}) {
  return {
    method: 'POST',
    query: { id: ID },
    body: { decision: 'approve' },
    headers: { 'x-hydi-service-token': makeServiceToken() },
    socket: { remoteAddress: '127.0.0.1' },
    ...over,
  };
}

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
afterAll(() => {
  delete process.env.HYDI_SERVICE_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
beforeEach(() => {
  jest.clearAllMocks();
  require('../../lib/rate-limit').__reset();
});

describe('POST /api/proposals/[id] — durable resolve', () => {
  it('approve → resolveProposal called with exactly {id, decision, decidedBy} — server-derived', async () => {
    mockResolve.mockResolvedValue({ ok: true, status: 'approved', goalId: 'goal-9' });
    const res = makeRes();
    await handlerId(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'approved', goalId: 'goal-9', decidedBy: 'user:owner' });
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), {
      id: ID, decision: 'approve', decidedBy: 'user:owner',
    });
  });

  it('browser-injected humanApproved / approvedHash / approvedBy are never forwarded', async () => {
    mockResolve.mockResolvedValue({ ok: true, status: 'approved', goalId: 'g' });
    const res = makeRes();
    await handlerId(makeReq({
      body: {
        decision: 'approve',
        humanApproved: true,
        approvedHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        approvedBy: 'user:god',
        decidedBy: 'user:god',
        capabilityId: 'revenue.advance_offer',
        params: { advanceAll: true },
        authorized: true,
      },
    }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // the durable layer saw ONLY the three server-derived fields
    const passed = mockResolve.mock.calls[0][1];
    expect(passed).toEqual({ id: ID, decision: 'approve', decidedBy: 'user:owner' });
    expect(Object.keys(passed).sort()).toEqual(['decidedBy', 'decision', 'id']);
  });

  it('reject → durable rejection path, no goal minted by UI', async () => {
    mockResolve.mockResolvedValue({ ok: true, status: 'rejected' });
    const res = makeRes();
    await handlerId(makeReq({ body: { decision: 'reject' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', goalId: null, decidedBy: 'user:owner' });
    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), {
      id: ID, decision: 'reject', decidedBy: 'user:owner',
    });
  });

  it('duplicate approval (consume-once refusal) → 400 with durable error', async () => {
    mockResolve.mockResolvedValue({ ok: false, error: 'Proposal already approved — approvals are consume-once' });
    const res = makeRes();
    await handlerId(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Proposal already approved — approvals are consume-once' });
  });

  it('stale/expired proposal → 400 with durable error, no execution', async () => {
    mockResolve.mockResolvedValue({ ok: false, error: 'Proposal expired' });
    const res = makeRes();
    await handlerId(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('invalid id format → 400 without touching the durable layer', async () => {
    const res = makeRes();
    await handlerId(makeReq({ query: { id: 'not-a-uuid' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('missing/invalid decision → 400', async () => {
    const res = makeRes();
    await handlerId(makeReq({ body: { decision: 'execute_anyway' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('no credentials → 401 AUTH boundary', async () => {
    const res = makeRes();
    await handlerId(makeReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('GET /api/proposals — durable list', () => {
  it('returns recommended + history from the durable layer with safe shape', async () => {
    mockList.mockResolvedValue({
      recommended: [{
        id: ID, version: 1, capability_id: 'revenue.advance_offer',
        params: { offerId: 'offer-x' }, params_hash: 'h', title: 'Advance offer',
        reason: 'approved opportunity', expected_effects: 'checkout link',
        risks: 'creates checkout', prerequisites: null, rollback: null,
        reversible: false, status: 'pending', producer_key: 'escalation:revenue.advance_offer',
        expires_at: '2026-10-05T00:00:00Z', decided_by: null, decided_at: null,
        approved_hash: null, goal_id: null, created_at: '2026-10-04T00:00:00Z',
      }],
      history: [],
    });
    const res = makeRes();
    await handlerId; // noop — ensure module loaded
    await handlerIndex(makeReq({ method: 'GET', query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.recommended).toHaveLength(1);
    expect(body.recommended[0]).toMatchObject({
      id: ID, capabilityId: 'revenue.advance_offer',
      capabilityLabel: expect.stringMatching(/advance/i),
      producerKey: 'escalation:revenue.advance_offer',
      status: 'pending',
    });
    // no durable internals leak: params_hash / approved_hash stay server-side
    expect(body.recommended[0].params_hash).toBeUndefined();
    expect(body.recommended[0].approvedHash).toBeUndefined();
  });

  it('no credentials → 401', async () => {
    const res = makeRes();
    await handlerIndex(makeReq({ method: 'GET', query: {}, headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockList).not.toHaveBeenCalled();
  });
});
