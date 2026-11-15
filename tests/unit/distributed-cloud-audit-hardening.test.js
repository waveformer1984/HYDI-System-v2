'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DistributedCloudControlPlane } = require('../../lib/distributed-cloud/control-plane');
const { DistributedCloudStore } = require('../../lib/distributed-cloud/store');
const { signWorkerToken, verifyWorkerToken } = require('../../lib/distributed-cloud/auth');
const { TASK_STATES, TASK_TYPES } = require('../../lib/distributed-cloud/constants');

const ENV = { HYDI_DISTRIBUTED_WORKER_SECRET: 'b'.repeat(32) };

describe('distributed cloud audit hardening', () => {
  test('lease reclaim after expiry simulates worker crash', () => {
    let now = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-lease-'));
    const cp = new DistributedCloudControlPlane({ dir, now: () => now, leaseMs: 1000 });
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'crash-test' });
    cp.registerWorkerAuth(signWorkerToken('w1', ENV), { worker_id: 'w1', resources: {} }, ENV);
    cp.claimNext('w1', { capabilities: ['lightweight'] });
    now += 5000;
    const reclaimed = cp.reclaimExpiredLeases();
    expect(reclaimed.reclaimed).toBeGreaterThanOrEqual(1);
    const tasks = cp.listTasks();
    const t = tasks.find((x) => x.id === enq.task.id);
    expect(t.state).toBe(TASK_STATES.QUEUED);
    expect(t.lease_holder).toBeFalsy();
  });

  test('HMAC rejects stale and replayed tokens', () => {
    const crypto = require('crypto');
    const oldTs = Math.floor(Date.now() / 1000) - 700;
    const jti = 'audit-stale';
    const payload = `w1:${oldTs}:${jti}`;
    const sig = crypto.createHmac('sha256', ENV.HYDI_DISTRIBUTED_WORKER_SECRET).update(payload).digest('hex');
    expect(verifyWorkerToken(`v2:${payload}:${sig}`, ENV).ok).toBe(false);
    const fresh = signWorkerToken('w1', ENV);
    const state = { auth_replay_used: {} };
    const { consumeWorkerToken } = require('../../lib/distributed-cloud/auth');
    expect(consumeWorkerToken(state, fresh, ENV).ok).toBe(true);
    expect(verifyWorkerToken(fresh, ENV, state).ok).toBe(false);
  });

  test('idempotency survives store reload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-idem-'));
    const cp1 = new DistributedCloudControlPlane({ dir });
    const key = 'persist-key';
    const a = cp1.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'a', idempotency_key: key });
    const cp2 = new DistributedCloudControlPlane({ dir });
    const b = cp2.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'b', idempotency_key: key });
    expect(b.deduped).toBe(true);
    expect(b.task.id).toBe(a.task.id);
  });

  test('serialized mutates preserve both writers (file lock)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-race-'));
    const s1 = new DistributedCloudStore({ dir });
    const s2 = new DistributedCloudStore({ dir });
    s1.mutate((st) => {
      st.tasks.push({ id: 't1', state: 'queued' });
      return { ok: true };
    });
    s2.mutate((st) => {
      st.tasks.push({ id: 't2', state: 'queued' });
      return { ok: true };
    });
    const final = s1.load();
    expect(final.tasks.some((t) => t.id === 't1')).toBe(true);
    expect(final.tasks.some((t) => t.id === 't2')).toBe(true);
  });
});