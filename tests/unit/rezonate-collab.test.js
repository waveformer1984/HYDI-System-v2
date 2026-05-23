/**
 * Unit tests for api/rezonate/collaborate.js
 *
 * Covers:
 *  - set_split: valid split upserted to rezonate_revenue_splits → 200
 *  - set_split: percentages summing > 100 → 400
 *  - get_split: queries DB, returns data
 *  - create_session: proxied to edge function (fetch called with correct URL)
 *  - join_session:   proxied to edge function
 *  - unknown action: 400
 *  - GET ?session_id=xxx: proxied to edge function
 *
 * No live services required — @supabase/supabase-js and global fetch are
 * fully mocked.
 *
 * Mock design notes:
 *   - Variables inside jest.mock() factories must be prefixed with "mock"
 *     (Jest hoisting rule).
 *   - The handler attempts `require('node-fetch')` and falls back to the
 *     global `fetch` when node-fetch is absent. We mock global.fetch directly
 *     and also stub out node-fetch so the try/catch in the handler uses our
 *     global mock regardless of whether node-fetch is installed.
 *   - Supabase chain: upsert/select/single for set_split;
 *                     select/eq/single for get_split.
 */

// ── Supabase chain mock ────────────────────────────────────────────────────────
const mockSingle = jest.fn();
const mockSelect = jest.fn().mockReturnThis();
const mockUpsert = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();

const mockFrom = jest.fn().mockReturnValue({
  select: mockSelect,
  upsert: mockUpsert,
  eq: mockEq,
  single: mockSingle,
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
  })),
}));

// ── node-fetch mock ───────────────────────────────────────────────────────────
// The handler does: try { fetchFn = require('node-fetch') } catch { fetchFn = fetch }
// node-fetch may not be installed in this repo.  Using { virtual: true } lets
// Jest create a virtual module so the handler's try-block succeeds and uses our
// spy rather than falling through to global.fetch with no interception point.
jest.mock('node-fetch', () => jest.fn((...args) => global.fetch(...args)), {
  virtual: true,
});

// ── global fetch mock ──────────────────────────────────────────────────────────
global.fetch = jest.fn();

// ── environment variables ──────────────────────────────────────────────────────
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
});

// ── load handler after mocks ───────────────────────────────────────────────────
const handler = require('../../api/rezonate/collaborate.js');

// ── reset state between tests ──────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();

  // Restore Supabase chain return values after clearAllMocks resets them.
  mockFrom.mockReturnValue({
    select: mockSelect,
    upsert: mockUpsert,
    eq: mockEq,
    single: mockSingle,
  });
  mockSelect.mockReturnThis();
  mockUpsert.mockReturnThis();
  mockEq.mockReturnThis();
});

// ── req/res helper ────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair and return both.
 *
 * @param {{ method?: string, body?: object|null, query?: object, headers?: object }} opts
 * @returns {{ req: object, res: object }}
 */
