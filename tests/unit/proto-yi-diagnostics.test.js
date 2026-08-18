const { getRuntimeInventory } = require('../../lib/platform-diagnostics');

jest.setTimeout(15000);

function createFakeClient(reachable) {
  return {
    endpoint: 'http://fake-engine',
    async get(_path) {
      if (!reachable) throw new Error('connection refused');
      return { status: 'ursula-epm-online' };
    },
    async post() { return { project_id: 1 }; }
  };
}

describe('Proto YI runtime diagnostics', () => {
  it('reports Proto YI as loaded and registered', async () => {
    const inventory = await getRuntimeInventory({ protoiyClient: createFakeClient(true) });
    const protoYi = inventory.canonical.find(c => c.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.registered).toBe(true);
    expect(protoYi.loaded).toBe(true);
  });

  it('reports the ProtoIY engine as reachable when the fake client returns a healthy response', async () => {
    const inventory = await getRuntimeInventory({ protoiyClient: createFakeClient(true) });
    const protoYi = inventory.canonical.find(c => c.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.reachable).toBe(true);
    expect(protoYi.reason).toBeUndefined();
    const adapterDep = protoYi.dependencies.find(d => d.name === 'ProtoIY Engine Adapter');
    expect(adapterDep).toBeDefined();
    expect(adapterDep.reachable).toBe(true);
  });

  it('reports the ProtoIY engine as unreachable when the fake client fails', async () => {
    const inventory = await getRuntimeInventory({ protoiyClient: createFakeClient(false) });
    const protoYi = inventory.canonical.find(c => c.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.reachable).toBe(false);
    expect(protoYi.reason).toMatch(/ProtoIY engine unavailable/);
  });

  it('reports unreachability without a live Flask dependency', async () => {
    const inventory = await getRuntimeInventory({ protoiyTimeout: 100 });
    const protoYi = inventory.canonical.find(c => c.name === 'Proto YI');
    expect(protoYi).toBeDefined();
    expect(protoYi.reachable).toBe(false);
    expect(protoYi.reason).toMatch(/ProtoIY engine unavailable/);
  });
});
