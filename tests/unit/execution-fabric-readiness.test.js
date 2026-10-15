'use strict';

const { assessExecutionFabricReadiness } = require('../../lib/execution-fabric/readiness');

describe('execution-fabric readiness', () => {
  it('reports DEGRADED or READY when core components pass', () => {
    const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
    const r = assessExecutionFabricReadiness({
      store: new MemoryTaskStore(),
      jobManagerOk: true,
      authConfigured: true,
      supabaseConfigured: true,
    });
    expect(['READY', 'DEGRADED']).toContain(r.overall);
    expect(r.scope).toBe('execution_fabric_mobile_ops');
    expect(r.components.some((c) => c.id === 'capability_registry' && c.state === 'PASS')).toBe(true);
  });
});
