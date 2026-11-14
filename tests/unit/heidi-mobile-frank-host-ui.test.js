'use strict';

const {
  isFrankHostCardVisible,
  frankHostVitalsLabel,
  frankHostVitalsDotTone,
} = require('../../lib/heidi-mobile/client/frank-host-ui');

const baseMetrics = {
  disk_c_free_gb: 10,
  mem_free_gb: 4,
  kong: 'healthy',
  db: 'healthy',
};

describe('heidi-mobile frank host UI helpers', () => {
  it('hides the card when frank_host is missing (older BFF)', () => {
    expect(isFrankHostCardVisible(null)).toBe(false);
    expect(isFrankHostCardVisible(undefined)).toBe(false);
  });

  it('shows the card when frank_host is present', () => {
    expect(isFrankHostCardVisible({ state: 'stale', stale: true, reasons: [], metrics: baseMetrics })).toBe(true);
  });

  it('labels stale evidence as stale, never healthy', () => {
    const host = { state: 'healthy', stale: true, reasons: ['old sample'], metrics: baseMetrics };
    expect(frankHostVitalsLabel(host)).toBe('stale');
    expect(frankHostVitalsDotTone(host)).toBe('warn');
    expect(frankHostVitalsLabel(host)).not.toBe('healthy');
  });

  it('shows degraded with bad dot tone', () => {
    const host = { state: 'degraded', stale: false, reasons: ['C: 3 GB free (under 5 GB)'], metrics: baseMetrics };
    expect(frankHostVitalsLabel(host)).toBe('degraded');
    expect(frankHostVitalsDotTone(host)).toBe('bad');
  });
});
