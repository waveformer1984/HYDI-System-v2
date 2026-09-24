/**
 * api/life-flow/route.js used to construct and start a HYDISystem at module
 * load, so merely importing it started the control-plane feedback loop and
 * core loop (ISSUES_FOUND.md #35). It now does so on the first
 * authenticated request, once per process.
 */

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken() {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', SERVICE_SECRET).update(`${ts}:req-1:jest`).digest('hex');
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

function authedRequest(body = { type: 'system', subtype: 'status' }) {
  return { method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body };
}

const mockStart = jest.fn();
const mockProcessRequest = jest.fn();
const mockConstructor = jest.fn();

jest.mock('../../src/HYDISystem', () => jest.fn().mockImplementation((config) => {
  mockConstructor(config);
  return { start: mockStart, processRequest: mockProcessRequest };
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

beforeEach(() => {
  jest.isolateModules(() => {
    handler = require('../../api/life-flow/route.js').default;
  });
  mockConstructor.mockClear();
  mockStart.mockReset();
  mockProcessRequest.mockReset();
  mockProcessRequest.mockResolvedValue({ result: { ok: true }, requestId: 'r1', duration: 1 });
  require('../../lib/rate-limit').__reset();
});

describe('api/life-flow/route.js lazy initialisation', () => {
  it('does not construct or start HYDISystem on import', () => {
    jest.isolateModules(() => {
      require('../../api/life-flow/route.js');
    });
    expect(mockConstructor).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does not start HYDISystem for an unauthenticated request', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { type: 'system' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockConstructor).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('constructs and starts once, then reuses the instance', async () => {
    mockStart.mockResolvedValue(undefined);
    await handler(authedRequest(), makeRes());
    await handler(authedRequest(), makeRes());
    const res = makeRes();
    await handler(authedRequest(), res);

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockConstructor).toHaveBeenCalledWith(expect.objectContaining({ enableLifeFlowAnalysis: true }));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockProcessRequest).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('shares one start() between concurrent first requests', async () => {
    let finishStart;
    mockStart.mockImplementation(() => new Promise((resolve) => { finishStart = resolve; }));
    const first = handler(authedRequest(), makeRes());
    const second = handler(authedRequest(), makeRes());
    await new Promise((resolve) => setImmediate(resolve));
    finishStart();
    await Promise.all([first, second]);

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockProcessRequest).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when start() fails and retries start() on the same instance next time', async () => {
    mockStart.mockRejectedValueOnce(new Error('boot failed')).mockResolvedValue(undefined);

    const failed = makeRes();
    await handler(authedRequest(), failed);
    expect(failed.status).toHaveBeenCalledWith(500);
    expect(mockProcessRequest).not.toHaveBeenCalled();

    const ok = makeRes();
    await handler(authedRequest(), ok);
    expect(ok.status).toHaveBeenCalledWith(200);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockConstructor).toHaveBeenCalledTimes(1);
  });
});
