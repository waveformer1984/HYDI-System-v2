'use strict';

const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { DevWorkforceRegistry } = require('../../lib/dev-workforce/registry');
const { DevWorkforceCoordinator } = require('../../lib/dev-workforce/coordinator');
const { AGENT_ROLES, PERMISSIONS } = require('../../lib/dev-workforce/types');

describe('dev workforce → ExecutionGateway', () => {
  test('unregistered agent cannot submit', async () => {
    const gateway = new ExecutionGateway({ store: new MemoryTaskStore(), skipRecovery: true });
    const reg = new DevWorkforceRegistry();
    const coord = new DevWorkforceCoordinator(gateway, reg);
    const out = await coord.assign({ agent_id: 'missing', capabilityId: 'health.check' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('agent_not_registered');
  });

  test('registered QA agent submits via fabric', async () => {
    const store = new MemoryTaskStore();
    const gateway = new ExecutionGateway({ store, skipRecovery: true });
    const reg = new DevWorkforceRegistry();
    reg.register({ agent_id: 'qa-1', role: AGENT_ROLES.QUALITY_ASSURANCE });
    const coord = new DevWorkforceCoordinator(gateway, reg);
    const out = await coord.assign({ agent_id: 'qa-1', capabilityId: 'git.inspect', role: 'operator' });
    expect(out.task).toBeTruthy();
    expect(out.workforce_agent_id).toBe('qa-1');
    const task = await store.get(out.task.id);
    expect(task.actor).toBe('agent:qa-1');
  });

  test('documentation agent lacks fabric submit', async () => {
    const gateway = new ExecutionGateway({ store: new MemoryTaskStore(), skipRecovery: true });
    const reg = new DevWorkforceRegistry();
    reg.register({ agent_id: 'doc-1', role: AGENT_ROLES.DOCUMENTATION });
    expect(reg.hasPermission('doc-1', PERMISSIONS.FABRIC_SUBMIT)).toBe(false);
    const coord = new DevWorkforceCoordinator(gateway, reg);
    const out = await coord.assign({ agent_id: 'doc-1', capabilityId: 'health.check' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('insufficient_agent_permission');
  });
});