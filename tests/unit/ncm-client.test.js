'use strict';

const { ncmEnabled, ncmServiceUrl, DEFAULT_NCM_URL } = require('../../lib/inference/ncm-client');

describe('ncm-client config', () => {
  test('ncmEnabled respects env', () => {
    expect(ncmEnabled({ HYDI_NCM_ENABLED: '1' })).toBe(true);
    expect(ncmEnabled({ HYDI_NCM_ENABLED: 'true' })).toBe(true);
    expect(ncmEnabled({})).toBe(false);
  });

  test('ncmServiceUrl strips trailing slash', () => {
    expect(ncmServiceUrl({ HYDI_NCM_SERVICE_URL: 'http://127.0.0.1:8791/' })).toBe(
      'http://127.0.0.1:8791',
    );
    expect(ncmServiceUrl({})).toBe(DEFAULT_NCM_URL);
  });
});