'use strict';

const SimpleKeymaker = require('../../src/middleware/simple-keymaker');

function mockReqRes(overrides = {}) {
  const req = { method: 'POST', path: '/services/execute', headers: {}, query: {}, ...overrides };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

describe('SimpleKeymaker', () => {
  const ENV_KEYS = ['STARTER_API_KEY', 'PRO_API_KEY', 'ENTERPRISE_API_KEY'];
  let savedEnv;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  // Regression test: these three keys used to be hardcoded in source and
  // granted real tier access on any deployment that hadn't overridden this
  // file -- a publicly-known credential baked into a public repo.
  test.each(['sk_test_starter_123', 'sk_test_pro_456', 'sk_test_enterprise_789'])(
    'rejects the removed hardcoded test key %s',
    (key) => {
      const keymaker = new SimpleKeymaker();
      const { req, res } = mockReqRes({ headers: { 'x-api-key': key } });
      const next = jest.fn();

      keymaker.middleware()(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    }
  );

  test('accepts a key configured via env var and attaches tier info', () => {
    process.env.PRO_API_KEY = 'real_pro_key_from_env';
    const keymaker = new SimpleKeymaker();
    const { req, res } = mockReqRes({ headers: { 'x-api-key': 'real_pro_key_from_env' } });
    const next = jest.fn();

    keymaker.middleware()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.apiKey).toEqual(expect.objectContaining({ tier: 'pro', validated: true }));
  });

  test('rejects requests with no API key when none are configured', () => {
    const keymaker = new SimpleKeymaker();
    const { req, res } = mockReqRes();
    const next = jest.fn();

    keymaker.middleware()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
