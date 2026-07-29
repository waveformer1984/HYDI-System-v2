const { EventEmitter } = require('events');
const FederationGateway = require('../../../src/hydi-v3/FederationGateway');
const DistributedLifecycle = require('../../../src/hydi-v3/DistributedLifecycle');
const FederationDashboard = require('../../../src/hydi-v3/FederationDashboard');
const LifecycleRegistry = require('../../../src/hydi-v3/LifecycleRegistry');

describe('Federation Gateway, Lifecycle and Dashboard', () => {
  function createGateway() {
    const mesh = new EventEmitter();
    mesh.identity = { nodeId: 'self' };
    mesh.send = jest.fn();
    mesh.broadcast = jest.fn();
    const lifecycle = new LifecycleRegistry({});
    const gateway = new FederationGateway({ mesh, lifecycle });
    return { gateway, mesh, lifecycle };
  }

  test('gateway audits and sends remote execution', () => {
    const { gateway, mesh } = createGateway();
    const result = gateway.executeRemote('peer-a', { type: 'compute' });
    expect(result.success).toBe(true);
    expect(mesh.send).toHaveBeenCalledWith('peer-a', 'remote_execute', expect.any(Object));
    expect(gateway.getAudit().length).toBe(1);
  });

  test('gateway receives remote execute and advertises to task manager', () => {
    const { gateway } = createGateway();
    const taskManager = { advertise: jest.fn() };
    gateway.taskManager = taskManager;
    gateway.mesh.emit('message', { from: 'peer-a', type: 'remote_execute', payload: { task: { type: 'x' }, requestedBy: 'peer-a' } });
    expect(taskManager.advertise).toHaveBeenCalled();
  });

  test('gateway emits governance events and audit records', () => {
    const { gateway, mesh } = createGateway();
    const events = [];
    gateway.on('audit', (e) => events.push(e));
    gateway.emitGovernance({ action: 'ban', nodeId: 'peer-b' });
    expect(mesh.broadcast).toHaveBeenCalledWith('governance_event', expect.any(Object));
    expect(events.length).toBe(1);
    expect(gateway.getAudit().some((a) => a.action === 'governance_event')).toBe(true);
  });

  test('distributed lifecycle registers nodes and records events', () => {
    const registry = new LifecycleRegistry({});
    const dl = new DistributedLifecycle({ lifecycleRegistry: registry });
    const result = dl.registerNode('peer-1', { version: '1.0.0', capabilities: ['mesh'] });
    expect(result.success).toBe(true);
    expect(registry.get('Node:peer-1')).toBeTruthy();
    dl.recordEvent('peer-1', { type: 'heartbeat' });
    expect(dl.healthReport().nodeEventCount).toBe(1);
  });

  test('federation dashboard aggregates snapshots', () => {
    const mesh = { getPeers: () => [{ nodeId: 'a' }], getTopology: () => ({}), healthCheck: () => ({}) };
    const taskManager = { list: () => [{ id: 't1', status: 'completed' }] };
    const memoryStore = { snapshot: () => ({ sessions: {} }) };
    const lifecycle = { healthReport: () => ({ healthy: 1, total: 1 }) };
    const dashboard = new FederationDashboard({ mesh, taskManager, memoryStore, lifecycle });
    const render = dashboard.render();
    expect(render.peers).toBe(1);
    expect(render.completedTasks).toBe(1);
    expect(render.healthy).toBe(1);
  });
});
