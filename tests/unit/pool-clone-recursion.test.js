'use strict';

const {
  createCloneExecutionContext,
  assertCloneContextHasNoPoolRefs,
  guardCloneExecution,
  drainRecursionLog,
} = require('../../lib/dev-workforce/clone-context');
const { runPoolCapability } = require('../../lib/dev-workforce/pool-actions');

describe('pool clone recursion guard', () => {
  it('clone execution context has no pool enqueue or registry refs', () => {
    const ctx = createCloneExecutionContext({ actor: 'clone:scout:1', templateId: 'scout' });
    expect(assertCloneContextHasNoPoolRefs(ctx).ok).toBe(true);
    expect(ctx.pool).toBeUndefined();
    expect(ctx.enqueueMission).toBeUndefined();
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('rejects forbidden capability from clone context and logs', async () => {
    drainRecursionLog();
    const ctx = { cloneExecution: createCloneExecutionContext({ actor: 'clone:1', templateId: 'scout' }) };
    const g = guardCloneExecution(ctx.cloneExecution, 'pool.mission_enqueue');
    expect(g.ok).toBe(false);
    const r = await runPoolCapability('pool.mission_enqueue', {}, ctx);
    expect(r.ok).toBe(false);
    expect(drainRecursionLog().some((e) => e.error === 'clone_forbidden_capability')).toBe(true);
  });

  it('rejects smuggled pool reference on context', async () => {
    drainRecursionLog();
    const bad = { ...createCloneExecutionContext({ actor: 'c' }), pool: { enqueueMission: () => {} } };
    const r = await runPoolCapability('pool.http_fetch', { url: 'https://example.com' }, {
      cloneExecution: bad,
      poolFetchDeps: {
        httpGet: async () => ({ status: 200, headers: {}, body: Buffer.from('x') }),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('clone_recursion_context');
    expect(drainRecursionLog().length).toBeGreaterThan(0);
  });
});