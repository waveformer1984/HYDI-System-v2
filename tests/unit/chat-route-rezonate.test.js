'use strict';

/**
 * Universal chat router — Rezonate handler + routing/auth guards.
 * Covers the previously-untested handleRezonateMessage path added on
 * feat/hydi-evolution-v4.
 */

const { createHmac } = require('crypto');

// Mock every module the route pulls in at import time.
const mockCounts = { rezonate_projects: 3, rezonate_tracks: 7 };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => ({
      select: jest.fn(async () => ({ count: mockCounts[table] ?? null, error: null })),
    })),
  })),
}));

jest.mock('../../lib/vercel/vercelAdmin.js', () => ({
  getLatestDeployment: jest.fn(),
  triggerRedeploy: jest.fn(),
  listEnvVars: jest.fn(),
  setEnvVar: jest.fn(),
  setupDeployHooks: jest.fn(),
  PROJECT_IDS: {},
}));

jest.mock('../../lib/termux/termuxClient.js', () => ({
  getSystemStatus: jest.fn(),
  isReachable: jest.fn(),
}));

// lib/claude is a .ts source imported as ./claude.js by the route (TS-ESM
// convention); mock it extensionless so it resolves the same way.
jest.mock('../../lib/claude', () => ({
  callAgent: jest.fn(),
  isClaudeAvailable: jest.fn(() => false),
}));

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const requestId = 'req-test-1';
  const service = 'jest';
  const sig = createHmac('sha256', secret)
    .update(`${ts}:${requestId}:${service}`)
    .digest('hex');
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

function makeReq({ message, system, token = makeServiceToken() } = {}) {
  return {
    method: 'POST',
    headers: { 'x-hydi-service-token': token },
    body: { message, system },
  };
}

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  handler = require('../../api/chat/route.js').default;
});

describe('chat router - Rezonate handler', () => {
  test('routes "project" messages to the project count', async () => {
    const res = makeRes();
    await handler(makeReq({ message: 'how many projects do we have', system: 'rezonate' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.system).toBe('rezonate');
    expect(payload.response).toContain('3 project(s) in workspace');
  });

  test('routes "track" messages to the track count', async () => {
    const res = makeRes();
    await handler(makeReq({ message: 'list track status', system: 'rezonate' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].response).toContain('7 track(s) recorded');
  });

  test('falls back to a usage hint for other messages', async () => {
    const res = makeRes();
    await handler(makeReq({ message: 'hello there', system: 'rezonate' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].response).toMatch(/Try 'project' or 'track'/);
  });
});

describe('chat router - guards', () => {
  test('rejects a missing service token with 401', async () => {
    const res = makeRes();
    await handler(makeReq({ message: 'x', system: 'rezonate', token: null }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects a token signed with the wrong secret with 401', async () => {
    const res = makeRes();
    await handler(
      makeReq({ message: 'x', system: 'rezonate', token: makeServiceToken('wrong-secret') }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects an unknown system with 400', async () => {
    const res = makeRes();
    await handler(makeReq({ message: 'x', system: 'not-a-system' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Unknown system/);
  });
});
