const { EventEmitter } = require('events');
const DistributedTaskManager = require('../../../src/hydi-v3/DistributedTaskManager');
const NodePolicy = require('../../../src/hydi-v3/NodePolicy');

let current = null;

function createManager() {
  const mesh = new EventEmitter();
  mesh.transport = null;
  mesh.broadcast = jest.fn();
  mesh.send = jest.fn();
  const manager = new DistributedTaskManager({ mesh, localNodeId: 'self' });
  manager.start();
  current = manager;
  return { manager, mesh };
}

function createManagerWithPolicy(trustedNodes = ['self', 'trusted-peer']) {
  const mesh = new EventEmitter();
  mesh.transport = null;
  mesh.broadcast = jest.fn();
  mesh.send = jest.fn();
  const identity = {
    nodeId: 'self',
    isTrusted: (nodeId) => trustedNodes.includes(nodeId) || nodeId === 'self',
  };
  const policy = new NodePolicy({ identity });
  const manager = new DistributedTaskManager({ mesh, policy, localNodeId: 'self' });
  manager.registerHandler('compute', (payload) => ({ result: payload.x * 2 }));
  manager.start();
  current = manager;
  return { manager, mesh, identity, policy };
}

afterEach(() => {
  if (current) {
    current.stop();
    current = null;
  }
  jest.clearAllMocks();
});

describe('DistributedTaskManager', () => {
  test('advertises and assigns a task', () => {
    const { manager } = createManager();
    const task = manager.advertise({ type: 'test', payload: { x: 1 } });
    expect(task.status).toBe('advertised');
    expect(manager.list().length).toBe(1);
    const assigned = manager.assign(task.id, 'self');
    expect(assigned.success).toBe(true);
    expect(assigned.task.status).toBe('assigned');
  });

  test('executes a registered handler and completes', async () => {
    const { manager } = createManager();
    manager.registerHandler('compute', (payload) => ({ result: payload.x * 2 }));
    const task = manager.advertise({ id: 't1', type: 'compute', payload: { x: 5 } });
    manager.assign(task.id, 'self');
    const result = await manager.execute(task.id);
    expect(result.success).toBe(true);
    expect(result.result.result).toBe(10);
    expect(manager.getStatus(task.id).status).toBe('completed');
  });

  test('fails and retries a task up to the retry limit', async () => {
    const { manager } = createManager();
    manager.maxRetries = 2;
    manager.registerHandler('flaky', () => { throw new Error('boom'); });
    const task = manager.advertise({ id: 't2', type: 'flaky' });
    manager.assign(task.id, 'self');
    const result = await manager.execute(task.id);
    expect(result.success).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(manager.getStatus(task.id).status).toBe('failed');
  });

  test('cancels a pending task', () => {
    const { manager } = createManager();
    const task = manager.advertise({ id: 't3', type: 'compute' });
    const cancelled = manager.cancel(task.id);
    expect(cancelled.success).toBe(true);
    expect(manager.getStatus(task.id).status).toBe('cancelled');
  });

  test('records audit events', () => {
    const lifecycle = { recordProposal: jest.fn() };
    const { manager } = createManager();
    manager.lifecycleRegistry = lifecycle;
    manager.advertise({ id: 't4', type: 'compute' });
    expect(lifecycle.recordProposal).toHaveBeenCalled();
  });
});

describe('DistributedTaskManager trust validation', () => {
  test('trusted node execution succeeds', async () => {
    const { manager } = createManagerWithPolicy();
    manager._handleRemoteTask({ payload: { taskId: 'rt1', type: 'compute', payload: { x: 3 }, requestedBy: 'trusted-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    const task = manager.getStatus('rt1');
    expect(task).toBeTruthy();
    expect(task.status).toBe('completed');
  });

  test('untrusted node rejection', async () => {
    const { manager } = createManagerWithPolicy();
    manager._handleRemoteTask({ payload: { taskId: 'rt2', type: 'compute', payload: { x: 3 }, requestedBy: 'untrusted-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    const task = manager.getStatus('rt2');
    expect(task).toBeTruthy();
    expect(task.status).toBe('failed');
    expect(task.error).toBe('untrusted_node');
  });

  test('revoked trust after connection', async () => {
    const { manager, identity } = createManagerWithPolicy(['self', 'trusted-peer']);
    manager._handleRemoteTask({ payload: { taskId: 'rt3', type: 'compute', payload: { x: 3 }, requestedBy: 'revoked-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    let task = manager.getStatus('rt3');
    expect(task.error).toBe('untrusted_node');

    identity.isTrusted = (nodeId) => nodeId === 'self';
    manager._handleRemoteTask({ payload: { taskId: 'rt4', type: 'compute', payload: { x: 3 }, requestedBy: 'revoked-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    task = manager.getStatus('rt4');
    expect(task.error).toBe('untrusted_node');
  });

  test('missing policy keeps authorized local execution working', async () => {
    const { manager } = createManager();
    manager.registerHandler('compute', (payload) => ({ result: payload.x * 2 }));
    const task = manager.advertise({ id: 't5', type: 'compute', payload: { x: 4 } });
    manager.assign(task.id, 'self');
    const result = await manager.execute(task.id);
    expect(result.success).toBe(true);
  });

  test('replayed execution request is not duplicated', async () => {
    const { manager, mesh } = createManagerWithPolicy();
    manager._handleRemoteTask({ payload: { taskId: 'rt5', type: 'compute', payload: { x: 3 }, requestedBy: 'trusted-peer' } });
    manager._handleRemoteTask({ payload: { taskId: 'rt5', type: 'compute', payload: { x: 3 }, requestedBy: 'trusted-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    const calls = mesh.send.mock.calls.filter((c) => c[1] === 'task_result');
    expect(calls.length).toBe(1);
  });

  test('concurrent execution requests are both validated', async () => {
    const { manager } = createManagerWithPolicy(['self', 'trusted-peer']);
    manager._handleRemoteTask({ payload: { taskId: 'c1', type: 'compute', payload: { x: 2 }, requestedBy: 'untrusted-peer' } });
    manager._handleRemoteTask({ payload: { taskId: 'c2', type: 'compute', payload: { x: 3 }, requestedBy: 'trusted-peer' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(manager.getStatus('c1').status).toBe('failed');
    expect(manager.getStatus('c2').status).toBe('completed');
  });

  test('all failures generate audit events', async () => {
    const { manager, policy } = createManagerWithPolicy();
    const audit = [];
    manager.on('audit', (a) => audit.push(a));
    policy.on('audit', (a) => audit.push(a));
    manager._handleRemoteTask({ payload: { taskId: 'rt6', type: 'compute', payload: { x: 3 }, requestedBy: 'untrusted-peer' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(audit.some((a) => a.action === 'execute' || a.action === 'execute_denied')).toBe(true);
  });
});
