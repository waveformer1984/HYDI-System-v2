'use strict';

/**
 * Hardening for PR #371: prototype-safe redaction and summaries, role
 * propagation from the typed-action gate, fail-closed role handling, and
 * tenant-aware re-verification.
 */

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { TaskStore } = require('../../lib/execution-fabric/task-store');
const { redactSensitive } = require('../../lib/execution-fabric/access');
const { buildOperationalSummary } = require('../../lib/execution-fabric/operational-summary');
const ops = require('../../lib/mobile-ops/ops-task-actions');
const { executeTypedAction } = require('../../lib/mobile-ops/typed-actions');

function gateway() {
  const store = new TaskStore({ now: () => Date.now(), randomBytes: () => Buffer.alloc(12, 7) });
  return new ExecutionGateway({
    store,
    skipRecovery: true,
    executeSync: jest.fn(async () => ({ ok: true, probes: [{ ok: true, name: 'heidi-web' }] })),
  });
}

const tenantA = { subject: 'user-a', role: 'operator', tenant_id: 'tenant-a', auth_source: 'tenant_resolver' };

describe('prototype-safe structures', () => {
  it('redactSensitive drops __proto__/constructor/prototype keys from untrusted input', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"keep":"ok","nested":{"__proto__":{"polluted":true}}}');
    const out = redactSensitive(input);
    expect(Object.keys(out)).toEqual(['keep', 'nested']);
    expect(out.polluted).toBeUndefined();
    expect(out.nested.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(out))).toEqual({ keep: 'ok', nested: {} });
  });

  it('operational summary ignores prototype-named states', async () => {
    const store = { list: async () => ({ tasks: [{ id: 'a', state: '__proto__' }, { id: 'b', state: 'QUEUED' }] }) };
    const summary = await buildOperationalSummary(store);
    expect(summary.queued).toBe(1);
    expect(Object.keys(summary.counts_by_state)).toEqual(['QUEUED']);
  });
});

describe('role handling', () => {
  it('ops actions refuse when no role is supplied instead of defaulting to operator', async () => {
    const gw = gateway();
    const created = await gw.submit({ capabilityId: 'health.check', role: 'operator' });
    for (const fn of [ops.opsTaskStatus, ops.opsTaskCancel, ops.opsTaskResume, ops.opsTaskVerify]) {
      const out = await fn({ task_id: created.task.id }, { executionGateway: gw });
      expect(out).toEqual({ ok: false, error: 'role_required' });
    }
    const approve = await ops.opsTaskApprove({ task_id: created.task.id, confirm: true }, { executionGateway: gw });
    expect(approve).toEqual({ ok: false, error: 'role_required' });
  });

  it('the typed-action gate passes the caller role through to the runner', async () => {
    const gw = gateway();
    const created = await gw.submit({ capabilityId: 'health.check', role: 'operator' });
    const getTask = jest.spyOn(gw, 'getTask');
    await executeTypedAction({ action: 'ops.task_status', args: { task_id: created.task.id }, role: 'viewer', ctx: { executionGateway: gw } });
    expect(getTask).toHaveBeenCalled();
    expect(getTask.mock.calls[0][1]).toBe('viewer');
  });
});

describe('tenant-aware re-verification', () => {
  it('opsTaskVerify passes the principal, so a tenant can re-verify its own task', async () => {
    const gw = gateway();
    const created = await gw.submit({ capabilityId: 'health.check', role: 'operator', principal: tenantA });
    const getTask = jest.spyOn(gw, 'getTask');
    const out = await ops.opsTaskVerify({ task_id: created.task.id }, { executionGateway: gw, role: 'operator', principal: tenantA });
    expect(getTask.mock.calls[0][2]).toBe(tenantA);
    expect(out.error).not.toBe('tenant_binding_required');
  });
});
