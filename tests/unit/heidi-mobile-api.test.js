'use strict';

/**
 * Route-level tests for pages/api/heidi-mobile/*. HYDI is replaced by a fake
 * `fetch` that verifies every device token it receives, so these tests also
 * prove the BFF authenticates to HYDI the way requireAuth expects — and that
 * no service secret or signing key ever reaches the phone.
 */

const { EventEmitter } = require('events');
const { verifyDeviceTokenSignature, deriveSigningKey } = require('../../lib/auth/deviceAuth');
const { sealSession, COOKIE_NAME } = require('../../lib/heidi-mobile/session');

const SERVICE_SECRET = 'c'.repeat(64);
const RAW_DEVICE_SECRET = 'd'.repeat(64);
const SIGNING_KEY = deriveSigningKey(RAW_DEVICE_SECRET);
const DEVICE_ID = 'phone-test';
const ACTION_ID = '3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60';

// ── Fake HYDI ───────────────────────────────────────────────────────────
let routes;
let calls;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(chunks, { delayMs = 0, hang = false } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(c));
      }
      if (!hang) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function installFakeHydi() {
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const u = new URL(url);
    const token = init.headers && init.headers['x-hydi-device-token'];
    const auth = token ? verifyDeviceTokenSignature(token, SIGNING_KEY) : { valid: false };
    calls.push({ path: u.pathname + u.search, method: init.method || 'GET', headers: init.headers, body: init.body, auth });
    const handler = routes[`${init.method || 'GET'} ${u.pathname}`];
    if (!handler) return json(404, { error: 'not found' });
    return handler({ auth, body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal, path: u.pathname });
  });
}

const HEALTHY_SYSTEM = {
  health_score: 100,
  overall_status: 'healthy',
  subsystems: { hydi_core: { status: 'healthy', health_score: 100, last_heartbeat: new Date().toISOString() } },
  workers: [{ worker_id: 'w1', worker_type: 'jobs', status: 'idle', last_heartbeat: new Date().toISOString(), processed_count: 3, error_count: 0 }],
  recent_events: [],
  ts: new Date().toISOString(),
};

function requireDevice(handler) {
  return (ctx) => (ctx.auth.valid ? handler(ctx) : json(401, { error: 'Unauthorized', reason: 'signature mismatch' }));
}

function defaultRoutes() {
  return {
    'GET /api/health': () => json(200, { status: 'healthy', hydi_status: 'OK', trend_status: 'stable', escalation_level: 'OK', metrics: { jobs_queued: 1, jobs_failed: 0 }, cloud: { source: 'local' } }),
    'GET /api/status/system': requireDevice(() => json(200, HEALTHY_SYSTEM)),
    'GET /api/actions': requireDevice(() => json(200, { actions: [{ id: ACTION_ID, action_type: 'send_email', summary: 'needs review', created_at: new Date().toISOString() }] })),
    'POST /api/actions/:id': null,
    'GET /api/work-sessions': requireDevice(() => json(200, { sessions: [{ id: 's1', goal: 'Ship it', status: 'in_progress', current_task: 'build', completed_steps: 1, total_steps: 3 }], queue_depth: 2 })),
    'GET /api/agent-manager/control': requireDevice(() => json(200, { commands: [{ id: 'c1', worker_type: 'jobs', command: 'restart', status: 'failed', error_message: 'boom' }] })),
    'POST /api/agent-manager/control': requireDevice(({ body }) => json(202, { command: { id: 'c2', ...body, status: 'pending' } })),
    'GET /api/notifications': requireDevice(() => json(200, { notifications: [{ id: 'n1', category: 'task_completed', severity: 'info', title: 'Done', created_at: new Date().toISOString() }] })),
    [`POST /api/actions/${ACTION_ID}`]: requireDevice(({ body }) => json(200, { ok: true, status: body.decision === 'approve' ? 'completed' : 'failed', result: { secret_payload: 'raw tool output' } })),
  };
}

// ── Next-style req/res mocks ───────────────────────────────────────────
function cookieFor(session = { deviceId: DEVICE_ID, signingKey: SIGNING_KEY, pending: false }) {
  return `${COOKIE_NAME}=${sealSession(session)}`;
}

