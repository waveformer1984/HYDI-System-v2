const NodeScorer = require('../../../src/hydi-v3/NodeScorer');
const DistributedQueue = require('../../../src/hydi-v3/DistributedQueue');
const ExecutionPlanner = require('../../../src/hydi-v3/ExecutionPlanner');
const WorkloadBalancer = require('../../../src/hydi-v3/WorkloadBalancer');
const TaskMigrationManager = require('../../../src/hydi-v3/TaskMigrationManager');
const ConsensusManager = require('../../../src/hydi-v3/ConsensusManager');
const FederationMetrics = require('../../../src/hydi-v3/FederationMetrics');
const SwarmCoordinator = require('../../../src/hydi-v3/SwarmCoordinator');
const SwarmDashboard = require('../../../src/hydi-v3/SwarmDashboard');

function makeNodes() {
  return [
    { id: 'node-a', nodeId: 'node-a', capabilities: ['general', 'gpu'], cpu: 2, ram: 4, gpu: true, latency: 5, workload: 0, health: 'healthy', trust: 'verified' },
    { id: 'node-b', nodeId: 'node-b', capabilities: ['general'], cpu: 1, ram: 1, gpu: false, latency: 50, workload: 5, health: 'healthy', trust: 'verified' },
    { id: 'node-c', nodeId: 'node-c', capabilities: ['general'], cpu: 0.5, ram: 0.5, gpu: false, latency: 100, workload: 0, health: 'healthy', trust: 'unknown' },
  ];
}

function mockMonitor(nodes = []) {
  return { getAll: () => nodes, getHealthy: () => nodes.filter((n) => n.health === 'healthy') };
}

describe('Swarm coordinator', () => {
  let queue;
  let coordinator;

  beforeEach(() => {
    queue = new DistributedQueue({ defaultTtlMs: 10000 }).start();
    const mesh = { getPeers: () => [{ nodeId: 'node-a' }], broadcast: () => {} };
    const consensus = new ConsensusManager({ mesh, identity: { nodeId: 'self' } }).start();
    const metrics = new FederationMetrics({ queue });
    const scorer = new NodeScorer();
    const monitor = mockMonitor(makeNodes());
    const planner = new ExecutionPlanner({ scorer, monitor, queue });
    coordinator = new SwarmCoordinator({ mesh, queue, consensus, metrics, planner });
  });

  afterEach(() => {
    coordinator.stop();
    queue.stop();
  });

  test('starts and reports status', () => {
    coordinator.start();
    const status = coordinator.status();
    expect(status.started).toBe(true);
    expect(status.queue.total).toBe(0);
  });

  test('submits a task and queues it', async () => {
    coordinator.start();
    const result = await coordinator.submit({ id: 't1', type: 'compute', requiredCapabilities: ['general'] });
    expect(result.success).toBe(true);
    expect(coordinator.status().queue.total).toBe(1);
  });

  test('queries capability providers', () => {
    const broker = {
      findProviders: (id) => [{ nodeId: 'node-a', source: 'mesh', capabilityId: id }],
    };
    coordinator.broker = broker;
    const result = coordinator.queryCapability('gpu');
    expect(result.success).toBe(true);
    expect(result.providers[0].nodeId).toBe('node-a');
  });
});

