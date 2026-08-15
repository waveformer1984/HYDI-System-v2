'use strict';

const { createApex } = require('../../src/apex');

describe('Apex local-first boundary', () => {
  it('returns a safe NOT_AVAILABLE status', async () => {
    const apex = createApex();
    const status = await apex.getStatus();
    expect(status.status).toBe('NOT_AVAILABLE_IN_LOCAL_MODE');
    expect(status.reason).toContain('not implemented for local-first');
  });

  it('does not throw on execute', async () => {
    const apex = createApex();
    const result = await apex.execute({ some: 'task' });
    expect(result.status).toBe('NOT_AVAILABLE_IN_LOCAL_MODE');
    expect(result.details).toContain('production');
  });
});