function makeReq({ method = 'GET', body, cookie = cookieFor(), headers = {}, query = {} } = {}) {
  const req = new EventEmitter();
  Object.assign(req, {
    method,
    body,
    query,
    headers: { host: 'heidi.test', ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'x-heidi-request': '1' } : {}), ...headers },
    socket: { remoteAddress: `10.0.0.${Math.floor(Math.random() * 250)}` },
  });
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.writableEnded = false;
  res.writableFinished = false;
  res.setHeader = jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; return res; });
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; res.writableEnded = true; res.writableFinished = true; return res; });
  res.writeHead = jest.fn((code, headers) => {
    res.statusCode = code;
    Object.entries(headers || {}).forEach(([k, v]) => { res.headers[k.toLowerCase()] = v; });
    return res;
  });
  res.flushHeaders = jest.fn();
  res.write = jest.fn((chunk) => { res.chunks.push(String(chunk)); return true; });
  res.end = jest.fn(() => { res.writableEnded = true; res.writableFinished = true; res.emit('close'); return res; });
  return res;
}

function sseEvents(res) {
  return res.chunks.join('').split('\n\n').filter((b) => b.startsWith('data: ') || b.includes('\ndata: '))
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)));
}

function load(name) {
  return require(`../../pages/api/heidi-mobile/${name}.js`).default;
}

async function call(name, reqOpts) {
  const req = makeReq(reqOpts);
  const res = makeRes();
  await load(name)(req, res);
  return res;
}

// ── Setup ──────────────────────────────────────────────────────────────
const savedEnv = { ...process.env };
const savedFetch = global.fetch;

beforeEach(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.HYDI_API_URL = 'http://hydi.test';
  process.env.NODE_ENV = 'test';
  routes = defaultRoutes();
  installFakeHydi();
  require('../../lib/rate-limit').__reset();
  require('../../lib/heidi-mobile/guard').resetApprovalCache();
});

afterAll(() => {
  process.env = savedEnv;
  global.fetch = savedFetch;
});

function expectNoSecrets(res) {
  const text = JSON.stringify(res.body || '') + res.chunks.join('') + JSON.stringify(res.headers);
  expect(text).not.toContain(SERVICE_SECRET);
  expect(text).not.toContain(SIGNING_KEY);
  expect(text).not.toContain(RAW_DEVICE_SECRET);
}

// ── Guard / security ───────────────────────────────────────────────────
describe('heidi-mobile guard', () => {
  it('rejects every data route without a paired session', async () => {
    for (const name of ['status', 'tasks', 'activity', 'events']) {
      const res = await call(name, { cookie: null });
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('not_paired');
    }
    const chat = await call('chat', { method: 'POST', cookie: null, body: { message: 'hi', session_id: 'abcdefgh1' } });
    expect(chat.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a forged/tampered session cookie', async () => {
    const res = await call('status', { cookie: `${COOKIE_NAME}=${'A'.repeat(80)}` });
    expect(res.statusCode).toBe(401);
  });

  it('rejects state-changing requests without the x-heidi-request header (CSRF)', async () => {
    const req = makeReq({ method: 'POST', body: { id: ACTION_ID, decision: 'approve' } });
    delete req.headers['x-heidi-request'];
    const res = makeRes();
    await load('tasks')(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('csrf_rejected');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests even with the header', async () => {
    const res = await call('control', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: { worker_type: 'jobs', command: 'stop', confirm: true },
    });
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marks responses no-store', async () => {
    const res = await call('status');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── Session / pairing ──────────────────────────────────────────────────
describe('POST /api/heidi-mobile/session', () => {
  it('pairs an approved device and never echoes the secret or signing key', async () => {
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: RAW_DEVICE_SECRET } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ paired: true, approved: true, device_id: DEVICE_ID });
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(calls[0].auth.valid).toBe(true);
    expectNoSecrets(res);
  });

  it('pairs a pending device and reports it as not yet approved', async () => {
    routes['GET /api/status/system'] = () => json(401, { error: 'Unauthorized', reason: 'device not approved' });
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: RAW_DEVICE_SECRET } });
    expect(res.body).toMatchObject({ paired: true, approved: false });
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('refuses wrong credentials without setting a cookie', async () => {
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: 'e'.repeat(64) } });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('pairing_rejected');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('reports HYDI unreachable during pairing as 502, not as bad credentials', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: RAW_DEVICE_SECRET } });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('network');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('validates input shape before contacting HYDI', async () => {
    const r1 = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: '../../etc', secret: RAW_DEVICE_SECRET } });
    const r2 = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: 'short' } });
    expect(r1.statusCode).toBe(400);
    expect(r2.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requests access by registering a pending device, keeping the secret server-side', async () => {
    routes['POST /api/devices'] = ({ body }) => json(201, { device: { device_id: body.device_id, status: 'pending' }, secret: RAW_DEVICE_SECRET });
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'request', device_name: 'Pixel <script>' } });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ paired: true, approved: false, device_name: 'Pixel script' });
    const registration = JSON.parse(calls[0].body);
    expect(registration).toMatchObject({ action: 'register', requested_role: 'operator' });
    expect(calls[0].headers['x-hydi-service-token']).toBeUndefined();
    expectNoSecrets(res);
  });

  it('refuses to issue sessions when HYDI_SERVICE_SECRET is missing', async () => {
    delete process.env.HYDI_SERVICE_SECRET;
    const res = await call('session', { method: 'POST', cookie: null, body: { action: 'pair', device_id: DEVICE_ID, secret: RAW_DEVICE_SECRET } });
    expect(res.statusCode).toBe(503);
  });

  it('GET reports paired state; DELETE clears the cookie', async () => {
    const g = await call('session');
    expect(g.body).toMatchObject({ paired: true, device_id: DEVICE_ID });
    expectNoSecrets(g);
    const d = await call('session', { method: 'DELETE' });
    expect(d.headers['set-cookie']).toContain('Max-Age=0');
    const none = await call('session', { cookie: null });
    expect(none.body).toMatchObject({ paired: false, session_available: true });
  });
});

