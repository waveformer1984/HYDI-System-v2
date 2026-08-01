const { getRuntimeInventory } = require('../../lib/platform-diagnostics');

jest.setTimeout(15000);

describe('Platform diagnostics', () => {
  it('discovers components and returns a summary', async () => {
    const inventory = await getRuntimeInventory();
    expect(inventory.ok).toBe(true);
    expect(inventory.last_checked).toBeTruthy();
    expect(inventory.canonical.length).toBeGreaterThan(0);
    expect(inventory.legacy.length).toBeGreaterThan(0);
    expect(inventory.deprecated.length).toBeGreaterThan(0);
    expect(inventory.summary.total).toBeGreaterThan(0);
    expect(inventory.summary).toHaveProperty('canonicalReachable');
    expect(inventory.summary).toHaveProperty('legacyReachable');
    expect(inventory.summary).toHaveProperty('canonicalLoaded');
    expect(inventory.summary).toHaveProperty('legacyLoaded');
  });

  it('exposes the correct schema for every component', async () => {
    const inventory = await getRuntimeInventory();
    const all = [...inventory.canonical, ...inventory.legacy, ...inventory.deprecated];
    for (const c of all) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('path');
      expect(c).toHaveProperty('registered', true);
      expect(c).toHaveProperty('loaded');
      expect(typeof c.loaded).toBe('boolean');
      expect(c).toHaveProperty('reachable');
      expect(typeof c.reachable).toBe('boolean');
      expect(c).toHaveProperty('version');
      expect(c).toHaveProperty('last_checked');
      expect(c).toHaveProperty('dependencies');
      expect(Array.isArray(c.dependencies)).toBe(true);
    }
  });

  it('reports a healthy, reachable component', async () => {
    const inventory = await getRuntimeInventory();
    const kilo = inventory.canonical.find(c => c.name === 'KILO');
    expect(kilo).toBeDefined();
    expect(kilo.loaded).toBe(true);
    expect(kilo.reachable).toBe(true);
  });

  it('reports an unavailable dependency as loaded but not reachable', async () => {
    const inventory = await getRuntimeInventory();
    const actionGate = inventory.canonical.find(c => c.name === 'ProtoForge Action Gate');
    expect(actionGate).toBeDefined();
    expect(actionGate.loaded).toBe(true);
    expect(actionGate.reachable).toBe(false);
  });

  it('reports legacy TypeScript files as loaded but not reachable', async () => {
    const inventory = await getRuntimeInventory();
    const legacyReplay = inventory.legacy.find(c => c.name === 'Legacy Replay Engine (lib/protoforge)');
    expect(legacyReplay).toBeDefined();
    expect(legacyReplay.loaded).toBe(true);
    expect(legacyReplay.reachable).toBe(false);
  });

  it('discovers Proto YI as a registered application', async () => {
    const inventory = await getRuntimeInventory();
    const protoYi = inventory.applications.find(a => a.name === 'Proto YI');
    const health = inventory.governance.applicationHealth.find(a => a.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.status).toBe('active');
    expect(health).toBeDefined();
    expect(health.loaded).toBe(true);
    expect(health.policyValid).toBe(true);
    expect(health.healthRequirements).toContain('protoiy-engine');
    expect(health.healthRequirements).toContain('hydi-gateway');
  });

  it('reports Proto YI lifecycle through the application registry', async () => {
    const inventory = await getRuntimeInventory();
    expect(inventory.governance.registry.total).toBeGreaterThan(0);
    expect(inventory.governance.registry.byStatus.active).toBeGreaterThanOrEqual(1);
    const protoYi = inventory.governance.applicationHealth.find(a => a.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.reachable).toBe(true);
    expect(protoYi.policyValid).toBe(true);
  });
});
