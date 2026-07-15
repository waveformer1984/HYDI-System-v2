/**
 * Unit tests for api/client-dashboard.js.
 *
 * Regression guard for a real finding: this route returned the full
 * per-project financial ledger (gross revenue, fees, net, monthly
 * breakdown, pending payouts) to *any* unauthenticated caller who supplied
 * a `?project=` query param — and project codes are the six
 * publicly-documented revenue stream names from CLAUDE.md, so this was a
 * full revenue-transparency leak. See ISSUES_FOUND.md.
 *
 * Auth token construction follows tests/unit/agent-manager-control.test.js,
 * since this route is now gated by the same requireAuth() middleware.
 */
'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const requestId = 'req-1';
  const service = 'jest';
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
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
      if (table === 'auth_audit_log') {
        return { insert: jest.fn(async () => ({ error: null })) };
      }
      if (table === 'ledger') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(async () => ({ data: [], error: null })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

describe('api/client-dashboard.js', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
    handler = require('../../api/client-dashboard').default;
  });

  it('rejects an unauthenticated request with 401, never touching the ledger', async () => {
    const req = { method: 'GET', headers: {}, query: { project: 'galactic_bytes' }, socket: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with a bad signature with 401', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') },
      query: { project: 'galactic_bytes' },
      socket: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('serves the dashboard for a valid owner service token', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      query: { project: 'galactic_bytes' },
      socket: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ project: 'galactic_bytes' }));
  });

  it('still requires a project code once authenticated', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      query: {},
      socket: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