// ── Status ─────────────────────────────────────────────────────────────
describe('GET /api/heidi-mobile/status', () => {
  it('reports online only for an authenticated, healthy snapshot', async () => {
    const res = await call('status');
    expect(res.statusCode).toBe(200);
    expect(res.body.state).toBe('online');
    expect(res.body.system.subsystems[0]).toMatchObject({ name: 'hydi_core', status: 'healthy' });
    expect(res.body.errors).toEqual([]);
    expect(calls.find((c) => c.path === '/api/status/system').auth.valid).toBe(true);
  });

  it('reports degraded when HYDI says so', async () => {
    routes['GET /api/status/system'] = requireDevice(() => json(200, { ...HEALTHY_SYSTEM, overall_status: 'degraded', health_score: 70 }));
    const res = await call('status');
    expect(res.body.state).toBe('degraded');
  });

  it('reports degraded (not online) when the snapshot is malformed', async () => {
    routes['GET /api/status/system'] = requireDevice(() => json(200, { hello: 'world' }));
    const res = await call('status');
    expect(res.body.state).toBe('degraded');
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'system', kind: 'malformed' })]));
  });

  it('reports offline when HYDI is unreachable', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const res = await call('status');
    expect(res.statusCode).toBe(200);
    expect(res.body.state).toBe('offline');
    expect(res.body.api.reachable).toBe(false);
    expect(res.body.system).toBeNull();
  });

  it('reports pending_approval / unauthorized from HYDI auth failures', async () => {
    routes['GET /api/status/system'] = () => json(401, { error: 'Unauthorized', reason: 'device not approved' });
    expect((await call('status')).body.state).toBe('pending_approval');
    routes['GET /api/status/system'] = () => json(401, { error: 'Unauthorized', reason: 'device revoked' });
    expect((await call('status')).body.state).toBe('unauthorized');
  });

  it('reports degraded when HYDI errors internally', async () => {
    routes['GET /api/status/system'] = () => json(500, { error: 'db down' });
    const res = await call('status');
    expect(res.body.state).toBe('degraded');
    expect(res.body.errors[0]).toMatchObject({ kind: 'server', message: 'db down' });
  });
});

