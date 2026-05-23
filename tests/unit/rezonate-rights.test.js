/**
 * Unit tests for api/rezonate/rights.js
 *
 * Covers:
 *  - POST check: existing ownership returned
 *  - POST check: no ownership → { status: 'unverified' }
 *  - POST claim: upserts ownership record, returns it
 *  - POST submit: proxies to rezonate-fingerprint edge function
 *  - POST unknown action → 400
 *  - GET ?fingerprint_id=xxx → queries fingerprints + ownership, returns joined data
 *  - GET ?hash=xxx → finds fingerprint by hash then joins ownership
 *  - Supabase error → 500
 *
 * No live services required — @supabase/supabase-js and global fetch are
 * fully mocked.
 *
 * Mock design notes:
 *   - The rights handler calls supabase chains in several patterns:
 *       check:       from('rezonate_ownership').select('*,...').eq().maybeSingle()
 *       claim:       from('rezonate_ownership').upsert().select().single()
 *       GET by id:   from('rezonate_fingerprints').select().eq().single()
 *                    from('rezonate_ownership').select().eq().maybeSingle()
 *       GET by hash: from('rezonate_fingerprints').select().eq().maybeSingle()
 *                    (then repeats the GET-by-id flow)
 *   - We expose per-table mock factories so individual tests can preset
 *     return values without cross-contamination.
 *   - The handler attempts require('node-fetch') and falls back to global.fetch.
 *     We stub node-fetch to delegate to global.fetch.
 */

// ── Supabase chain mock ────────────────────────────────────────────────────────

// We need a flexible chain that supports both .single() and .maybeSingle().
// Each method returns `this` (chainable) until a terminal like single/maybeSingle
// returns a resolved Promise.
//
// Per-table preset results: mockResults['tableName'] = { data, error }
let mockResults = {};

// Track which tables were queried so tests can assert on call patterns.
let mockFromCalls = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(function mockFromImpl(tableName) {
      mockFromCalls.push(tableName);
      var preset = mockResults[tableName];

      // Build a terminal resolver that returns the preset for this table (or
      // a sensible default). We pop presets so each DB call gets its own result.
      function resolve() {
        if (Array.isArray(preset)) {
          // If preset is an array, shift the first item off for each call.
          var result = preset.shift();
          if (preset.length === 0) {
            delete mockResults[tableName];
          }
          return Promise.resolve(result || { data: null, error: null });
        }
        return Promise.resolve(preset !== undefined ? preset : { data: null, error: null });
      }

      var chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        upsert: jest.fn().mockReturnThis(),
        single: jest.fn(resolve),
        maybeSingle: jest.fn(resolve),
      };
      return chain;
    }),
  })),
}));

// ── node-fetch stub ───────────────────────────────────────────────────────────
// The handler does: try { fetchFn = require('node-fetch') } catch { fetchFn = fetch }
// node-fetch may not be installed in this repo.  Using { virtual: true } lets
// Jest create a virtual module so the handler's try-block succeeds and all
// outbound requests are intercepted by global.fetch.
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
const handler = require('../../api/rezonate/rights.js');

// ── reset mock state between tests ────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  mockResults = {};
  mockFromCalls = [];
});

// ── req/res helper ─────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair.
 *
 * @param {{ method?: string, body?: object|null, query?: object }} opts
 * @returns {{ req: object, res: object }}
 */
function buildReqRes({ method = 'POST', body = {}, query = {} } = {}) {
  var req = { method: method, body: body, query: query };
  var res = {
    _status: 200,
    _body: null,
    status: function (code) { this._status = code; return this; },
    json: function (payload) { this._body = payload; return this; },
    end: function () { return this; },
  };
  return { req: req, res: res };
}

// ── POST check ────────────────────────────────────────────────────────────────

