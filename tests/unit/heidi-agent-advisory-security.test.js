'use strict';

/**
 * Security regression tests for heidi-agent's advisory server and the
 * governance gate (PR #527 review findings).
 */

const http = require('http');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role';

const HeidiAgent = require('../../heidi-core/heidi-agent');
const {
  checkAdvisoryAuth,
  allowedCorsOrigin,
  bindHost,
  authorizeHumanApproval,
} = require('../../lib/governance/advisory-auth');
const { checkActionBounds, registeredActionTypes } = require('../../lib/governance/action-registry');
const { evaluateTripleGate, VERDICTS } = require('../../lib/governance/tripleGate');

const TOKEN = 'test-admin-token-1234567890';
const ENV_KEYS = [
  'HEIDI_ADMIN_TOKEN', 'HEIDI_ALLOW_EXEC', 'HEIDI_PAUSE', 'HEIDI_BIND_HOST',
  'HEIDI_ADVISORY_PORT', 'HEIDI_ADVISORY_ALLOWED_ORIGINS',
];
let savedEnv;
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------
// Minimal chainable Supabase stand-in: records updates/inserts, serves tasks.
function fakeSupabase(tasks) {
  const calls = { updates: [], inserts: [] };
  const client = {
    calls,
    from(table) {
      const q = {
        _op: 'select', _payload: null,
        select() { return q; },
        eq() { return q; },
        order() { return q; },
        limit() { return q; },
        single() { return q; },
        update(p) { q._op = 'update'; q._payload = p; return q; },
        insert(p) { calls.inserts.push({ table, row: p }); return Promise.resolve({ error: null }); },
        then(resolve, reject) {
          if (q._op === 'update') calls.updates.push({ table, patch: q._payload });
          const data = table === 'agent_bus' ? tasks : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return client;
}

function request(port, { method = 'GET', path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeAgent(tasks) {
  const agent = new HeidiAgent();
  agent.supabase = fakeSupabase(tasks);
  agent.decisionBounds = { auto_approve_threshold: 0.85, max_auto_approve_amount: 100 };
  agent.onFatal = jest.fn();
  return agent;
}

async function startOnFreePort(agent) {
  process.env.HEIDI_ADVISORY_PORT = '0';
  agent.startAdvisoryServer();
  await new Promise((r) => (agent.httpServer.listening ? r() : agent.httpServer.once('listening', r)));
  return agent.httpServer.address();
}

const TASK = { id: 't1', type: 'operational_decision', division: 'ops', payload: { action: 'x' }, confidence: 0.99, within_bounds: true };

describe('advisory server — authentication, binding, CORS', () => {
  let agent;
  afterEach(async () => {
    if (agent && agent.httpServer) await new Promise((r) => agent.httpServer.close(r));
    agent = null;
  });

  it('binds to 127.0.0.1 by default', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    agent = makeAgent([TASK]);
    const addr = await startOnFreePort(agent);
    expect(addr.address).toBe('127.0.0.1');
  });

  it('refuses every request with 503 when no admin token is configured', async () => {
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { method: 'POST', path: '/api/decisions/t1/approve' });
    expect(r.status).toBe(503);
    expect(agent.supabase.calls.updates).toHaveLength(0);
  });

  it('rejects approve without a token (401) and executes nothing', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    process.env.HEIDI_ALLOW_EXEC = 'true';
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { method: 'POST', path: '/api/decisions/t1/approve' });
    expect(r.status).toBe(401);
    expect(agent.supabase.calls.updates).toHaveLength(0);
  });

  it('rejects a wrong token (401)', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { path: '/api/decisions/pending', headers: { authorization: 'Bearer nope' } });
    expect(r.status).toBe(401);
  });

  it('never sends Access-Control-Allow-Origin: * and ignores unlisted origins', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { path: '/api/decisions/pending', headers: { origin: 'https://evil.example' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(port, { method: 'OPTIONS', path: '/api/decisions/t1/approve', headers: { origin: 'https://evil.example' } });
    expect(pre.status).toBe(403);
  });

  it('echoes only an explicitly allowed origin', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    process.env.HEIDI_ADVISORY_ALLOWED_ORIGINS = 'http://127.0.0.1:3100';
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { method: 'OPTIONS', path: '/api/decisions/t1/approve', headers: { origin: 'http://127.0.0.1:3100' } });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3100');
  });

  it('with a valid token, approval still refuses when HEIDI_ALLOW_EXEC is off', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    agent = makeAgent([TASK]);
    const { port } = await startOnFreePort(agent);
    const r = await request(port, { method: 'POST', path: '/api/decisions/t1/approve', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).gate).toBe('exec_flag');
    expect(agent.supabase.calls.updates.some((u) => u.patch.status === 'executing')).toBe(false);
  });

  it('fails loudly on EADDRINUSE', async () => {
    process.env.HEIDI_ADMIN_TOKEN = TOKEN;
    const blocker = http.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const { port } = blocker.address();
    agent = makeAgent([TASK]);
    process.env.HEIDI_ADVISORY_PORT = String(port);
    agent.startAdvisoryServer();
    await new Promise((r) => setTimeout(r, 100));
    expect(agent.onFatal).toHaveBeenCalledWith(expect.objectContaining({ code: 'EADDRINUSE' }));
    agent.httpServer = null;
    await new Promise((r) => blocker.close(r));
  });
});

