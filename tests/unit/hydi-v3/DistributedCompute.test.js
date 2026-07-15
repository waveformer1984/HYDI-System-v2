const DistributedCompute = require('../../../src/hydi-v3/DistributedCompute');

describe('DistributedCompute', () => {
  let compute;

  beforeEach(() => {
    compute = new DistributedCompute({ heartbeatIntervalMs: 100, nodeTimeoutMs: 200 });
  });

  afterEach(() => {
    compute.destroy();
  });

  test('registers nodes and schedules work', () => {
    const nodeA = compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    const nodeB = compute.registerNode({ cpu: 0.5, ram: 0.5, capabilities: ['general'] });
    const task = { id: 't1', type: 'compute' };
    const assigned = compute.schedule(task);
    expect([nodeA, nodeB]).toContain(assigned);
  });

  test('redistributes work on node failure', () => {
    const nodeA = compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    const nodeB = compute.registerNode({ cpu: 0.9, ram: 0.9, capabilities: ['general'] });
    const task = { id: 't1', type: 'compute' };
    const assigned = compute.schedule(task);
    expect([nodeA, nodeB]).toContain(assigned);
    compute.deregisterNode(assigned);
    const redistributed = compute.schedule(task);
    expect(redistributed).toBe(nodeB);
  });

  test('detects node timeout', async () => {
    let failed = null;
    compute.on('node_failed', (event) => { failed = event; });
    compute.registerNode({ cpu: 1, ram: 1, id: 'node-1' });
    compute.start();
    await new Promise((r) => setTimeout(r, 300));
    expect(failed).not.toBeNull();
  });
});
