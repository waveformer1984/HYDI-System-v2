'use strict';

const { normalizeFrankHost } = require('../../lib/heidi-mobile/normalize');

describe('normalizeFrankHost', () => {
  it('passes through well-formed frank host snapshots', () => {
    const n = normalizeFrankHost({
      state: 'degraded',
      reasons: ['C: 1 GB free (under 5 GB)'],
      observed_at: '2026-11-14T12:00:00.000Z',
      age_sec: 30,
      stale: false,
      frank_level: 'WARN',
      metrics: {
        disk_c_free_gb: 1,
        kong: 'unhealthy',
        db: 'healthy',
      },
    });
    expect(n).toMatchObject({
      state: 'degraded',
      reasons: ['C: 1 GB free (under 5 GB)'],
      stale: false,
      metrics: { disk_c_free_gb: 1, kong: 'unhealthy', db: 'healthy' },
    });
  });

  it('rejects malformed payloads', () => {
    expect(normalizeFrankHost({ state: 'OK' })).toBeNull();
    expect(normalizeFrankHost(null)).toBeNull();
  });
});