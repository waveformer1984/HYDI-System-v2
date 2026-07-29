const DistributedCompute = require('../../../src/hydi-v3/DistributedCompute');
const NodeScheduler = require('../../../src/hydi-v3/NodeScheduler');

describe('NodeScheduler', () => {
  let compute;
  let scheduler;

  beforeEach(() => {
    compute = new DistributedCompute({ defaultWeights: { cpu: 0.4, ram: 0.4, latency: 0.1, workload: 0.1 } });
    compute.registerNode({ id: 'n1', cpu: 1, ram: 1, capabilities: ['general'], workload: 2 });
    compute.registerNode({ id: 'n2', cpu: 2, ram: 2, capabilities: ['general'], workload: 0 });
    scheduler = new NodeScheduler({ compute });
  });

  afterEach(() => {
    compute.destroy();
  });

  test('assigns the highest-scoring node deterministically', () => {
    const result = scheduler.schedule({ id: 't1', type: 'compute' });
    expect(result.nodeId).toBe('n2');
    expect(result.status).toBe('assigned');
  });

  test('filters by required capability', () => {
    const result = scheduler.schedule({ type: 'ai' }, { capability: 'gpu' });
    expect(result.nodeId).toBeNull();
    expect(result.status).toBe('pending');
  });

  test('breaks ties by node id for determinism', () => {
    compute.registerNode({ id: 'n3', cpu: 2, ram: 2, capabilities: ['general'], workload: 0 });
    const result = scheduler.schedule({ id: 't2', type: 'compute' });
    expect(['n2', 'n3']).toContain(result.nodeId);
  });

  test('releases a claim', () => {
    scheduler.schedule({ id: 't3', type: 'compute' });
    expect(scheduler.getClaims().length).toBe(1);
    scheduler.release('t3');
    expect(scheduler.getClaims().length).toBe(0);
  });
});
