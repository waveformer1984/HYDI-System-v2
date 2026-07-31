'use strict';

const { isLocalRequest, requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

function req(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers: { host: 'localhost:3000', ...headers } };
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe('localAccessGuard', () => {
  test('accepts loopback addresses', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLocalRequest(req(address))).toBe(true);
    }
  });

  test('rejects remote addresses', () => {
    for (const address of ['10.0.0.5', '192.168.1.20', '203.0.113.9', '::ffff:10.0.0.5']) {
      expect(isLocalRequest(req(address))).toBe(false);
    }
  });

  test('rejects proxied requests even from loopback', () => {
    expect(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(req('127.0.0.1', { 'x-real-ip': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(req('127.0.0.1', { forwarded: 'for=203.0.113.9' }))).toBe(false);
  });

  test('rejects a loopback socket carrying a public Host header', () => {
    expect(isLocalRequest(req('127.0.0.1', { host: 'cockpit.example.com' }))).toBe(false);
  });

  test('accepts loopback Host variants', () => {
    expect(isLocalRequest(req('127.0.0.1', { host: '127.0.0.1:3000' }))).toBe(true);
    expect(isLocalRequest(req('::1', { host: 'localhost' }))).toBe(true);
  });

  test('rejects a missing or malformed request', () => {
    expect(isLocalRequest(null)).toBe(false);
    expect(isLocalRequest({})).toBe(false);
    expect(isLocalRequest({ headers: {}, socket: { remoteAddress: '8.8.8.8' } })).toBe(false);
  });

  test('falls back to req.connection when socket is absent', () => {
    expect(isLocalRequest({ headers: { host: 'localhost' }, connection: { remoteAddress: '127.0.0.1' } })).toBe(true);
  });

  test('requireLocal passes local requests through', () => {
    const res = mockRes();
    expect(requireLocal(req('127.0.0.1'), res)).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  test('requireLocal responds 403 for remote requests', () => {
    const res = mockRes();
    expect(requireLocal(req('203.0.113.9'), res)).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
