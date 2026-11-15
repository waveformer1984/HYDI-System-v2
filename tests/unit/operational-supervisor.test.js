'use strict';

const { buildOperationalSupervisorReport } = require('../../lib/heidi/operational-supervisor');

describe('operational-supervisor', () => {
  it('returns read-only report without throwing when Frank truth missing', async () => {
    const report = await buildOperationalSupervisorReport({ root: process.cwd(), fetchImpl: async () => ({ ok: false }) });
    expect(report.mode).toBe('read_only');
    expect(report.frank_truth_availability).toBe('UNAVAILABLE');
    expect(Array.isArray(report.recommendations)).toBe(true);
  });
});