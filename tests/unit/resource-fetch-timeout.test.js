'use strict';

const { fetchPageText } = require('../../lib/resource-acquisition/verify/fetch-page');

describe('resource fetch-page timeout', () => {
  it('resolves when connection cannot be established', async () => {
    const t0 = Date.now();
    const r = await fetchPageText('http://127.0.0.1:9', 800);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});