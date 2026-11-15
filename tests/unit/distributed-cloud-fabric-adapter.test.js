'use strict';

const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { DistributedCloudControlPlane } = require('../../lib/distributed-cloud/control-plane');
const { TASK_STATES } = require('../../lib/distributed-cloud/constants');
const { resolveFabricCapability } = require('../../lib/distributed-cloud/fabric-adapter');

describe('distributed → ExecutionFabric adapter', () => {
  test('diagnostic tasks stay distributed schedule only', () => {
    expect(resolveFabricCapability({ type: 'lightweight' })).toBeNull();
  });

  test('job scout stays on distributed worker (no fabric capability yet)', () => {
    expect(resolveFabricCapability({ action: 'job_scout.scan' })).toBeNull();
  });

  test('health snapshot maps to fabric health.check', () => {
    expect(resolveFabricCapability({ action: 'health.snapshot' })).toBe('health.check');
  });

  test('linkTaskToFabric creates fabric task without duplicate engine execution', async () => {
    const store = new MemoryTaskStore();
    const gateway = new ExecutionGateway({ store, skipRecovery: true });
    const cp = new DistributedCloudControlPlane({ dir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dc-fab-')), fabricGateway: gateway });
    const enq = cp.enqueueTask({
      type: 'lightweight',
      action: 'health.snapshot',
      objective: 'fabric health probe',
      idempotency_key: 'health-1',
    });
    const linked = await cp.linkTaskToFabric(enq.task.id, { role: 'operator' });
    expect(linked.ok).toBe(true);
    expect(linked.task.execution_authority).toBe('fabric');
    expect(linked.fabric.fabric_task_id).toBeTruthy();
    const fabricTask = await store.get(linked.fabric.fabric_task_id);
    expect(fabricTask.capability_id).toBe('health.check');
    expect(fabricTask.state).not.toBe('COMPLETED');
  });

  test('unapproved external tasks do not link to fabric', async () => {
    const store = new MemoryTaskStore();
    const gateway = new ExecutionGateway({ store, skipRecovery: true });
    const cp = new DistributedCloudControlPlane({
      dir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dc-fab2-')),
      fabricGateway: gateway,
    });
    const enq = cp.enqueueTask({
      action: 'freelance.submit_proposal',
      requires_approval: true,
      objective: 'submit',
    });
    expect(enq.task.state).toBe(TASK_STATES.AWAITING_APPROVAL);
    const linked = await cp.linkTaskToFabric(enq.task.id);
    expect(linked.ok).toBe(false);
    expect(linked.error).toBe('approval_required');
  });
});