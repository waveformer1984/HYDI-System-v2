const { EventEmitter } = require('events');
const DistributedTaskManager = require('../../../src/hydi-v3/DistributedTaskManager');

describe('DistributedTaskManager', () => {
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

  afterEach(() => {
    if (current) {
      current.stop();
      current = null;
    }
    jest.clearAllMocks();
  });

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
    // Retries are scheduled synchronously and executed immediately via setTimeout
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
