/**
 * Unit tests for api/rezonate/route.js
 *
 * Mocks @supabase/supabase-js and fs so no live services are required.
 * Follows the same mock pattern as tests/unit/stripe-connect-webhook.test.js.
 * Auth token construction follows tests/unit/agent-manager-control.test.js,
 * since this route is gated by the same requireAuth() middleware.
 */

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const requestId = 'req-1';
  const service = 'jest';
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

// ── Supabase mock ──────────────────────────────────────────────────────────────
// We build the chain mock once and expose helper references so individual
// tests can override return values where needed.
const mockSingle = jest.fn();
const mockSelect = jest.fn().mockReturnThis();
const mockInsert = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();

const mockFrom = jest.fn().mockReturnValue({
  select: mockSelect,
  insert: mockInsert,
  eq: mockEq,
  single: mockSingle,
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
  })),
}));

// ── fs mock ───────────────────────────────────────────────────────────────────
// Return a realistic config matching agents/rezonate_node/config.json so that
// node_manifest and dispatch_task validation work without touching the disk.
const FAKE_CONFIG = {
  node_type: 'rezonate',
  display_name: 'Rezonate DAW Node',
  version: '1.0.0',
  hydi_compatible: true,
  protoforge_node: true,
  capabilities: {
    audio_processing: true,
    nft_minting: true,
  },
  accepted_task_types: [
    'stem_analysis',
    'mix_analysis',
    'audio_export',
    'nft_mint',
    'rights_verify',
    'session_recall',
    'hardware_map',
    'beat_generate',
  ],
};

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => JSON.stringify(FAKE_CONFIG)),
}));
const fs = require('fs');

// ── environment variables ──────────────────────────────────────────────────────
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair and invoke the handler.
 * Returns the value passed to res.json / res.status(...).json.
 * Includes a valid x-hydi-service-token by default since the route is
 * gated by requireAuth(); pass headers to override/omit it explicitly.
 */
function buildReqRes({ method = 'POST', body = {}, query = {}, headers } = {}) {
  const req = { method, body, query, headers: headers || { 'x-hydi-service-token': makeServiceToken() } };
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      return this;
    },
  };
  return { req, res };
}

// Load the handler after mocks are in place.
const handler = require('../../api/rezonate/route.js');

// The chain object every `.select()`/`.insert()`/`.eq()` call resolves to by
// default (i.e. "keep chaining"). Reused below wherever a test needs to
// explicitly queue a pass-through link ahead of a resolving one, e.g. when
// an action now does an ownership-check query before its real query and
// both happen to call the same mocked method (see list_tracks below).
const chainSelf = { select: mockSelect, insert: mockInsert, eq: mockEq, single: mockSingle };

// Reset call counts *and* any queued once-implementations between tests --
// jest.clearAllMocks() only clears call history, not queued
// mockResolvedValueOnce/mockReturnValueOnce values, so a test that errors
// out before consuming all of its queued values could otherwise leak them
// into the next test. mockReset() clears both, but is only applied to the
// specific chain mocks below (not jest.resetAllMocks() globally) so it
// doesn't also wipe the @supabase/supabase-js / fs jest.mock() factory
// implementations declared above.
beforeEach(() => {
  jest.clearAllMocks();
  mockSingle.mockReset();
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockEq.mockReset();
  mockFrom.mockReset();
  // Re-attach chained return values after mockReset() clears them.
  mockFrom.mockReturnValue(chainSelf);
  mockSelect.mockReturnThis();
  mockInsert.mockReturnThis();
  mockEq.mockReturnThis();
});

// ── list_projects ──────────────────────────────────────────────────────────────
describe('list_projects', () => {
  it('returns supabase data for the requesting user', async () => {
    const fakeProjects = [{ id: 'proj_1', name: 'My Album', user_id: 'user_abc' }];
    // list_projects does NOT call .single(), it returns an array directly from select/eq.
    // Re-mock the from chain to resolve from eq().
    mockEq.mockResolvedValueOnce({ data: fakeProjects, error: null });

    const { req, res } = buildReqRes({
      body: { action: 'list_projects' },
      headers: { 'x-user-id': 'user_abc', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ data: fakeProjects, error: null });
    expect(mockFrom).toHaveBeenCalledWith('rezonate_projects');
  });

  it('returns supabase data when no user-id header is present', async () => {
    const fakeProjects = [{ id: 'proj_2', name: 'Global Track' }];
    // Without a user header, eq() is never called; the promise comes from select().
    mockSelect.mockResolvedValueOnce({ data: fakeProjects, error: null });

    const { req, res } = buildReqRes({ body: { action: 'list_projects' } });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.data).toEqual(fakeProjects);
  });
});