// ── Tasks ──────────────────────────────────────────────────────────────
describe('/api/heidi-mobile/tasks', () => {
  it('loads approvals, work sessions and command history', async () => {
    const res = await call('tasks');
    expect(res.body.approvals).toMatchObject({ ok: true, data: [{ id: ACTION_ID, action_type: 'send_email' }] });
    expect(res.body.work).toMatchObject({ ok: true, data: { queue_depth: 2 } });
    expect(res.body.commands.data[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('reports a failed section as failed rather than empty', async () => {
    routes['GET /api/actions'] = () => json(500, { error: 'actions table missing' });
    const res = await call('tasks');
    expect(res.body.approvals).toEqual({ ok: false, error: expect.objectContaining({ kind: 'server' }) });
    expect(res.body.work.ok).toBe(true);
  });

  it('approves a task and strips raw executor output', async () => {
    const res = await call('tasks', { method: 'POST', body: { id: ACTION_ID, decision: 'approve' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, id: ACTION_ID, decision: 'approve', status: 'completed', error: null });
    expect(JSON.stringify(res.body)).not.toContain('raw tool output');
  });

  it('rejects a task', async () => {
    const res = await call('tasks', { method: 'POST', body: { id: ACTION_ID, decision: 'reject' } });
    expect(res.body).toMatchObject({ ok: true, decision: 'reject' });
  });

  it('passes through a failed operation from HYDI', async () => {
    routes[`POST /api/actions/${ACTION_ID}`] = requireDevice(() => json(400, { error: 'Action is not awaiting approval' }));
    const res = await call('tasks', { method: 'POST', body: { id: ACTION_ID, decision: 'approve' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Action is not awaiting approval');
  });

  it('passes through an unauthorized operation (RBAC) as 403', async () => {
    routes[`POST /api/actions/${ACTION_ID}`] = () => json(403, { error: 'Forbidden', reason: "role 'viewer' lacks permission 'actions:approve'" });
    const res = await call('tasks', { method: 'POST', body: { id: ACTION_ID, decision: 'approve' } });
    expect(res.statusCode).toBe(403);
    expect(res.body.reason).toContain('actions:approve');
  });

  it('rejects unsafe task ids and unknown decisions before contacting HYDI', async () => {
    for (const body of [
      { id: '../../devices', decision: 'approve' },
      { id: `${ACTION_ID}?x=1`, decision: 'approve' },
      { id: ACTION_ID, decision: 'delete' },
    ]) {
      const res = await call('tasks', { method: 'POST', body });
      expect(res.statusCode).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Control ────────────────────────────────────────────────────────────
describe('POST /api/heidi-mobile/control', () => {
  it('queues an allowed, confirmed command through HYDI', async () => {
    const res = await call('control', { method: 'POST', body: { worker_type: 'jobs', worker_id: 'w1', command: 'restart', confirm: true } });
    expect(res.statusCode).toBe(202);
    expect(res.body.command).toMatchObject({ id: 'c2', command: 'restart', status: 'pending' });
    expect(calls[0].auth.valid).toBe(true);
  });

  it('refuses unconfirmed, unsupported or malformed commands', async () => {
    const cases = [
      { worker_type: 'jobs', command: 'restart' },
      { worker_type: 'jobs', command: 'scale_up', confirm: true },
      { worker_type: 'jobs', command: 'shutdown', confirm: true },
      { worker_type: 'jobs; rm -rf /', command: 'stop', confirm: true },
    ];
    for (const body of cases) {
      const res = await call('control', { method: 'POST', body });
      expect(res.statusCode).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Chat ───────────────────────────────────────────────────────────────
describe('POST /api/heidi-mobile/chat', () => {
  const body = { message: 'status?', session_id: 'abcdefgh12' };

  it('streams a successful reply as normalized events ending in done', async () => {
    routes['POST /api/chat'] = ({ body: b }) => {
      expect(b.user_id).toBe(`heidi-mobile:${DEVICE_ID}`);
      return sseResponse([
        'data: {"type":"metadata","model_used":"heidi-runtime"}\n\n',
        'data: {"type":"content","content":"All "}\n\ndata: {"type":"con',
        'tent","content":"good"}\n\n',
        'data: {"type":"tool","tool":{"type":"create_task","status":"completed","result":{"leak":"x"}}}\n\n',
        'data: [DONE]\n\n',
      ]);
    };
    const res = await call('chat', { method: 'POST', body });
    expect(res.statusCode).toBe(200);
    const events = sseEvents(res);
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('All good');
    expect(events).toContainEqual({ type: 'meta', model: 'heidi-runtime' });
    expect(events).toContainEqual({ type: 'tool', name: 'create_task', status: 'completed', error: null });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    expect(res.chunks.join('')).not.toContain('leak');
    expectNoSecrets(res);
  });

  it('reports backend failure (HTTP 500) as an error, not a reply', async () => {
    routes['POST /api/chat'] = () => json(500, { error: 'Internal server error', message: 'orchestrator exploded' });
    const res = await call('chat', { method: 'POST', body });
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: 'server', message: 'orchestrator exploded' });
    expect(res.chunks).toEqual([]);
  });

  it('reports a mid-stream backend error event', async () => {
    routes['POST /api/chat'] = () => sseResponse(['data: {"type":"content","content":"Part"}\n\n', 'data: {"type":"error","error":"model crashed"}\n\n']);
    const res = await call('chat', { method: 'POST', body });
    const events = sseEvents(res);
    expect(events[events.length - 1]).toEqual({ type: 'error', message: 'model crashed' });
  });

  it('reports a stream that ends without [DONE] as incomplete', async () => {
    routes['POST /api/chat'] = () => sseResponse(['data: {"type":"content","content":"Half a rep"}\n\n']);
    const res = await call('chat', { method: 'POST', body });
    const last = sseEvents(res).pop();
    expect(last).toMatchObject({ type: 'error', kind: 'incomplete' });
  });

  it('skips malformed upstream events and reports if nothing readable arrived', async () => {
    routes['POST /api/chat'] = () => sseResponse(['data: {not json\n\n', 'data: {"type":"mystery"}\n\n']);
    const res = await call('chat', { method: 'POST', body });
    const events = sseEvents(res);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', message: 'HYDI sent a reply Heidi could not read.' });
  });

  it('rejects a non-stream success body as malformed', async () => {
    routes['POST /api/chat'] = () => json(200, { response: 'not a stream' });
    const res = await call('chat', { method: 'POST', body });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('malformed');
  });

  it('returns 504 when HYDI never answers (timeout)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      routes['POST /api/chat'] = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      const req = makeReq({ method: 'POST', body });
      const res = makeRes();
      const p = load('chat')(req, res);
      await jest.advanceTimersByTimeAsync(95 * 1000);
      await p;
      expect(res.statusCode).toBe(504);
      expect(res.body.error).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses chat for a device HYDI no longer accepts (authentication failure)', async () => {
    routes['GET /api/status/system'] = () => json(401, { error: 'Unauthorized', reason: 'device revoked' });
    routes['POST /api/chat'] = jest.fn();
    const res = await call('chat', { method: 'POST', body });
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('device revoked');
    expect(routes['POST /api/chat']).not.toHaveBeenCalled();
  });

  it('aborts the upstream call when the phone cancels', async () => {
    let upstreamSignal;
    routes['POST /api/chat'] = ({ signal }) => { upstreamSignal = signal; return sseResponse(['data: {"type":"content","content":"x"}\n\n'], { hang: true }); };
    const req = makeReq({ method: 'POST', body });
    const res = makeRes();
    const p = load('chat')(req, res);
    await new Promise((r) => setTimeout(r, 20));
    res.emit('close'); // phone closed the connection (Cancel)
    await p;
    expect(upstreamSignal.aborted).toBe(true);
  });

  it('validates message and session id', async () => {
    expect((await call('chat', { method: 'POST', body: { message: '   ', session_id: 'abcdefgh12' } })).statusCode).toBe(400);
    expect((await call('chat', { method: 'POST', body: { message: 'x'.repeat(4001), session_id: 'abcdefgh12' } })).statusCode).toBe(400);
    expect((await call('chat', { method: 'POST', body: { message: 'hi', session_id: 'bad id!' } })).statusCode).toBe(400);
  });
});

// ── Activity + events relay ────────────────────────────────────────────
describe('activity and realtime relay', () => {
  it('returns normalized notifications', async () => {
    const res = await call('activity');
    expect(res.body).toMatchObject({ unread_count: 1, notifications: [{ id: 'n1', title: 'Done', read: false }] });
  });

  it('relays HYDI events with the credential in a header, dropping malformed ones', async () => {
    routes['GET /api/events/stream'] = () => sseResponse([
      'event: connected\ndata: {"type":"connected","role":"owner"}\n\n',
      'data: not-json\n\n',
      'event: subsystem_status\ndata: {"type":"subsystem_status","subsystem":"memory","status":"degraded"}\n\n',
    ]);
    const res = await call('events');
    const events = sseEvents(res);
    expect(events[0]).toMatchObject({ type: 'connected' });
    expect(events[0].role).toBeUndefined();
    expect(events[1]).toMatchObject({ type: 'subsystem_status', subsystem: 'memory', status: 'degraded' });
    expect(events).toHaveLength(2);
    const upstream = calls.find((c) => c.path.startsWith('/api/events/stream'));
    expect(upstream.path).toBe('/api/events/stream');
    expect(upstream.auth.valid).toBe(true);
  });

  it('returns an error (not an empty stream) when HYDI refuses the stream', async () => {
    routes['GET /api/events/stream'] = () => json(401, { error: 'Unauthorized', reason: 'device revoked' });
    const res = await call('events');
    expect(res.statusCode).toBe(401);
  });
});
