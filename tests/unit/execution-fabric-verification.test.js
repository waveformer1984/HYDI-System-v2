'use strict';

const { verifySyncCapability, verifyJobCapability, buildVerification } = require('../../lib/execution-fabric/verification');

describe('execution-fabric verification', () => {
  it('marks sync success as VERIFIED', () => {
    const v = verifySyncCapability({ ok: true, correlation_id: 'x' });
    expect(v.status).toBe('VERIFIED');
    expect(v.verified).toBe(true);
  });

  it('marks sync failure as FAILED', () => {
    const v = verifySyncCapability({ ok: false, error: 'degraded' });
    expect(v.status).toBe('FAILED');
  });

  it('never treats NOT_REQUIRED as mandatory proof', () => {
    const v = buildVerification({ mandatory: false });
    expect(v.status).toBe('NOT_REQUIRED');
    const mandatory = buildVerification({ mandatory: true, dispatched: false });
    expect(mandatory.verified).toBe(false);
  });

  it('job verification distinguishes dispatch from outcome', () => {
    expect(verifyJobCapability(null).status).toBe('INCONCLUSIVE');
    expect(verifyJobCapability({ state: 'succeeded' }).status).toBe('VERIFIED');
    expect(verifyJobCapability({ state: 'failed' }).status).toBe('FAILED');
  });
});