// ── create_project ─────────────────────────────────────────────────────────────
describe('create_project', () => {
  it('inserts a project and returns data on valid payload', async () => {
    const created = { id: 'proj_new', name: 'Beat Tape', tempo: 120, user_id: null };
    mockSingle.mockResolvedValueOnce({ data: created, error: null });

    const { req, res } = buildReqRes({
      body: {
        action: 'create_project',
        payload: { name: 'Beat Tape', tempo: 120, time_signature: '4/4', key_signature: 'C' },
      },
    });
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body).toEqual({ data: created, error: null });
    expect(mockFrom).toHaveBeenCalledWith('rezonate_projects');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('returns 400 when payload.name is missing', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'create_project', payload: { tempo: 130 } },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/name/i);
  });
});

// ── get_project ──────────────────────────────────────────────────────────────
describe('get_project', () => {
  it('returns the project when it belongs to the requesting user', async () => {
    const project = { id: 'proj_1', name: 'My Album', user_id: 'user_abc' };
    // First .single() call is the ownership check (projectBelongsToUser),
    // second is the actual fetch.
    mockSingle.mockResolvedValueOnce({ data: { user_id: 'user_abc' }, error: null });
    mockSingle.mockResolvedValueOnce({ data: project, error: null });

    const { req, res } = buildReqRes({
      body: { action: 'get_project', payload: { project_id: 'proj_1' } },
      headers: { 'x-user-id': 'user_abc', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ data: project, error: null });
  });

  it('returns 404 when the project belongs to a different user', async () => {
    // Ownership check finds no row scoped to this user.
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });

    const { req, res } = buildReqRes({
      body: { action: 'get_project', payload: { project_id: 'proj_1' } },
      headers: { 'x-user-id': 'someone_else', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(404);
    expect(mockSingle).toHaveBeenCalledTimes(1); // never reaches the real fetch
  });

  it('returns 400 when payload.project_id is missing', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'get_project', payload: {} },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/project_id/i);
  });
});

// ── list_tracks ────────────────────────────────────────────────────────────────
describe('list_tracks', () => {
  it('returns tracks when the parent project belongs to the requesting user', async () => {
    const tracks = [{ id: 'track_1', project_id: 'proj_1', name: 'Drums' }];
    mockSingle.mockResolvedValueOnce({ data: { user_id: 'user_abc' }, error: null }); // ownership check
    // eq() is called twice in this flow: once by the ownership check
    // (which must keep chaining into .single()) and once by list_tracks'
    // own query (which resolves the promise directly) -- queue both in call order.
    mockEq.mockReturnValueOnce(chainSelf); // ownership check's .eq('id', ...)
    mockEq.mockResolvedValueOnce({ data: tracks, error: null }); // list_tracks' own .eq('project_id', ...)

    const { req, res } = buildReqRes({
      body: { action: 'list_tracks', payload: { project_id: 'proj_1' } },
      headers: { 'x-user-id': 'user_abc', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ data: tracks, error: null });
  });

  it('returns 404 without querying tracks when the project belongs to a different user', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });

    const { req, res } = buildReqRes({
      body: { action: 'list_tracks', payload: { project_id: 'proj_1' } },
      headers: { 'x-user-id': 'someone_else', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalledWith('rezonate_tracks');
  });
});

// ── add_track ────────────────────────────────────────────────────────────────
describe('add_track', () => {
  it('inserts a track when the parent project belongs to the requesting user', async () => {
    const track = { id: 'track_new', project_id: 'proj_1', name: 'Bass', type: 'audio' };
    mockSingle.mockResolvedValueOnce({ data: { user_id: 'user_abc' }, error: null }); // ownership check
    mockSingle.mockResolvedValueOnce({ data: track, error: null }); // insert().select().single()

    const { req, res } = buildReqRes({
      body: { action: 'add_track', payload: { project_id: 'proj_1', name: 'Bass', type: 'audio' } },
      headers: { 'x-user-id': 'user_abc', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body).toEqual({ data: track, error: null });
  });

  it('returns 404 without inserting when the project belongs to a different user', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });

    const { req, res } = buildReqRes({
      body: { action: 'add_track', payload: { project_id: 'proj_1', name: 'Bass' } },
      headers: { 'x-user-id': 'someone_else', 'x-hydi-service-token': makeServiceToken() },
    });
    await handler(req, res);

    expect(res._status).toBe(404);
    // requireAuth's own audit logging also calls insert() (on
    // auth_audit_log) -- confirm no insert was made into rezonate_tracks
    // specifically, rather than asserting insert() was never called at all.
    expect(mockFrom).not.toHaveBeenCalledWith('rezonate_tracks');
  });

  it('returns 400 when required payload fields are missing', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'add_track', payload: { project_id: 'proj_1' } },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/project_id.*name|name.*project_id/i);
  });
});

