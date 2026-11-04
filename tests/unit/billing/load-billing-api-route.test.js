'use strict';

const { loadBillingApiRoute } = require('../../../lib/billing/load-billing-api-route');

describe('loadBillingApiRoute', () => {
  it('loads checkout and webhook handlers outside Jest worker transpile', () => {
    expect(typeof loadBillingApiRoute('checkout')).toBe('function');
    expect(typeof loadBillingApiRoute('webhook')).toBe('function');
  });
});
