'use strict';

const { assessExecutionFabricReadiness } = require('../../lib/execution-fabric/readiness');

describe('execution-fabric readiness', () => {
  it('reports READY when core components pass', () => {
    const r = assessExecutionFabricReadiness({ jobManagerOk: true, authConfigured: true });
    expect(r.overall).toBe('READY');
    expect(r.scope).toBe('execution_fabric_mobile_ops');
    expect(r.components.some((c) => c.id === 'capability_registry' && c.state === 'PASS')).toBe(true);
  });
});
