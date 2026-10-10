/**
 * POST /api/workspace/action kind='sell_offer' — the governed customer-
 * identity intake for CHECKOUT_READY offers.
 *
 * Contract under test: this surface never creates a job, checkout, or
 * payment. It creates a durable heidi_action_proposals row bound to the
 * exact offer + customer email (params-hash locked), which still requires
 * human approval through the consume-once proposal path.
 */

const mockCreateProposal = jest.fn();
const mockCollectOffers = jest.fn();
const mockVerifyToken = jest.fn();
const mockQuery = jest.fn(async () => ({ rows: [] }));

jest.mock('pg', () => {
  const PgPool = jest.fn(() => ({ query: (...a) => mockQuery(...a) }));
  return { __esModule: true, default: { Pool: PgPool }, Pool: PgPool };
});
jest.mock('../../lib/heidi/ActionProposals', () => ({
  createActionProposal: (...a) => mockCreateProposal(...a),
}));
jest.mock('../../lib/heidi/CommercialBridge', () => ({
  collectOffers: (...a) => mockCollectOffers(...a),
}));
jest.mock('../../lib/auth/verifyServiceToken', () => ({
  verifyServiceToken: (...a) => mockVerifyToken(...a),
}));

const handler = require('../../pages/api/workspace/action').default;

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}
function makeReq(body, token = 'tok') {
  return { method: 'POST', body, headers: token ? { 'x-hydi-service-token': token } : {}, socket: { remoteAddress: '127.0.0.1' } };
}

const OFFER = {
  offerId: 'offer-a2af7d584a91', opportunityId: 'opp-1', opportunityTitle: 'regression',
  product: 'protoforge_model_prep', priceCents: 2900, currency: 'usd', isTest: false,
  stage: 'CHECKOUT_READY', stageReason: null, evidenceSummary: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyToken.mockReturnValue({ valid: true });
  mockCollectOffers.mockResolvedValue([OFFER]);
  mockCreateProposal.mockResolvedValue({ id: 'prop-1234-uuid', existing: false });
});

describe('sell_offer — governed customer intake', () => {
  test('valid customer + CHECKOUT_READY offer → governed proposal bound to the offer', async () => {
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'buyer@customer.example' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.proposalId).toBe('prop-1234-uuid');
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
    const [pool, input] = mockCreateProposal.mock.calls[0];
    expect(input.capabilityId).toBe('revenue.advance_offer');
    expect(input.params).toEqual({ offerId: OFFER.offerId, customerEmail: 'buyer@customer.example' });
    expect(input.producerKey).toBe(`sell_offer:${OFFER.offerId}`);
  });

  test('no credentials → 401 before anything else runs', async () => {
    mockVerifyToken.mockReturnValue({ valid: false, reason: 'missing token' });
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'b@c.co' }, null), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockCreateProposal).not.toHaveBeenCalled();
    expect(mockCollectOffers).not.toHaveBeenCalled();
  });

  test('missing customer identity → 400, nothing proposed', async () => {
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toMatch(/customerEmail/);
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });

  test.each(['not-an-email', 'a@b', '@x.com', 'a b@c.com', 'a@b .com'])(
    'malformed customer email %p → 400', async (email) => {
      const res = makeRes();
      await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: email }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateProposal).not.toHaveBeenCalled();
    });

  test('nonexistent offer → 404 (no fabrication)', async () => {
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: 'offer-nope', customerEmail: 'b@c.co' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });

  test('offer past the customer boundary → 409 refused', async () => {
    mockCollectOffers.mockResolvedValue([{ ...OFFER, stage: 'PAID' }]);
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'b@c.co' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body.error).toMatch(/PAID/);
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });

  test('AUTHORIZATION_REQUIRED offer accepts customer identity', async () => {
    mockCollectOffers.mockResolvedValue([{ ...OFFER, stage: 'AUTHORIZATION_REQUIRED', stageReason: 'customer identity required' }]);
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'b@c.co' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
  });

  test('duplicate submission → deduped, no second proposal', async () => {
    mockCreateProposal.mockResolvedValue({ id: 'prop-existing', existing: true });
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'b@c.co' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.deduped).toBe(true);
  });

  test('test-fixture offer → 409 refused — not sellable inventory', async () => {
    mockCollectOffers.mockResolvedValue([{ ...OFFER, isTest: true }]);
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'real.customer@example.org' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body.error).toMatch(/test fixture/);
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });

  test('spec-invalid params refused closed by the proposal layer → 400', async () => {
    mockCreateProposal.mockRejectedValue(new Error('Proposal refused: params exceed size limit'));
    const res = makeRes();
    await handler(makeReq({ kind: 'sell_offer', offerId: OFFER.offerId, customerEmail: 'b@c.co' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toMatch(/refused/i);
  });
});
