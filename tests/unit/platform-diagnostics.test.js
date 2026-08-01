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
});
