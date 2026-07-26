'use strict';

const StartupIntegrity = require('../../../src/hydi-v3/StartupIntegrity');

describe('StartupIntegrity', () => {
  test('reports healthy when all systems present', async () => {
    const mockBackup = { healthCheck: async () => true };
    const si = new StartupIntegrity({
      strategicObjectives: { getActive: () => [{ id: 'resonate' }] },
      businessMemory: { healthCheck: () => ({ ok: true, entities: 10 }), entities: new Map(), flush: async () => {} },
      executionGateway: { healthCheck: () => ({ ok: true, adapters: 4, pending: 0 }), getCapabilities: () => [{ adapter: 'documentation' }] },
      workflowEngine: null,
      observability: { getHealthScore: () => 90 },
      backup: mockBackup,
    });
    const result = await si.check();
    expect(result.status).toBe('healthy');
    expect(result.checks.length).toBeGreaterThan(0);
    const text = si.toText(result);
    expect(text).toContain('Startup Status: Healthy');
  });

  test('reports degraded when backup is missing', async () => {
    const si = new StartupIntegrity({
      strategicObjectives: { getActive: () => [{ id: 'resonate' }] },
      businessMemory: { healthCheck: () => ({ ok: true, entities: 10 }), entities: new Map(), flush: async () => {} },
      executionGateway: { healthCheck: () => ({ ok: true, adapters: 4, pending: 0 }), getCapabilities: () => [{ adapter: 'documentation' }] },
    });
    const result = await si.check();
    expect(result.status).toBe('degraded');
    const backup = result.checks.find((c) => c.name === 'BackupSystem');
    expect(backup.status).toBe('degraded');
  });

  test('fails when strategic objectives are empty', async () => {
    const si = new StartupIntegrity({
      strategicObjectives: { getActive: () => [] },
      businessMemory: { healthCheck: () => ({ ok: true }), entities: new Map(), flush: async () => {} },
      executionGateway: { healthCheck: () => ({ ok: true }), getCapabilities: () => [] },
    });
    const result = await si.check();
    expect(result.status).toBe('failed');
  });
});
