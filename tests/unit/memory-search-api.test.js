'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';
function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}
function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

const mockRows = [
  { id: 'm1', content: 'Decided to use Ollama for local inference', kind: 'episodic', tags: ['decision', 'infra'], importance_score: 0.9, created_at: '2026-07-10' },
  { id: 'm2', content: 'Chatted about the weather', kind: 'conversation', tags: [], importance_score: 0.1, created_at: '2026-07-11' },
];
const auditInserts = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'memory_audit_log') return { insert: jest.fn(async (row) => { auditInserts.push(row); return { error: null }; }) };
      if (table === 'memories') {
        return {
          select: jest.fn(() => {
            let rows = mockRows;
            const chain = {
              ilike: jest.fn((field, pattern) => {
                const needle = pattern.replace(/%/g, '').toLowerCase();
                rows = rows.filter((r) => String(r[field]).toLowerCase().includes(needle));
                return chain;
              }),
              eq: jest.fn((field, value) => { rows = rows.filter((r) => r[field] === value); return chain; }),
              gte: jest.fn((field, value) => { rows = rows.filter((r) => r[field] >= value); return chain; }),
              overlaps: jest.fn((field, values) => { rows = rows.filter((r) => r[field].some((v) => values.includes(v))); return chain; }),
              order: jest.fn(() => chain),
              limit: jest.fn(async () => ({ data: rows, error: null })),
            };
            return chain;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/memory/search.js').default;
});

beforeEach(() => {
  auditInserts.length = 0;
  require('../../lib/rate-limit').__reset();
});

describe('api/memory/search.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns all memories with no filters', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].memories).toHaveLength(2);
  });

  it('filters by free-text query', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { q: 'ollama' } }, res);
    expect(res.json.mock.calls[0][0].memories).toHaveLength(1);
    expect(res.json.mock.calls[0][0].memories[0].id).toBe('m1');
  });

  it('filters by minimum importance', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { min_importance: '0.5' } }, res);
    expect(res.json.mock.calls[0][0].memories).toHaveLength(1);
  });

  it('filters by tags', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { tags: 'decision' } }, res);
    expect(res.json.mock.calls[0][0].memories).toHaveLength(1);
  });

  it('logs a search audit row with the result count', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { q: 'ollama' } }, res);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].detail.result_count).toBe(1);
  });
});
