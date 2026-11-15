'use strict';

const { assertOperatorAuthorization } = require('../../lib/partnerships-funding/operator-auth');

describe('partnerships operator-auth', () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
    delete process.env.HYDI_PARTNERSHIPS_OPERATOR_SECRET;
    delete process.env.HYDI_SERVICE_SECRET;
  });

  afterAll(() => {
    process.env = OLD;
  });

  it('rejects HYDI_SERVICE_SECRET token when partnerships secret unset', () => {
    process.env.HYDI_SERVICE_SECRET = 'service-only';
    const r = assertOperatorAuthorization({
      actor: 'human:owner',
      method: 'cli',
      token: 'service-only',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('operator_token_required');
  });

  it('rejects token equal to HYDI_SERVICE_SECRET when partnerships secret differs', () => {
    process.env.HYDI_PARTNERSHIPS_OPERATOR_SECRET = 'partnerships-secret';
    process.env.HYDI_SERVICE_SECRET = 'service-only';
    const r = assertOperatorAuthorization({
      actor: 'human:owner',
      method: 'cli',
      token: 'service-only',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('operator_token_invalid');
  });

  it('accepts token only with HYDI_PARTNERSHIPS_OPERATOR_SECRET set', () => {
    process.env.HYDI_PARTNERSHIPS_OPERATOR_SECRET = 'p-secret';
    const r = assertOperatorAuthorization({
      actor: 'human:operator',
      method: 'cli',
      token: 'p-secret',
    });
    expect(r.ok).toBe(true);
  });
});