describe('Scheduling decisions', () => {
  test('ranks GPU node higher for audio mastering', () => {
    const scorer = new NodeScorer();
    const nodes = makeNodes();
    const ranked = scorer.rank(
      { id: 'audio', type: 'master', requiredCapabilities: ['gpu'], gpu: true, minCPU: 1, minRAM: 1 },
      nodes
    );
    expect(ranked[0].nodeId).toBe('node-a');
    expect(ranked[0].breakdown.capabilityMatch).toBe(1);
  });

  test('execution planner explains its choice', async () => {
    const scorer = new NodeScorer();
    const monitor = mockMonitor(makeNodes());
    const queue = new DistributedQueue().start();
    const planner = new ExecutionPlanner({ scorer, monitor, queue });
    const result = await planner.plan({ id: 't2', type: 'render', requiredCapabilities: ['general'] });
    expect(result.success).toBe(true);
    expect(result.plan.chosen).toBeTruthy();
    expect(result.plan.explanation).toBeTruthy();
    queue.stop();
  });

  test('deterministic tie-break by node id', () => {
    const scorer = new NodeScorer();
    const nodes = [
      { id: 'n1', capabilities: ['general'], cpu: 1, ram: 1, latency: 0, workload: 0, health: 'healthy', trust: 'verified' },
      { id: 'n2', capabilities: ['general'], cpu: 1, ram: 1, latency: 0, workload: 0, health: 'healthy', trust: 'verified' },
    ];
    const a = scorer.rank({ id: 't', requiredCapabilities: [] }, nodes);
    const b = scorer.rank({ id: 't', requiredCapabilities: [] }, nodes);
    expect(a[0].nodeId).toBe(b[0].nodeId);
  });
});

describe('Workload balancing', () => {
  test('balances queue items toward less loaded nodes', () => {
    const queue = new DistributedQueue().start();
    queue.enqueue({ id: 'w1', type: 'compute', requiredCapabilities: ['general'] });
    const reserved = queue.reserve('node-b');
    reserved.score = 0.2;
    const scorer = new NodeScorer();
    const monitor = mockMonitor(makeNodes());
    const migrator = { migrate: jest.fn(() => ({ success: true })) };
    const balancer = new WorkloadBalancer({ scorer, monitor, queue, migrator, threshold: 0 });
    const result = balancer.balance();
    expect(result.moved).toBeGreaterThan(0);
    expect(migrator.migrate).toHaveBeenCalled();
    queue.stop();
  });
});

describe('Migration', () => {
  test('migrates a reserved task after policy check', () => {
    const mesh = {
      compute: { getNode: (id) => ({ status: id === 'node-a' ? 'active' : 'inactive' }) },
      send: jest.fn(),
    };
    const manager = new TaskMigrationManager({ mesh });
    const result = manager.migrate('w1', 'node-b', 'node-a');
    expect(result.success).toBe(true);
    expect(mesh.send).toHaveBeenCalled();
  });

  test('refuses migration to an inactive node', () => {
    const mesh = { compute: { getNode: () => ({ status: 'inactive' }) } };
    const manager = new TaskMigrationManager({ mesh });
    const result = manager.migrate('w1', 'node-a', 'node-b');
    expect(result.success).toBe(false);
    expect(result.error).toBe('target_unavailable');
  });
});

describe('Failure recovery', () => {
  test('requeues owned tasks when a node disappears', () => {
    const queue = new DistributedQueue().start();
    queue.enqueue({ id: 'f1', type: 'compute' });
    queue.reserve('node-a');
    const balancer = new WorkloadBalancer({ queue });
    const result = balancer.rebalanceAfterFailure('node-a');
    expect(result.requeued).toBe(1);
    expect(queue.get('f1').status).toBe('queued');
    queue.stop();
  });

  test('reaches consensus on task ownership', () => {
    const mesh = {
      getPeers: () => [{ nodeId: 'p1' }, { nodeId: 'p2' }],
      on: jest.fn(),
      off: jest.fn(),
      broadcast: jest.fn(),
    };
    const consensus = new ConsensusManager({ mesh, identity: { nodeId: 'self' }, quorum: 0.5 });
    const proposal = consensus.propose('owner:t1', 'node-a');
    consensus.vote(proposal.proposalId, 'p1', true);
    expect(consensus.getDecision('owner:t1').status).toBe('accepted');
  });
});

describe('Dashboard', () => {
  test('renders swarm status', () => {
    const queue = new DistributedQueue().start();
    queue.enqueue({ id: 'd1', type: 'compute' });
    const monitor = { getAll: () => makeNodes() };
    const metrics = new FederationMetrics({ queue, monitor });
    const dashboard = new SwarmDashboard({ metrics, monitor, queue });
    const render = dashboard.render();
    expect(render.peers).toBe(3);
    expect(render.queued).toBe(1);
    queue.stop();
  });
});
