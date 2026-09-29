/**
 * Unit tests for pages/api/client-dashboard.js's auth gate.
 *
 * Before this fix, api/client-dashboard.js returned per-project ledger
 * totals and fee breakdowns to anyone, with a wildcard CORS origin. It was
 * left unbridged for that reason (ISSUES_FOUND.md #54); it is now gated on
 * 'revenue:view' and bridged.
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

const mockFetchClientDashboard = jest.fn();

jest.mock('../../lib/dashboard/revenue-service', () => ({
  fetchClientDashboard: (...args) => mockFetchClientDashboard(...args),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../pages/api/client-dashboard.js').default;
});

beforeEach(() => {
  mockFetchClientDashboard.mockReset();
  require('../../lib/rate-limit').__reset();
});

describe('pages/api/client-dashboard.js', () => {
  it('rejects an unauthenticated request with 401 without touching the ledger', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: { project: 'rezonate' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockFetchClientDashboard).not.toHaveBeenCalled();
  });

  it('rejects a forged service token with 401', async () => {
    const res = makeRes();
    await handler({
      method: 'GET',
      headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') },
      query: { project: 'rezonate' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockFetchClientDashboard).not.toHaveBeenCalled();
  });

  it('returns the dashboard once a valid service token is presented', async () => {
    mockFetchClientDashboard.mockResolvedValue({ project: 'rezonate', gross: 100 });
    const res = makeRes();
    await handler({
      method: 'GET',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      query: { project: 'rezonate' },
    }, res);
    expect(mockFetchClientDashboard).toHaveBeenCalledWith('rezonate');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ project: 'rezonate', gross: 100 });
  });

  it('still requires a project code after authenticating', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('answers a CORS preflight without credentials', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockFetchClientDashboard).not.toHaveBeenCalled();
  });

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
