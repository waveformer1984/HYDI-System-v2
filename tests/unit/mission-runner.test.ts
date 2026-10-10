/**
 * MissionRunner unit tests — async dispatch semantics.
 *
 * The Phase G invariant: a mission may take longer than a cognitive
 * cycle without blocking, duplicating, starving, or corrupting the
 * loop. These tests prove the dispatch contract, not the executor.
 */

import { MissionRunner } from '../../lib/heidi/MissionRunner';
import { MissionLifecycle } from '../../lib/heidi/MissionLifecycle';

function fakePool() {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM heidi_goals')) return { rows: [] };
      return { rows: [{ id: 'x' }] };
    },
  } as unknown as import('pg').Pool;
}

function fakeGoals() {
  const fake = {
    updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
    updateGoal: async (id: string, updates: Record<string, unknown>) => {
      fake.updates.push({ id, updates });
      return { goalId: id, status: updates.status, context: {} };
    },
    getGoal: async () => ({ goalId: 'g1', context: {} }),
  };
  return fake;
}

function fakeRegistry(result: { executed: boolean; outcome: string; error?: string }, delayMs = 0) {
  const fake = {
    calls: [] as string[],
    execute: async (capId: string) => {
      fake.calls.push(capId);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      return { ...result, result: null, evidence: [] };
    },
  };
  return fake;
}

const CTX = { sessionId: 's', actorId: 'heidi', actorTrustLevel: 'trusted_system', authorizationMode: 'autonomous', auditTrail: [] } as never;

describe('MissionRunner', () => {
  it('dispatch returns immediately while work runs in background', async () => {
    const pool = fakePool();
    const goals = fakeGoals();
    const registry = fakeRegistry({ executed: true, outcome: 'success' }, 200);
    const runner = new MissionRunner({ pool, goals: goals as never, registry: registry as never, lifecycle: new MissionLifecycle(pool) });

    const t0 = Date.now();
    const d = await runner.dispatch('g1', 'ops.test', {}, CTX);
    const elapsed = Date.now() - t0;

    expect(d.dispatched).toBe(true);
    expect(elapsed).toBeLessThan(200); // dispatch does not wait for execution
    await new Promise(r => setTimeout(r, 300));
    expect(runner.stats().running).toBe(0);
    expect(goals.updates.some(u => u.updates.status === 'completed')).toBe(true);
  });

  it('never double-dispatches an in-flight goal', async () => {
    const pool = fakePool();
    const goals = fakeGoals();
    const registry = fakeRegistry({ executed: true, outcome: 'success' }, 300);
    const runner = new MissionRunner({ pool, goals: goals as never, registry: registry as never, lifecycle: new MissionLifecycle(pool) });

    const d1 = await runner.dispatch('g1', 'ops.test', {}, CTX);
    const d2 = await runner.dispatch('g1', 'ops.test', {}, CTX);
    expect(d1.dispatched).toBe(true);
    expect(d2.dispatched).toBe(false);
    expect(d2.reason).toBe('already_running');
    await new Promise(r => setTimeout(r, 400));
    expect(registry.calls).toEqual(['ops.test']); // executed once
  });

  it('enforces the concurrency cap honestly', async () => {
    const pool = fakePool();
    const goals = fakeGoals();
    const registry = fakeRegistry({ executed: true, outcome: 'success' }, 300);
    const runner = new MissionRunner({ pool, goals: goals as never, registry: registry as never, lifecycle: new MissionLifecycle(pool), maxConcurrent: 2 });

    await runner.dispatch('a', 'ops.t', {}, CTX);
    await runner.dispatch('b', 'ops.t', {}, CTX);
    const d3 = await runner.dispatch('c', 'ops.t', {}, CTX);
    expect(d3.dispatched).toBe(false);
    expect(d3.reason).toBe('concurrency_cap:2');
    await new Promise(r => setTimeout(r, 400));
  });

  it('classifies transient failure as bounded retry — goal returns to pending', async () => {
    const pool = fakePool();
    const goals = fakeGoals();
    const registry = fakeRegistry({ executed: true, outcome: 'failure', error: 'connection timed out' });
    const runner = new MissionRunner({ pool, goals: goals as never, registry: registry as never, lifecycle: new MissionLifecycle(pool), maxAttempts: 2 });

    await runner.dispatch('g1', 'ops.t', {}, CTX);
    await new Promise(r => setTimeout(r, 100));
    const last = goals.updates.at(-1);
    expect(last?.updates.status).toBe('pending'); // transient → requeued
  });

  it('classifies governance failure as escalation, never retried', async () => {
    const pool = fakePool();
    const goals = fakeGoals();
    const registry = fakeRegistry({ executed: false, outcome: 'failure', error: 'not authorized: policy' });
    const runner = new MissionRunner({ pool, goals: goals as never, registry: registry as never, lifecycle: new MissionLifecycle(pool) });

    await runner.dispatch('g1', 'ops.t', {}, CTX);
    await new Promise(r => setTimeout(r, 100));
    const last = goals.updates.at(-1);
    expect(last?.updates.status).toBe('escalated');
  });
});
