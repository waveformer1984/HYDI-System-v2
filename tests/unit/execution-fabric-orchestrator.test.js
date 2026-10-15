'use strict';

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');

describe('execution-fabric objective orchestrator e2e', () => {
  function gw() {
    const store = new MemoryTaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 7) });
    return new ExecutionGateway({
      store,
      skipRecovery: true,
      executeSync: jest.fn(async ({ action }) => {
        if (action === 'health.check') return { ok: true, probes: [{ name: 'host', ok: true }] };
        if (action === 'service.status') return { ok: true, health_score: 95 };
        return { ok: false, error: 'unknown' };
      }),
      jobs: jest.fn(() => ({
        start: jest.fn(),
        get: jest.fn(),
        cancel: jest.fn(),
      })),
    });
  }

  it('runs ops.host-health-snapshot through verified completion', async () => {
    const gateway = gw();
    const out = await gateway.orchestrator.submitObjective({
      objectiveId: 'ops.host-health-snapshot',
      role: 'operator',
      idempotencyKey: 'obj-1',
    });
    expect(out.ok).toBe(true);
    expect(out.task.state).toBe('COMPLETED');
    expect(out.task.verification?.verified).toBe(true);
  });

  it('deduplicates objective submission by idempotency key', async () => {
    const gateway = gw();
    const first = await gateway.orchestrator.submitObjective({
      objectiveId: 'ops.host-health-snapshot',
      role: 'operator',
      idempotencyKey: 'obj-dup',
    });
    const second = await gateway.orchestrator.submitObjective({
      objectiveId: 'ops.host-health-snapshot',
      role: 'operator',
      idempotencyKey: 'obj-dup',
    });
    expect(second.duplicate).toBe(true);
    expect(second.task.id).toBe(first.task.id);
  });
});