describe('human approval honours exec flag, pause and registry', () => {
  it('refuses when paused, even with exec enabled', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    process.env.HEIDI_PAUSE = 'true';
    const agent = makeAgent([TASK]);
    const r = await agent.handleAdvisoryAction('t1', 'approve');
    expect(r.success).toBe(false);
    expect(r.gate).toBe('pause');
    expect(agent.supabase.calls.updates.some((u) => u.patch.status === 'executing')).toBe(false);
  });

  it('refuses unregistered action types', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const agent = makeAgent([{ ...TASK, type: 'rm_rf_everything' }]);
    const r = await agent.handleAdvisoryAction('t1', 'approve');
    expect(r.gate).toBe('action_registry');
  });

  it('executes a registered task when exec is on and not paused', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const agent = makeAgent([TASK]);
    const r = await agent.handleAdvisoryAction('t1', 'approve');
    expect(r.success).toBe(true);
    expect(r.executed).toBe(true);
  });

  it('authorizeHumanApproval is fail-closed', () => {
    expect(authorizeHumanApproval({ task: TASK, env: {} }).allowed).toBe(false);
    expect(authorizeHumanApproval({ task: null, env: { HEIDI_ALLOW_EXEC: 'true' } }).allowed).toBe(false);
    expect(authorizeHumanApproval({ task: TASK, env: { HEIDI_ALLOW_EXEC: 'true' } }).allowed).toBe(true);
  });
});

describe('advisory-auth helpers', () => {
  it('bindHost defaults to loopback', () => {
    expect(bindHost({})).toBe('127.0.0.1');
    expect(bindHost({ HEIDI_BIND_HOST: '100.64.0.5' })).toBe('100.64.0.5');
  });
  it('checkAdvisoryAuth needs a Bearer token', () => {
    const env = { HEIDI_ADMIN_TOKEN: TOKEN };
    expect(checkAdvisoryAuth({ headers: {} }, env).status).toBe(401);
    expect(checkAdvisoryAuth({ headers: { authorization: TOKEN } }, env).status).toBe(401);
    expect(checkAdvisoryAuth({ headers: { authorization: `Bearer ${TOKEN}` } }, env).ok).toBe(true);
  });
  it('allowedCorsOrigin returns null without a configured list', () => {
    expect(allowedCorsOrigin({ headers: { origin: 'http://x' } }, {})).toBeNull();
  });
});

describe('server-side bounds — tasks cannot declare themselves safe', () => {
  const BOUNDS = { auto_approve_threshold: 0.85, max_auto_approve_amount: 100 };

  it('checkActionBounds enforces the registry boundsKey', () => {
    expect(checkActionBounds('financial_approval', { amount: 50 }, BOUNDS).within).toBe(true);
    expect(checkActionBounds('financial_approval', { amount: 101 }, BOUNDS).within).toBe(false);
    expect(checkActionBounds('financial_approval', {}, BOUNDS).within).toBe(false);
    expect(checkActionBounds('financial_approval', { amount: -1 }, BOUNDS).within).toBe(false);
    expect(checkActionBounds('financial_approval', { amount: 5 }, { auto_approve_threshold: 0.85 }).within).toBe(false);
    expect(checkActionBounds('nope', { amount: 1 }, BOUNDS).within).toBe(false);
  });

  it('high-risk financial_approval never AUTO-APPROVEs, even in a non-sensitive division', () => {
    const r = evaluateTripleGate({
      execEnabled: 'true', bounds: BOUNDS, knownActions: registeredActionTypes(),
      task: { type: 'financial_approval', division: 'ops', confidence: 0.99, within_bounds: true, payload: { amount: 1 } },
    });
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.gate).toBe('high_risk');
  });

  it('registry is consulted even when the caller omits knownActions', () => {
    const r = evaluateTripleGate({
      execEnabled: 'true', bounds: BOUNDS,
      task: { type: 'rm_rf_everything', division: 'ops', confidence: 0.99, within_bounds: true },
    });
    expect(r.verdict).toBe(VERDICTS.BLOCK);
    expect(r.gate).toBe('action_registry');
  });

  it('the agent passes the payload, so its decision uses server-side bounds', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const agent = makeAgent([]);
    agent.retrieveRelevantFacts = async () => [];
    const d = await agent.makeDecision({ type: 'financial_approval', division: 'ops', confidence: 0.99, within_bounds: true, payload: { amount: 1 } });
    expect(d.verdict).toBe(VERDICTS.REVIEW);
  });
});
