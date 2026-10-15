'use strict';

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { TaskStore } = require('../../lib/execution-fabric/task-store');

describe('execution-fabric gateway', () => {
  function gw(overrides = {}) {
    const store = new TaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 3) });
    return new ExecutionGateway({
      store,
      executeSync: overrides.executeSync || jest.fn(async () => ({ ok: true, probes: [] })),
      jobs: overrides.jobs || jest.fn(() => ({
        start: jest.fn(() => ({ ok: true, job: { id: 'abcdabcdabcdabcd', state: 'running' } })),
        get: jest.fn(() => ({ ok: true, job: { state: 'succeeded', exit_code: 0, step_index: 1 } })),
        cancel: jest.fn(() => ({ ok: true })),
      })),
    });
  }

  it('rejects unknown capabilities', async () => {
    const out = await gw().submit({ capabilityId: 'not.real', role: 'operator' });
    expect(out.error).toBe('unknown_capability');
  });

  it('rejects unauthorized roles', async () => {
    const out = await gw().submit({ capabilityId: 'tests.run', role: 'viewer', confirm: true });
    expect(out.error).toBe('forbidden');
  });

  it('requires confirmation when configured', async () => {
    const out = await gw().submit({ capabilityId: 'tests.run', role: 'operator', confirm: false });
    expect(out.awaiting_approval).toBe(true);
    expect(out.task.state).toBe('AWAITING_APPROVAL');
  });

  it('runs sync capabilities through COMPLETED with verification', async () => {
    const executeSync = jest.fn(async () => ({ ok: true, correlation_id: 'abc' }));
    const out = await gw({ executeSync }).submit({
      capabilityId: 'health.check',
      role: 'operator',
      objective: 'probe host',
    });
    expect(out.ok).toBe(true);
    expect(out.task.state).toBe('COMPLETED');
    expect(executeSync).toHaveBeenCalled();
  });

  it('marks sync failure when runner returns ok: false', async () => {
    const executeSync = jest.fn(async () => ({ ok: false, error: 'degraded', message: 'probe failed' }));
    const out = await gw({ executeSync }).submit({ capabilityId: 'health.check', role: 'operator' });
    expect(out.ok).toBe(false);
    expect(out.task.state).toBe('FAILED');
  });

  it('returns duplicate for idempotency key', async () => {
    const gateway = gw();
    const first = await gateway.submit({ capabilityId: 'health.check', role: 'operator', idempotencyKey: 'idem-1' });
    const second = await gateway.submit({ capabilityId: 'health.check', role: 'operator', idempotencyKey: 'idem-1' });
    expect(second.duplicate).toBe(true);
    expect(second.task.id).toBe(first.task.id);
  });

  it('accepts job capabilities and links job_id', async () => {
    const jobs = jest.fn(() => ({
      start: jest.fn(() => ({ ok: true, job: { id: 'abcdabcdabcdabcd', state: 'running' } })),
      get: jest.fn(),
      cancel: jest.fn(),
    }));
    const out = await gw({ jobs }).submit({
      capabilityId: 'job.tests.suite',
      role: 'operator',
      confirm: true,
      args: { suite: 'mobile-ops' },
    });
    expect(out.accepted).toBe(true);
    expect(out.task.job_id).toBe('abcdabcdabcdabcd');
  });
});
