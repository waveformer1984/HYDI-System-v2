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
    compute.registerNode({ cpu: 1, ram: 1, id: 'node-1' });
    compute.start();
    // Wait for the real event rather than racing a fixed sleep against the
    // engine's own internal timer tick, which flakes under CI load when the
    // two land at approximately the same wall-clock time.
    const failed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for node_failed')), 2000);
      compute.once('node_failed', (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
    expect(failed).not.toBeNull();
  });

  test('electLeader picks highest capability node and breaks ties by oldest registration', () => {
    const nodeA = compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'], registeredAt: 1000 });
    compute.registerNode({ cpu: 0.5, ram: 0.5, capabilities: ['general'], registeredAt: 2000 });
    const leader = compute.electLeader();
    expect(leader.id).toBe(nodeA);

    const nodeC = compute.registerNode({ cpu: 3, ram: 3, capabilities: ['general'], registeredAt: 3000 });
    const next = compute.electLeader();
    expect(next.id).toBe(nodeC);
  });

  test('getLeader returns cached or re-elected leader', () => {
    const nodeA = compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    compute.electLeader();
    expect(compute.getLeader().id).toBe(nodeA);
  });

  test('getLoadReport summarizes node workload', () => {
    compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    compute.registerNode({ cpu: 0.5, ram: 0.5, capabilities: ['general'] });
    compute.schedule({ id: 't1', type: 'compute' });
    compute.schedule({ id: 't2', type: 'compute' });
    const report = compute.getLoadReport();
    expect(report.totalWorkload).toBe(2);
    expect(report.averageWorkload).toBe(1);
  });

  test('migrateMission moves a task between nodes', () => {
    const nodeA = compute.registerNode({ cpu: 2, ram: 2, capabilities: ['general'] });
    const nodeB = compute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    const task = { id: 'm1', type: 'compute' };
    compute.schedule(task);
    expect(compute.getNode(nodeA).workload).toBe(1);

    const migrated = compute.migrateMission('m1', nodeA, nodeB);
    expect(migrated).toBe(true);
    expect(compute.getNode(nodeA).workload).toBe(0);
    expect(compute.getNode(nodeB).workload).toBe(1);
    expect(compute.workAssignments.get('m1').nodeId).toBe(nodeB);
  });

  test('workStealing moves a task from an overloaded node to an idle node', () => {
    const nodeA = compute.registerNode({ cpu: 2, ram: 2, capabilities: ['general'] });
    const nodeB = compute.registerNode({ cpu: 0.5, ram: 0.5, capabilities: ['general'] });
    compute.schedule({ id: 's1', type: 'compute' });
    compute.schedule({ id: 's2', type: 'compute' });

    const result = compute.workStealing();
    expect(result).not.toBeNull();
    expect(result.from).toBe(nodeA);
    expect(result.to).toBe(nodeB);
    expect(compute.getNode(nodeA).workload).toBe(1);
    expect(compute.getNode(nodeB).workload).toBe(1);
  });

  test('rebalance redistributes work based on capability score', () => {
    const nodeA = compute.registerNode({ cpu: 2, ram: 2, capabilities: ['general'] });
    const nodeB = compute.registerNode({ cpu: 0.5, ram: 0.5, capabilities: ['general'] });
    compute.schedule({ id: 'r1', type: 'compute' });
    compute.schedule({ id: 'r2', type: 'compute' });
    compute.schedule({ id: 'r3', type: 'compute' });
    compute.schedule({ id: 'r4', type: 'compute' });

    expect(compute.getNode(nodeA).workload).toBe(4);
    expect(compute.getNode(nodeB).workload).toBe(0);

    const result = compute.rebalance();
    expect(result.moved).toBeGreaterThan(0);
    expect(compute.getNode(nodeB).workload).toBeGreaterThan(0);
  });

  test('autoDiscover simulates local node discovery', () => {
    const discovered = compute.autoDiscover();
    expect(discovered.length).toBe(3);
    expect(compute.getNodes().length).toBe(3);
    expect(compute.getNodes().some((n) => n.id === 'local-node-1')).toBe(true);
  });
});