describe('POST check — existing ownership', () => {
  it('returns the ownership record when ownership exists', async () => {
    var ownershipRecord = {
      fingerprint_id: 'fp1',
      user_id: 'u1',
      owner_name: 'Alice',
      status: 'unverified',
      rezonate_fingerprints: { id: 'fp1', hash: 'abc123' },
    };
    mockResults['rezonate_ownership'] = { data: ownershipRecord, error: null };

    var { req, res } = buildReqRes({
      body: { action: 'check', fingerprint_id: 'fp1' },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data).toEqual(ownershipRecord);
    expect(res._body.error).toBeNull();
  });

  it('queries the rezonate_ownership table with the correct fingerprint_id', async () => {
    mockResults['rezonate_ownership'] = {
      data: { fingerprint_id: 'fp2', user_id: 'u2' },
      error: null,
    };

    var { req, res } = buildReqRes({
      body: { action: 'check', fingerprint_id: 'fp2' },
    });

    await handler(req, res);

    expect(mockFromCalls).toContain('rezonate_ownership');
  });
});

describe('POST check — no ownership', () => {
  it('returns { status: "unverified" } when no ownership record exists', async () => {
    // maybeSingle() returns null data when no row matches.
    mockResults['rezonate_ownership'] = { data: null, error: null };

    var { req, res } = buildReqRes({
      body: { action: 'check', fingerprint_id: 'fp_unknown' },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data).toEqual({ status: 'unverified' });
    expect(res._body.error).toBeNull();
  });

  it('returns 400 when fingerprint_id is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'check' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });
});

describe('POST check — Supabase error', () => {
  it('returns 500 when Supabase returns an error for check', async () => {
    mockResults['rezonate_ownership'] = { data: null, error: { message: 'Query failed' } };

    var { req, res } = buildReqRes({
      body: { action: 'check', fingerprint_id: 'fp_err' },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.data).toBeNull();
    expect(res._body.error).toBe('Query failed');
  });
});

// ── POST claim ─────────────────────────────────────────────────────────────────

describe('POST claim', () => {
  it('upserts the ownership record and returns it on success', async () => {
    var upsertedRecord = {
      fingerprint_id: 'fp3',
      user_id: 'u3',
      owner_name: 'Bob',
      status: 'unverified',
    };
    mockResults['rezonate_ownership'] = { data: upsertedRecord, error: null };

    var { req, res } = buildReqRes({
      body: {
        action: 'claim',
        fingerprint_id: 'fp3',
        user_id: 'u3',
        owner_name: 'Bob',
      },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data).toEqual(upsertedRecord);
    expect(res._body.error).toBeNull();
    expect(mockFromCalls).toContain('rezonate_ownership');
  });

  it('sets status to "unverified" in the upserted record', async () => {
    // The handler always sets status: 'unverified' — return something to inspect.
    mockResults['rezonate_ownership'] = {
      data: { fingerprint_id: 'fp4', status: 'unverified' },
      error: null,
    };

    var { req, res } = buildReqRes({
      body: {
        action: 'claim',
        fingerprint_id: 'fp4',
        user_id: 'u4',
        owner_name: 'Carol',
      },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    // Returned record contains status 'unverified'.
    expect(res._body.data.status).toBe('unverified');
  });

  it('returns 400 when fingerprint_id is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'claim', user_id: 'u5', owner_name: 'Dave' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/fingerprint_id/i);
  });

  it('returns 400 when user_id is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'claim', fingerprint_id: 'fp5', owner_name: 'Eve' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/user_id/i);
  });

  it('returns 400 when owner_name is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'claim', fingerprint_id: 'fp6', user_id: 'u6' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/owner_name/i);
  });

  it('returns 500 when Supabase upsert returns an error', async () => {
    mockResults['rezonate_ownership'] = { data: null, error: { message: 'Upsert failed' } };

    var { req, res } = buildReqRes({
      body: {
        action: 'claim',
        fingerprint_id: 'fp7',
        user_id: 'u7',
        owner_name: 'Frank',
      },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Upsert failed');
  });
});

// ── POST submit ───────────────────────────────────────────────────────────────

describe('POST submit', () => {
  it('proxies to the rezonate-fingerprint edge function', async () => {
    var edgeResponse = { data: { fingerprint_id: 'fp_new' }, error: null };
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue(edgeResponse),
    });

    var { req, res } = buildReqRes({
      body: { action: 'submit', audio_base64: 'AAAA', project_id: 'pid1' },
    });

    await handler(req, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var fetchArgs = global.fetch.mock.calls[0];
    // URL must contain the rezonate-fingerprint function name.
    expect(fetchArgs[0]).toContain('rezonate-fingerprint');
    expect(fetchArgs[0]).toContain(process.env.SUPABASE_URL);
    // Method must be POST.
    expect(fetchArgs[1].method).toBe('POST');
    expect(res._status).toBe(200);
    expect(res._body).toEqual(edgeResponse);
  });

  it('includes audio_base64 in the body forwarded to the edge function', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue({ data: {}, error: null }),
    });

    var { req, res } = buildReqRes({
      body: { action: 'submit', audio_base64: 'BASE64DATA', project_id: 'pid2' },
    });

    await handler(req, res);

    var fetchArgs = global.fetch.mock.calls[0];
    var sentBody = JSON.parse(fetchArgs[1].body);
    expect(sentBody.audio_base64).toBe('BASE64DATA');
  });

  it('returns 400 when audio_base64 is missing', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'submit', project_id: 'pid3' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('relays non-200 status codes from the edge function', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 422,
      json: jest.fn().mockResolvedValue({ data: null, error: 'Invalid audio' }),
    });

    var { req, res } = buildReqRes({
      body: { action: 'submit', audio_base64: 'BAD' },
    });

    await handler(req, res);

    expect(res._status).toBe(422);
  });
});

