'use strict';

const {
  verifyCapabilityWithMockExecutor,
  SAMPLE_CAPABILITY,
} = require('../../lib/heidi/capability-verification-sample');

describe('capability verification sample (mocked)', () => {
  test('tool.update_database mock records evidence without live action', async () => {
    const executor = jest.fn(async () => ({
      executed: false,
      gate: 'AUTHORIZATION_REQUIRED',
    }));
    const out = await verifyCapabilityWithMockExecutor({
      capabilityId: SAMPLE_CAPABILITY,
      executor,
      input: { table: 'missions' },
    });
    expect(executor).toHaveBeenCalled();
    expect(out.live_execution).toBe(false);
    expect(out.verification_status).toBe('mocked');
    expect(out.capabilityId).toBe('tool.update_database');
    expect(out.evidence.length).toBeGreaterThan(0);
  });
});