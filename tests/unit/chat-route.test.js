/**
 * Unit tests for api/chat/route.js — the universal chat router.
 *
 * Covers:
 * - HMAC service-token authentication (the primary auth gate)
 * - HTTP method guard
 * - Request validation (missing message / system)
 * - System routing: every named system receives its request, unknown systems are rejected
 *
 * All external dependencies (Supabase, Vercel admin, Termux, Claude) are mocked.
 */

'use strict';

const { createHmac } = require('crypto');

// ── External dependency mocks ─────────────────────────────────────────────────

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          current_status: 'OK',
          trend_status: 'stable',
          trend_reason: 'normal operation',
          escalation_level: 'OK',
          escalation_action: '',
          escalation_reason: '',
          jobs_queued: 0,
          jobs_failed: 0,
          jobs_dead: 0,
          events_last_hour: 5,
          auto_heals_24h: 0,
          avg_queue_size: 0,
          critical_pct: 0,
          warning_pct: 0,
        },
        error: null,
      }),
      insert: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
    }),
    rpc: jest.fn().mockResolvedValue({ data: { healed: 0, actions: [] }, error: null }),
  })),
}));

jest.mock('../../lib/vercel/vercelAdmin.js', () => ({
  getLatestDeployment: jest.fn().mockResolvedValue(null),
  triggerRedeploy: jest.fn().mockResolvedValue({ url: null, via: 'api' }),
  listEnvVars: jest.fn().mockResolvedValue([]),
  setEnvVar: jest.fn().mockResolvedValue({ action: 'created' }),
  setupDeployHooks: jest.fn().mockResolvedValue([]),
  PROJECT_IDS: { heidi: 'prj_heidi', hydi: 'prj_hydi' },
}));

jest.mock('../../lib/termux/termuxClient.js', () => ({
  getSystemStatus: jest.fn().mockResolvedValue({
    battery: { percentage: 80, status: 'charging' },
    storage: { available: '50GB' },
    uptime: '1 day, 2:00',
  }),
  isReachable: jest.fn().mockResolvedValue(true),
}));

// lib/claude.ts is auto-stubbed via moduleNameMapper in jest.config.js

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-service-secret-abc123';

/**
 * Generate a valid HMAC service token for the given service name.
 * Token format: `{timestamp}.{requestId}.{service}.{hmac_hex}`
 */
function makeValidToken(service = 'test-client', secret = TEST_SECRET, tsOffset = 0) {
  const ts = (Date.now() + tsOffset).toString();
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  const payload = `${ts}:${requestId}:${service}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

function makeReq({ method = 'POST', token = makeValidToken(), body = {} } = {}) {
  return {
    method,
    headers: { 'x-hydi-service-token': token },
    body,
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ── Load module under test ────────────────────────────────────────────────────

let handler;

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
  process.env.HYDI_SERVICE_SECRET = TEST_SECRET;

  // chat/route.js uses ESM export default — babel-jest transforms it to CJS
  const mod = require('../../api/chat/route.js');
  handler = mod.default || mod;
});

// ── Service token authentication ──────────────────────────────────────────────

describe('service token authentication', () => {
  it('returns 401 when no token is provided', async () => {
    const req = { method: 'POST', headers: {}, body: { message: 'hi', system: 'ursula' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.error).toBe('Unauthorized');
  });

  it('returns 401 when token has wrong number of parts', async () => {
    const req = makeReq({ token: 'not.a.valid.token.with.too.many.parts' });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token has only 3 parts (missing signature)', async () => {
    const req = makeReq({ token: '1234567890.reqId.service' });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when signature does not match', async () => {
    const ts = Date.now().toString();
    const wrongSig = 'a'.repeat(64); // 64 hex chars but wrong value
    const req = makeReq({ token: `${ts}.reqId.test-client.${wrongSig}` });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.reason).toMatch(/signature/i);
  });

  it('returns 401 when token timestamp is expired (> 5 minutes old)', async () => {
    const expiredToken = makeValidToken('test-client', TEST_SECRET, -(6 * 60 * 1000));
    const req = makeReq({ token: expiredToken });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.reason).toMatch(/expired|clock/i);
  });

  it('returns 401 when HYDI_SERVICE_SECRET is not configured', async () => {
    const savedSecret = process.env.HYDI_SERVICE_SECRET;
    delete process.env.HYDI_SERVICE_SECRET;

    const req = makeReq({ token: makeValidToken() });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    process.env.HYDI_SERVICE_SECRET = savedSecret;
  });

  it('proceeds past auth with a valid freshly-generated token', async () => {
    const req = makeReq({
      token: makeValidToken(),
      body: { message: 'status', system: 'ursula' },
    });
    const res = makeRes();
    await handler(req, res);
    // Should not be 401
    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});

// ── Method guard ──────────────────────────────────────────────────────────────

describe('HTTP method guard', () => {
  it('returns 405 for GET requests (even with valid token)', async () => {
    const req = makeReq({ method: 'GET', body: { message: 'hi', system: 'ursula' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

// ── Request validation ────────────────────────────────────────────────────────

describe('request body validation', () => {
  it('returns 400 when message is missing', async () => {
    const req = makeReq({ body: { system: 'ursula' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when system is missing', async () => {
    const req = makeReq({ body: { message: 'hello' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an unknown system name', async () => {
    const req = makeReq({ body: { message: 'hello', system: 'nonexistent_system' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.error).toMatch(/Unknown system/i);
  });
});

// ── System routing ────────────────────────────────────────────────────────────

const KNOWN_SYSTEMS = [
  'ursula',
  'heidi',
  'cascade',
  'kilo',
  'protoforge',
  'hyve',
  'infrastructure',
  'rezonate',
];

describe('system routing', () => {
  it.each(KNOWN_SYSTEMS)(
    'routes "%s" successfully (returns 200 with system echoed back)',
    async (system) => {
      const req = makeReq({ body: { message: 'status', system } });
      const res = makeRes();
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.system).toBe(system);
    }
  );

  it('includes a timestamp in every successful response', async () => {
    const req = makeReq({ body: { message: 'hello', system: 'ursula' } });
    const res = makeRes();
    await handler(req, res);
    const jsonArg = res.json.mock.calls[0][0];
    expect(typeof jsonArg.timestamp).toBe('string');
    expect(Date.parse(jsonArg.timestamp)).not.toBeNaN();
  });

  it('echoes the response from the underlying handler', async () => {
    const req = makeReq({ body: { message: 'hello', system: 'heidi' } });
    const res = makeRes();
    await handler(req, res);
    const jsonArg = res.json.mock.calls[0][0];
    // Heidi returns an object with { text, taskId } or a string
    expect(jsonArg.response).toBeDefined();
  });
});
