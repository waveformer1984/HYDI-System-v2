/**
 * Regression tests for src/middleware/simple-keymaker.js.
 *
 * Two real bugs fixed here:
 * 1. Hardcoded test API keys (sk_test_starter_123 etc.) were always
 *    registered, in every environment including production — anyone who
 *    read this file (or this public repo) could authenticate as any tier
 *    with no real credential.
 * 2. `[process.env.STARTER_API_KEY || '']: {...}` registered an
 *    empty-string API key mapped to a real tier whenever the env var was
 *    unset.
 */
'use strict';

describe('SimpleKeymaker', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('registers the well-known test keys outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.STARTER_API_KEY;
    delete process.env.PRO_API_KEY;
    delete process.env.ENTERPRISE_API_KEY;
    const SimpleKeymaker = require('../../src/middleware/simple-keymaker');
    const km = new SimpleKeymaker();
    expect(km.apiKeys['sk_test_enterprise_789']).toBeDefined();
  });

  it('never registers the well-known test keys in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STARTER_API_KEY;
    delete process.env.PRO_API_KEY;
    delete process.env.ENTERPRISE_API_KEY;
    const SimpleKeymaker = require('../../src/middleware/simple-keymaker');
    const km = new SimpleKeymaker();
    expect(km.apiKeys['sk_test_starter_123']).toBeUndefined();
    expect(km.apiKeys['sk_test_pro_456']).toBeUndefined();
    expect(km.apiKeys['sk_test_enterprise_789']).toBeUndefined();
  });

  it('does not register an empty-string key when a production env var is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STARTER_API_KEY;
    delete process.env.PRO_API_KEY;
    delete process.env.ENTERPRISE_API_KEY;
    const SimpleKeymaker = require('../../src/middleware/simple-keymaker');
    const km = new SimpleKeymaker();
    expect(km.apiKeys['']).toBeUndefined();
    expect(Object.keys(km.apiKeys)).toHaveLength(0);
  });

  it('registers a configured production key under its actual value', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENTERPRISE_API_KEY = 'real-enterprise-key-value';
    const SimpleKeymaker = require('../../src/middleware/simple-keymaker');
    const km = new SimpleKeymaker();
    expect(km.apiKeys['real-enterprise-key-value']).toEqual({ tier: 'enterprise', name: 'Production Enterprise' });
  });

  it('middleware rejects a request with no API key on a gated route', () => {
    process.env.NODE_ENV = 'production';
    const SimpleKeymaker = require('../../src/middleware/simple-keymaker');
    const km = new SimpleKeymaker();
    const req = { method: 'POST', path: '/process', headers: {}, query: {} };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    km.middleware()(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