// ── dispatch_task ──────────────────────────────────────────────────────────────
describe('dispatch_task', () => {
  it('inserts a pending job into actions table for a valid task_type', async () => {
    const jobRecord = {
      id: 'act_1',
      type: 'rezonate_task',
      task_type: 'stem_analysis',
      status: 'pending',
    };
    mockSingle.mockResolvedValueOnce({ data: jobRecord, error: null });

    const { req, res } = buildReqRes({
      body: {
        action: 'dispatch_task',
        payload: { task_type: 'stem_analysis', project_id: 'proj_1' },
      },
    });
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body.data).toMatchObject({ task_type: 'stem_analysis', status: 'pending' });
    expect(mockFrom).toHaveBeenCalledWith('actions');

    // Verify the inserted object carries the mandatory fields. requireAuth's
    // own audit logging also calls insert() (on auth_audit_log), so find the
    // actions-table insert by its shape rather than assuming call index 0.
    const insertedArg = mockInsert.mock.calls.map((call) => call[0]).find((arg) => arg && arg.task_type === 'stem_analysis');
    expect(insertedArg).toBeDefined();
    expect(insertedArg.type).toBe('rezonate_task');
    expect(insertedArg.status).toBe('pending');
    expect(insertedArg.task_type).toBe('stem_analysis');
  });

  it('returns 400 for an invalid task_type', async () => {
    const { req, res } = buildReqRes({
      body: {
        action: 'dispatch_task',
        payload: { task_type: 'launch_rockets', project_id: 'proj_1' },
      },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid task_type/i);
    // Database should NOT have been called.
    expect(mockFrom).not.toHaveBeenCalledWith('actions');
  });

  it('returns 400 when task_type is missing from payload', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'dispatch_task', payload: { project_id: 'proj_1' } },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/task_type/i);
  });
});

// ── node_manifest ──────────────────────────────────────────────────────────────
describe('node_manifest', () => {
  it('returns the static node config with expected top-level fields', async () => {
    const { req, res } = buildReqRes({ body: { action: 'node_manifest' } });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.error).toBeNull();

    const config = res._body.data;
    expect(config).toBeDefined();
    expect(config.node_type).toBe('rezonate');
    expect(config.capabilities).toBeDefined();
    expect(Array.isArray(config.accepted_task_types)).toBe(true);
    expect(config.accepted_task_types).toContain('stem_analysis');
  });
});

// ── authentication ───────────────────────────────────────────────────────────
describe('authentication', () => {
  it('rejects requests with no credentials', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'list_projects' },
      headers: {},
    });
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalledWith('rezonate_projects');
  });

  it('rejects requests with an invalid service token', async () => {
    const { req, res } = buildReqRes({
      body: { action: 'list_projects' },
      headers: { 'x-hydi-service-token': '123.req.jest.deadbeef' },
    });
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalledWith('rezonate_projects');
  });
});

// ── GET with unsupported action ────────────────────────────────────────────────
describe('GET requests', () => {
  it('returns 400 for an unsupported GET action', async () => {
    const { req, res } = buildReqRes({
      method: 'GET',
      query: { action: 'delete_everything' },
    });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown action/i);
  });
});

// ── POST without action ────────────────────────────────────────────────────────
describe('POST without action', () => {
  it('returns 400 when action is absent from request body', async () => {
    const { req, res } = buildReqRes({ body: {} });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/action is required/i);
  });

  it('returns 400 when body is null/undefined', async () => {
    const { req, res } = buildReqRes({ body: null });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/action is required/i);
  });
});
