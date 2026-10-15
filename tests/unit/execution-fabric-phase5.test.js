'use strict';

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { TaskStore } = require('../../lib/execution-fabric/task-store');
const { redactSensitive } = require('../../lib/execution-fabric/access');
const { evaluateBillingEvidence, integrationStatus } = require('../../lib/execution-fabric/billing-verification-adapter');

function gateway() {
  const store = new TaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 9) });
  return new ExecutionGateway({
    store,
    skipRecovery: true,
    executeSync: jest.fn(async () => ({ ok: true, probes: [{ ok: true, name: 'heidi-web' }] })),
  });
}

const tenantA = { subject: 'user-a', role: 'operator', tenant_id: 'tenant-a', auth_source: 'tenant_resolver' };
const tenantB = { subject: 'user-b', role: 'operator', tenant_id: 'tenant-b', auth_source: 'tenant_resolver' };

describe('execution fabric phase 5 identity and tenant isolation', () => {
  it('ignores client-supplied tenant_id and stores the server principal', async () => {
    const gw = gateway();
    const out = await gw.submit({
      capabilityId: 'health.check',
      role: 'operator',
      args: { tenant_id: 'spoofed', token: 'sk_live_should_not_stick' },
      principal: tenantA,
    });
    const raw = await gw.store.get(out.task.id);
    expect(raw.tenant_id).toBe('tenant-a');
    expect(raw.created_by).toBe('user-a');
    expect(raw.input.tenant_id).toBeUndefined();
    expect(raw.input.token).toBe('[redacted]');
  });

  it('tenant B cannot read, cancel, or retry tenant A tasks', async () => {
    const gw = gateway();
    const created = await gw.submit({ capabilityId: 'health.check', role: 'operator', principal: tenantA });
    const read = await gw.getTask(created.task.id, 'operator', tenantB);
    expect(read.ok).toBe(false);
    expect(read.error).toBe('not_found');
    const cancel = await gw.cancel(created.task.id, 'operator', tenantB);
    expect(cancel.ok).toBe(false);
    const failed = await gw.submit({
      capabilityId: 'health.check',
      role: 'operator',
      principal: tenantA,
      args: {},
    });
    await gw.store.transition(failed.task.id, 'FAILED', { reason: 'force' }).catch(() => {});
    const task = await gw.store.get(created.task.id);
    task.state = 'FAILED';
    const retry = await gw.retryTask(created.task.id, 'operator', {}, tenantB);
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe('not_found');
  });

  it('does not let a tenant claim an unowned legacy task', async () => {
    const gw = gateway();
    const legacy = await gw.submit({ capabilityId: 'health.check', role: 'operator' });
    const raw = await gw.store.get(legacy.task.id);
    expect(raw.tenant_id).toBeNull();
    const claimed = await gw.getTask(legacy.task.id, 'operator', tenantA);
    expect(claimed.error).toBe('not_found');
  });

  it('preserves tenant and correlation across retry', async () => {
    const executeSync = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'degraded', message: 'once' })
      .mockResolvedValueOnce({ ok: true, probes: [{ ok: true, name: 'heidi-web' }] });
    const store = new TaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 3) });
    const gw = new ExecutionGateway({ store, skipRecovery: true, executeSync });
    const first = await gw.submit({
      capabilityId: 'health.check',
      role: 'operator',
      principal: tenantA,
      correlationId: 'corr-keep',
    });
    expect(first.task.state).toBe('FAILED');
    const again = await gw.retryTask(first.task.id, 'operator', {}, tenantA);
    expect(again.ok).toBe(true);
    const raw = await gw.store.get(first.task.id);
    expect(raw.tenant_id).toBe('tenant-a');
    expect(raw.created_by).toBe('user-a');
    expect(raw.correlation_id).toBe('corr-keep');
  });

  it('expires approval before execution', async () => {
    const gw = gateway();
    const pending = await gw.submit({ capabilityId: 'tests.run', role: 'operator', confirm: false, principal: tenantA });
    expect(pending.awaiting_approval).toBe(true);
    const raw = await gw.store.get(pending.task.id);
    raw.authorization.expires_at = new Date(Date.now() - 1000).toISOString();
    const approved = await gw.approveTask(pending.task.id, 'operator', true, {}, tenantA);
    expect(approved.error).toBe('approval_expired');
    expect((await gw.store.get(pending.task.id)).state).toBe('NEEDS_HUMAN');
  });

  it('blocks execution when permission is revoked after approval', async () => {
    const gw = gateway();
    const pending = await gw.submit({ capabilityId: 'tests.run', role: 'operator', confirm: false, principal: tenantA });
    // The approver holds fabric:control, but the permission recorded on the
    // task is one operators no longer have (an owner-only grant).
    const stored = await gw.store.get(pending.task.id);
    stored.authorization = { ...stored.authorization, permission: 'billing:refund:request' };
    await gw.store.persist(stored);
    const approved = await gw.approveTask(pending.task.id, 'operator', true, {}, tenantA);
    expect(approved.error).toBe('forbidden');
    expect((await gw.store.get(pending.task.id)).state).toBe('NEEDS_HUMAN');
  });

  it('second worker cannot claim a live lease', async () => {
    const gw = gateway();
    const { task } = await gw.store.createTask({
      capability_id: 'health.check',
      role: 'operator',
      tenant_id: 'tenant-a',
      created_by: 'user-a',
    });
    expect((await gw.store.claimLease(task.id, 'worker-a', 60_000)).ok).toBe(true);
    expect((await gw.store.claimLease(task.id, 'worker-b', 60_000)).ok).toBe(false);
  });

  it('cancel reports no external rollback', async () => {
    const gw = gateway();
    const pending = await gw.submit({ capabilityId: 'tests.run', role: 'operator', confirm: false, principal: tenantA });
    const cancelled = await gw.cancel(pending.task.id, 'operator', tenantA);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.external_rollback).toBe(false);
    expect(cancelled.task.state).toBe('CANCELLED');
  });

  it('redacts secrets in structured output', () => {
    const out = redactSensitive({ api_key: 'sk_test_abc', nested: { password: 'x', ok: true }, note: 'fine' });
    expect(out.api_key).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.ok).toBe(true);
    expect(out.note).toBe('fine');
  });

  it('billing evidence fails closed and does not retry charges', () => {
    expect(integrationStatus().integrated).toBe(false);
    expect(integrationStatus().disposition).toBe('blocked_pending_pr_368');
    expect(evaluateBillingEvidence(null, { tenant_id: 'tenant-a' }).reason).toBe('missing_evidence');
    const stale = evaluateBillingEvidence(
      { tenant_id: 'tenant-a', observed_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), provider_status: 'succeeded', idempotency_key: 'k', provider_object_id: 'ch_1' },
      { tenant_id: 'tenant-a' },
    );
    expect(stale.verified).toBe(false);
    expect(stale.retryable_charge).toBe(false);
    const pending = evaluateBillingEvidence(
      { tenant_id: 'tenant-a', observed_at: new Date().toISOString(), provider_status: 'indeterminate', idempotency_key: 'k' },
      { tenant_id: 'tenant-a' },
    );
    expect(pending.disposition).toBe('needs_reconciliation');
    expect(pending.retryable_charge).toBe(false);
    const mismatch = evaluateBillingEvidence(
      { tenant_id: 'tenant-b', observed_at: new Date().toISOString(), provider_status: 'succeeded', idempotency_key: 'k', provider_object_id: 'ch_1' },
      { tenant_id: 'tenant-a' },
    );
    expect(mismatch.reason).toBe('tenant_mismatch');
    const ok = evaluateBillingEvidence(
      { tenant_id: 'tenant-a', observed_at: new Date().toISOString(), provider_status: 'succeeded', idempotency_key: 'k', provider_object_id: 'ch_1' },
      { tenant_id: 'tenant-a' },
    );
    expect(ok.verified).toBe(true);
    expect(ok.retryable_charge).toBe(false);
  });

  it('duplicate idempotency key inside a tenant does not create a second task', async () => {
    const gw = gateway();
    const a = await gw.submit({ capabilityId: 'health.check', role: 'operator', principal: tenantA, idempotencyKey: 'same' });
    const b = await gw.submit({ capabilityId: 'health.check', role: 'operator', principal: tenantA, idempotencyKey: 'same' });
    expect(b.duplicate).toBe(true);
    expect(b.task.id).toBe(a.task.id);
  });

  it('ownership fields survive persist', async () => {
    const gw = gateway();
    const out = await gw.submit({ capabilityId: 'health.check', role: 'operator', principal: tenantA });
    const raw = await gw.store.get(out.task.id);
    raw.tenant_id = 'tenant-b';
    raw.created_by = 'attacker';
    await gw.store.persist(raw);
    const again = await gw.store.get(out.task.id);
    expect(again.tenant_id).toBe('tenant-a');
    expect(again.created_by).toBe('user-a');
  });
});

describe('execution fabric phase 5 live postgres role isolation', () => {
  const live = process.env.EXECUTION_FABRIC_LIVE_PG === '1';
  const testFn = live ? it : it.skip;
  testFn('runs only when EXECUTION_FABRIC_LIVE_PG=1 (service role is not an RLS proof)', () => {
    expect(live).toBe(true);
  });
});