// ── POST unknown action ───────────────────────────────────────────────────────

describe('POST unknown action', () => {
  it('returns 400 for an unrecognised action', async () => {
    var { req, res } = buildReqRes({
      body: { action: 'delete_everything' },
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown action/i);
  });

  it('returns 400 when action is absent from the body', async () => {
    var { req, res } = buildReqRes({ body: {} });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });
});

// ── GET ?fingerprint_id=xxx ────────────────────────────────────────────────────

describe('GET ?fingerprint_id=xxx', () => {
  it('returns fingerprint + ownership joined data on success', async () => {
    var fakeFingerprint = { id: 'fp8', hash: 'deadbeef', project_id: 'pid4' };
    var fakeOwnership = { fingerprint_id: 'fp8', owner_name: 'Grace', status: 'unverified' };

    // The handler calls getFingerprintWithOwnership which issues two DB queries:
    // 1. rezonate_fingerprints  → fakeFingerprint
    // 2. rezonate_ownership     → fakeOwnership
    mockResults['rezonate_fingerprints'] = { data: fakeFingerprint, error: null };
    mockResults['rezonate_ownership'] = { data: fakeOwnership, error: null };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { fingerprint_id: 'fp8' },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.error).toBeNull();
    expect(res._body.data.fingerprint).toEqual(fakeFingerprint);
    expect(res._body.data.ownership).toEqual(fakeOwnership);
  });

  it('returns 500 when the fingerprints query fails', async () => {
    mockResults['rezonate_fingerprints'] = { data: null, error: { message: 'FP error' } };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { fingerprint_id: 'fp_bad' },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.data).toBeNull();
    expect(res._body.error).toBe('FP error');
  });

  it('returns 500 when the ownership query fails', async () => {
    mockResults['rezonate_fingerprints'] = { data: { id: 'fp9', hash: 'abc' }, error: null };
    mockResults['rezonate_ownership'] = { data: null, error: { message: 'OW error' } };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { fingerprint_id: 'fp9' },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('OW error');
  });

  it('returns 400 when neither fingerprint_id nor hash are provided', async () => {
    var { req, res } = buildReqRes({
      method: 'GET',
      query: {},
    });

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });
});

// ── GET ?hash=xxx ─────────────────────────────────────────────────────────────

describe('GET ?hash=xxx', () => {
  it('finds fingerprint by hash then returns fingerprint + ownership', async () => {
    var fakeFingerprint = { id: 'fp10', hash: 'cafebabe' };
    var fakeOwnership = { fingerprint_id: 'fp10', owner_name: 'Heidi' };

    // The handler first does maybeSingle() on rezonate_fingerprints by hash,
    // then calls getFingerprintWithOwnership(fingerprint.id) which issues two
    // more queries. So rezonate_fingerprints is queried twice total; we use an
    // array preset to supply values for each call in order.
    mockResults['rezonate_fingerprints'] = [
      { data: fakeFingerprint, error: null },  // hash lookup
      { data: fakeFingerprint, error: null },  // id lookup inside getFingerprintWithOwnership
    ];
    mockResults['rezonate_ownership'] = { data: fakeOwnership, error: null };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { hash: 'cafebabe' },
    });

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data.fingerprint).toEqual(fakeFingerprint);
    expect(res._body.data.ownership).toEqual(fakeOwnership);
  });

  it('returns 404 when no fingerprint matches the hash', async () => {
    // maybeSingle() returns null data → no row found.
    mockResults['rezonate_fingerprints'] = { data: null, error: null };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { hash: 'notfound' },
    });

    await handler(req, res);

    expect(res._status).toBe(404);
    expect(res._body.data).toBeNull();
    expect(res._body.error).toBeTruthy();
  });

  it('returns 500 when the hash lookup itself fails in Supabase', async () => {
    mockResults['rezonate_fingerprints'] = { data: null, error: { message: 'Hash lookup error' } };

    var { req, res } = buildReqRes({
      method: 'GET',
      query: { hash: 'error_hash' },
    });

    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Hash lookup error');
  });
});
