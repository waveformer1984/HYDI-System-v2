/**
 * Unit tests for api/rezonate/route.js
 *
 * Mocks @supabase/supabase-js and fs so no live services are required.
 * Follows the same mock pattern as tests/unit/stripe-connect-webhook.test.js.
 */

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

// ── environment variables ──────────────────────────────────────────────────────
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair and invoke the handler.
 * Returns the value passed to res.json / res.status(...).json.
 */
function buildReqRes({ method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  const req = { method, body, query, headers };
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

// Reset call counts between tests to keep assertions clean.
beforeEach(() => {
  jest.clearAllMocks();
  // Re-attach chained return values after clearAllMocks resets them.
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    eq: mockEq,
    single: mockSingle,
  });
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
      headers: { 'x-user-id': 'user_abc' },
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

    // Verify the inserted object carries the mandatory fields.
    const insertedArg = mockInsert.mock.calls[0][0];
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
