/**
 * Unit tests for pages/api/actions/[id].ts's auth gate.
 *
 * Before this fix, POST /api/actions/:id let anyone approve or reject a
 * ProtoForge-escalated action with zero authentication -- the whole point
 * of escalating an action for human review was defeated. See
 * ISSUES_FOUND.md. Token construction follows tests/unit/rezonate.test.js,
 * since this route is now gated by the same requireAuth() middleware.
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
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

const mockResolvePendingAction = jest.fn();
jest.mock('../../lib/action-approval', () => ({
  resolvePendingAction: (...args) => mockResolvePendingAction(...args),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../pages/api/actions/[id]').default;
});

beforeEach(() => {
  mockResolvePendingAction.mockReset();
  require('../../lib/rate-limit').__reset();
});

describe('pages/api/actions/[id].ts', () => {
  it('rejects an unauthenticated approval attempt with 401 and never resolves the action', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', headers: {}, query: { id: 'action-1' }, body: { decision: 'approve' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockResolvePendingAction).not.toHaveBeenCalled();
  });

  it('rejects a request signed with the wrong secret with 401', async () => {
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') },
        query: { id: 'action-1' },
        body: { decision: 'approve' },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockResolvePendingAction).not.toHaveBeenCalled();
  });

  it('resolves the action once a valid service token is presented', async () => {
    mockResolvePendingAction.mockResolvedValue({ ok: true, status: 'completed' });
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-hydi-service-token': makeServiceToken() },
        query: { id: 'action-1' },
        body: { decision: 'approve' },
      },
      res
    );
    expect(mockResolvePendingAction).toHaveBeenCalledWith('action-1', 'approve');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still returns 405 for non-POST methods even when authenticated', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { id: 'action-1' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