function buildReqRes({ method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  var req = { method: method, body: body, query: query, headers: headers };
  var res = {
    _status: 200,
    _body: null,
    status: function (code) { this._status = code; return this; },
    json: function (payload) { this._body = payload; return this; },
    end: function () { return this; },
  };
  return { req: req, res: res };
}

// ── set_split ─────────────────────────────────────────────────────────────────

describe('POST set_split', () => {
  it('upserts to rezonate_revenue_splits and returns 200 on valid split', async () => {
    var splitRecord = {
      session_id: 'sid1',
      split_config: [
        { user_id: 'u1', percentage: 60 },
        { user_id: 'u2', percentage: 40 },
      ],
    };
    mockSingle.mockResolvedValueOnce({ data: splitRecord, error: null });

    var { req, res } = buildReqRes({
      body: {
        action: 'set_split',
        session_id: 'sid1',
        split_config: [
          { user_id: 'u1', percentage: 60 },
          { user_id: 'u2', percentage: 40 },
        ],
      },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('rezonate_revenue_splits');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('returns 400 when split percentages sum > 100', async () => {
    var { req, res } = buildReqRes({
      body: {
        action: 'set_split',
        session_id: 'sid2',
        split_config: [
          { user_id: 'u1', percentage: 70 },
          { user_id: 'u2', percentage: 50 },
        ],
      },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/exceed/i);
    // DB must NOT have been touched.
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when split_config is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'set_split', session_id: 'sid3' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 400 when split_config is an empty array', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'set_split', session_id: 'sid4', split_config: [] },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when session_id is missing', async () => {
    var { req, res } = buildReqRes({
      body: {
        action: 'set_split',
        split_config: [{ user_id: 'u1', percentage: 50 }],
      },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 200 when percentages sum to exactly 100', async () => {
    mockSingle.mockResolvedValueOnce({ data: { session_id: 'sid5' }, error: null });

    var { req, res } = buildReqRes({
      body: {
        action: 'set_split',
        session_id: 'sid5',
        split_config: [
          { user_id: 'u1', percentage: 50 },
          { user_id: 'u2', percentage: 50 },
        ],
      },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
  });

  it('returns 500 when Supabase upsert returns an error', async () => {
    // Chain: upsert → select → single must all resolve; single carries the error.
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'DB failure' } });

    var { req, res } = buildReqRes({
      body: {
        action: 'set_split',
        session_id: 'sid6',
        split_config: [{ user_id: 'u1', percentage: 80 }],
      },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('DB failure');
  });
});

// ── get_split ─────────────────────────────────────────────────────────────────

describe('POST get_split', () => {
  it('queries DB and returns data on success', async () => {
    var fakeData = { session_id: 'sid10', split_config: [{ user_id: 'u1', percentage: 100 }] };
    // get_split chain: select → eq → single
    mockSingle.mockResolvedValueOnce({ data: fakeData, error: null });

    var { req, res } = buildReqRes({
      body: { action: 'get_split', session_id: 'sid10' },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data).toEqual(fakeData);
    expect(res._body.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('rezonate_revenue_splits');
    expect(mockEq).toHaveBeenCalledWith('session_id', 'sid10');
  });

  it('returns 400 when session_id is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'get_split' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 500 when Supabase select returns an error', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Read error' } });

    var { req, res } = buildReqRes({
      body: { action: 'get_split', session_id: 'sid11' },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Read error');
  });
});

// ── proxied POST actions (create_session, join_session) ───────────────────────

describe('POST create_session', () => {
  it('forwards the request body to the rezonate-collab edge function', async () => {
    var edgeResponse = { data: { session_id: 'sess_abc' }, error: null };
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue(edgeResponse),
    });

    var { req, res } = buildReqRes({
      body: { action: 'create_session', owner_id: 'u1', name: 'My Session' },
    });

    await handler(req, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);

    var fetchArgs = global.fetch.mock.calls[0];
    // First argument is the URL — must point at the rezonate-collab function.
    expect(fetchArgs[0]).toContain('rezonate-collab');
    expect(fetchArgs[0]).toContain(process.env.SUPABASE_URL);
    // Options.
    expect(fetchArgs[1].method).toBe('POST');

    // Handler relays whatever the edge function returned.
    expect(res._status).toBe(200);
    expect(res._body).toEqual(edgeResponse);
  });
});

describe('POST join_session', () => {
  it('proxies join_session to the rezonate-collab edge function', async () => {
    var edgeResponse = { data: { joined: true }, error: null };
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue(edgeResponse),
    });

    var { req, res } = buildReqRes({
      body: { action: 'join_session', session_id: 'sess_abc', user_id: 'u2' },
    });

    await handler(req, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var fetchArgs = global.fetch.mock.calls[0];
    expect(fetchArgs[0]).toContain('rezonate-collab');
    expect(fetchArgs[1].method).toBe('POST');
    expect(res._body).toEqual(edgeResponse);
  });

  it('relays a non-200 status code from the edge function', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 403,
      json: jest.fn().mockResolvedValue({ data: null, error: 'Forbidden' }),
    });

    var { req, res } = buildReqRes({
      body: { action: 'join_session', session_id: 'sess_abc', user_id: 'u2' },
    });

    await handler(req, res);

    expect(res._status).toBe(403);
  });
});

// ── unknown action ────────────────────────────────────────────────────────────

describe('POST unknown action', () => {
  it('returns 400 for an unknown action', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'explode' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown action/i);
  });

  it('returns 400 when action is absent', async () => {
    var { req, res } = buildReqRes({ body: {} });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });
});

// ── GET ?session_id=xxx ────────────────────────────────────────────────────────

describe('GET ?session_id=xxx', () => {
  it('proxies to the rezonate-collab edge function with session_id in the URL', async () => {
    var edgeResponse = { data: { session_id: 'sess_get' }, error: null };
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue(edgeResponse),
    });

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { session_id: 'sess_get' },
    });

    await handler(req, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var fetchArgs = global.fetch.mock.calls[0];
    // URL must include the function name and session_id param.
    expect(fetchArgs[0]).toContain('rezonate-collab');
    expect(fetchArgs[0]).toContain('session_id=sess_get');
    expect(fetchArgs[1].method).toBe('GET');
    expect(res._status).toBe(200);
    expect(res._body).toEqual(edgeResponse);
  });

  it('returns 400 when session_id query param is missing', async () => {
    var { req, res } = buildReqRes({
      method: 'GET',
      query: {},
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
