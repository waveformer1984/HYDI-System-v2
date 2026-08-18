const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isAuthorized } = require('../src/auth');

describe('Authentication', () => {
  it('authorizes a valid Bearer token', () => {
    const req = { headers: { authorization: 'Bearer secret-key' } };
    assert.strictEqual(isAuthorized(req, 'secret-key'), true);
  });

  it('rejects an invalid token', () => {
    const req = { headers: { authorization: 'Bearer wrong-key' } };
    assert.strictEqual(isAuthorized(req, 'secret-key'), false);
  });

  it('rejects missing authorization', () => {
    const req = { headers: {} };
    assert.strictEqual(isAuthorized(req, 'secret-key'), false);
  });

  it('rejects non-Bearer format', () => {
    const req = { headers: { authorization: 'Basic secret-key' } };
    assert.strictEqual(isAuthorized(req, 'secret-key'), false);
  });
});
