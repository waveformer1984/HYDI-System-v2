/**
 * Unit tests for the auth gate added to pages/api/revenue/{index,report,cycle,leads}.js.
 *
 * Before this fix, all four routes were fully unauthenticated: GET routes
 * exposed real revenue figures and lead PII, POST routes could trigger a
 * real revenue cycle, a real (cost-adjacent) lead scrape, or create a real
 * Stripe checkout session. See ISSUES_FOUND.md.
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

jest.mock('stripe', () => jest.fn(() => ({})));

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

beforeEach(() => {
  require('../../lib/rate-limit').__reset();
});

describe.each([
  ['pages/api/revenue/index.js', '../../pages/api/revenue/index.js', 'GET'],
  ['pages/api/revenue/report.js', '../../pages/api/revenue/report.js', 'GET'],
  ['pages/api/revenue/leads.js', '../../pages/api/revenue/leads.js', 'GET'],
  ['pages/api/revenue/cycle.js', '../../pages/api/revenue/cycle.js', 'POST'],
])('%s', (_name, modulePath, method) => {
  it(`rejects an unauthenticated ${method} request with 401`, async () => {
    const handler = require(modulePath).default;
    const res = makeRes();
    await handler({ method, headers: {}, query: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a request signed with the wrong secret with 401', async () => {
    const handler = require(modulePath).default;
    const res = makeRes();
    await handler(
      { method, headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') }, query: {}, body: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
