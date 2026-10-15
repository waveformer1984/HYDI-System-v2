'use strict';

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { TaskStore } = require('../../lib/execution-fabric/task-store');
const { MemoryTaskStore } = require('../../lib/execution-fabric/task-store-memory');
const { buildOperationalSummary } = require('../../lib/execution-fabric/operational-summary');
const { publicStateAlias } = require('../../lib/execution-fabric/constants');
const { recoverInterruptedTasks } = require('../../lib/execution-fabric/recovery');
const { runContractChecks } = require('../../lib/execution-fabric/verification-contracts');

describe('execution fabric phase 4', () => {
  function gw(overrides = {}) {
    const store = new TaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 7) });
    return new ExecutionGateway({
      store,
      skipRecovery: true,
      executeSync:
        overrides.executeSync ||
        jest.fn(async () => ({ ok: true, probes: [{ ok: true, name: 'heidi-web' }] })),
      jobs: overrides.jobs,
    });
  }

  it('duplicate idempotency key does not create a second task', async () => {
    const gateway = gw();
    const first = await gateway.submit({
      capabilityId: 'health.check',
      role: 'operator',
      idempotencyKey: 'dup-key-phase4',
    });
    const second = await gateway.submit({
      capabilityId: 'health.check',
      role: 'operator',
      idempotencyKey: 'dup-key-phase4',
    });
    expect(second.duplicate).toBe(true);
    expect(second.task.id).toBe(first.task.id);
  });

  it('stores correlation_id on submit', async () => {
    const gateway = gw();
    const out = await gateway.submit({
      capabilityId: 'health.check',
      role: 'operator',
      correlationId: 'corr-phase4-abc',
    });
    const raw = await gateway.store.get(out.task.id);
    expect(raw.correlation_id).toBe('corr-phase4-abc');
    expect(out.task.correlation_id).toBe('corr-phase4-abc');
  });

  it('maps public lifecycle aliases for operators', () => {
    expect(publicStateAlias('AWAITING_APPROVAL')).toBe('awaiting_approval');
    expect(publicStateAlias('COMPLETED')).toBe('succeeded');
    expect(publicStateAlias('NEEDS_HUMAN')).toBe('needs_human');
  });

  it('rejects invalid lifecycle transitions', async () => {
    const store = new MemoryTaskStore({ now: () => 1, randomBytes: () => Buffer.alloc(12, 1) });
    const { task } = await store.createTask({ capability_id: 'health.check' });
    await store.transition(task.id, 'PLANNING');
    expect((await store.transition(task.id, 'COMPLETED')).ok).toBe(false);
  });

  it('fails task when contract checks fail despite executor ok', async () => {
    const executeSync = jest.fn(async () => ({ ok: true, probes: [{ ok: false, name: 'bad' }] }));
    const out = await gw({ executeSync }).submit({ capabilityId: 'health.check', role: 'operator' });
    expect(out.ok).toBe(false);
    expect(out.task.state).toBe('FAILED');
    expect(out.task.verification?.verified).toBe(false);
  });

  it('recovers stale lease on idempotent sync task to RECOVERING', async () => {
    const store = new MemoryTaskStore({ now: () => 1000, randomBytes: () => Buffer.alloc(12, 9) });
    const { task } = await store.createTask({ capability_id: 'health.check', role: 'operator' });
    await store.transition(task.id, 'PLANNING');
    await store.transition(task.id, 'RUNNING');
    await store.claimLease(task.id, 'worker', 1);
    await recoverInterruptedTasks(store, { now: () => 5000 });
    const updated = await store.get(task.id);
    expect(updated.state).toBe('RECOVERING');
  });

  it('operational summary aggregates queue and failure counts', async () => {
    const store = new MemoryTaskStore({ now: () => 10_000, randomBytes: () => Buffer.alloc(12, 11) });
    const { task: q } = await store.createTask({ capability_id: 'health.check' });
    await store.transition(q.id, 'PLANNING');
    const { task: f } = await store.createTask({ capability_id: 'health.check' });
    await store.transition(f.id, 'PLANNING');
    await store.transition(f.id, 'RUNNING');
    await store.transition(f.id, 'VERIFYING');
    await store.transition(f.id, 'FAILED');
    const summary = await buildOperationalSummary(store);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.persistence).toBe('memory');
  });

  it('retryTask re-executes failed idempotent sync capability', async () => {
    const executeSync = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'degraded', message: 'fail once' })
      .mockResolvedValueOnce({ ok: true, probes: [{ ok: true, name: 'heidi-web' }] });
    const gateway = gw({ executeSync });
    const first = await gateway.submit({ capabilityId: 'health.check', role: 'operator' });
    expect(first.task.state).toBe('FAILED');
    const retried = await gateway.retryTask(first.task.id, 'operator');
    expect(retried.ok).toBe(true);
    expect(retried.task.state).toBe('COMPLETED');
    expect(executeSync).toHaveBeenCalledTimes(2);
  });

  it('cancel pending approval without claiming external reversal', async () => {
    const gateway = gw();
    const pending = await gateway.submit({ capabilityId: 'tests.run', role: 'operator', confirm: false });
    expect(pending.awaiting_approval).toBe(true);
    const cancelled = await gateway.cancel(pending.task.id, 'operator');
    expect(cancelled.ok).toBe(true);
    expect(cancelled.task.state).toBe('CANCELLED');
  });

  it('runContractChecks does not pass when probes missing', async () => {
    const { checks, verification } = await runContractChecks('health.check', { ok: true, result: {} }, {});
    expect(checks[0].status).toBe('FAIL');
    expect(verification.verified).toBe(false);
  });

  it('survives process restart via memory snapshot export/import', async () => {
    const store = new MemoryTaskStore({ now: () => 2000, randomBytes: () => Buffer.alloc(12, 4) });
    const { task } = await store.createTask({
      capability_id: 'health.check',
      idempotency_key: 'restart-phase4',
      correlation_id: 'corr-restart',
    });
    await store.transition(task.id, 'PLANNING', { reason: 'test' });
    const snap = store.exportSnapshot();
    const store2 = MemoryTaskStore.importSnapshot(snap, { now: () => 3000, randomBytes: () => Buffer.alloc(12, 4) });
    const loaded = await store2.get(task.id);
    expect(loaded.correlation_id).toBe('corr-restart');
    expect(loaded.state).toBe('PLANNING');
  });
});
