'use strict';

const path = require('path');

const mockInserts = [];

jest.mock('../../lib/store', () => ({
  getStore: () => ({
    isAvailable: () => true,
    from(table) {
      if (table === 'heidi_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
          insert: async (row) => {
            mockInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(table);
    },
  }),
}));

jest.mock('../../lib/heidi-mobile/guard.js', () => ({
  guard: (req, res, { methods }) => {
    if (!methods.includes(req.method)) {
      res.status(405).json({ error: 'method_not_allowed' });
      return { ok: false };
    }
    return { ok: true, session: { deviceId: 'test-device' } };
  },
}));

const handler = require('../../pages/api/heidi-mobile/outreach');

function mockReqRes({ method, body, headers = {} }) {
  const req = { method, body, headers: { ...headers, host: '127.0.0.1:3000' } };
  let status = 200;
  let json;
  const res = {
    setHeader: () => {},
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      json = payload;
      return this;
    },
  };
  return { req, res, get: () => ({ status, json }) };
}

describe('heidi-mobile outreach BFF', () => {
  beforeEach(() => {
    mockInserts.length = 0;
  });

  test('GET returns drafts from config without sending', async () => {
    const { req, res, get } = mockReqRes({ method: 'GET' });
    await handler(req, res);
    const out = get();
    expect(out.status).toBe(200);
    expect(Array.isArray(out.json.drafts)).toBe(true);
    expect(out.json.drafts.length).toBeGreaterThan(0);
    expect(mockInserts).toHaveLength(0);
    expect(path.join(process.cwd(), 'config', 'heidi-outreach-drafts.json')).toContain('heidi-outreach-drafts.json');
  });

  test('POST records outreach_decision only', async () => {
    const { req, res, get } = mockReqRes({
      method: 'POST',
      body: { draft_id: 'alamo-ranch-9814', builder: 'Alamo Ranch Builders LLC', decision: 'approve' },
      headers: { 'x-heidi-request': '1' },
    });
    await handler(req, res);
    const out = get();
    expect(out.status).toBe(201);
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].event_type).toBe('outreach_decision');
    expect(mockInserts[0].payload.decision).toBe('approve');
    expect(mockInserts[0].payload.draft_id).toBe('alamo-ranch-9814');
  });
});