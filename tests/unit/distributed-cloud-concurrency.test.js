'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { DistributedCloudControlPlane } = require('../../lib/distributed-cloud/control-plane');
const { TASK_TYPES, TASK_STATES } = require('../../lib/distributed-cloud/constants');
const { signWorkerToken } = require('../../lib/distributed-cloud/auth');
const { loadStateFile } = require('../../lib/distributed-cloud/store');

const ENV = { HYDI_DISTRIBUTED_WORKER_SECRET: 'c'.repeat(32) };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dc-conc-'));
}

function register(cp, id) {
  return cp.registerWorkerAuth(signWorkerToken(id, ENV), { worker_id: id, resources: { capabilities: ['lightweight'] } }, ENV);
}

describe('distributed cloud concurrency (same host, file lock)', () => {
  test('parallel enqueues do not lose updates', () => {
    const dir = tempDir();
    const cp = new DistributedCloudControlPlane({ dir, lockTimeoutMs: 10_000 });
    const results = [];
    for (let i = 0; i < 24; i += 1) {
      results.push(cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: `job-${i}`, idempotency_key: `k-${i}` }));
    }
    expect(results.every((r) => r.ok)).toBe(true);
    const state = loadStateFile(path.join(dir, 'state.json'));
    expect(state.tasks.length).toBe(24);
    expect(state.write_seq).toBeGreaterThanOrEqual(24);
  });

  test('two workers cannot claim the same task', () => {
    const dir = tempDir();
    const cp = new DistributedCloudControlPlane({ dir });
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'exclusive' });
    register(cp, 'w-a');
    register(cp, 'w-b');
    const c1 = cp.claimNext('w-a', { capabilities: ['lightweight'] });
    const c2 = cp.claimNext('w-b', { capabilities: ['lightweight'] });
    const holders = [c1.task?.id, c2.task?.id].filter(Boolean);
    expect(holders.length).toBe(1);
    const state = loadStateFile(path.join(dir, 'state.json'));
    const task = state.tasks.find((t) => t.id === enq.task.id);
    expect(task.lease_holder).toBeTruthy();
    expect([c1.task?.lease_holder, c2.task?.lease_holder].filter(Boolean).length).toBe(1);
  });

  test('cross-process writers preserve task count', (done) => {
    const dir = tempDir();
    const child = fork(path.join(__dirname, '../../scripts/distributed-cloud-concurrent-child.js'), [dir, '12'], {
      env: { ...process.env, ...ENV },
    });
    const parentCp = new DistributedCloudControlPlane({ dir, lockTimeoutMs: 15_000 });
    let parentDone = 0;
    for (let i = 0; i < 12; i += 1) {
      parentCp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: `p-${i}`, idempotency_key: `parent-${i}` });
      parentDone += 1;
    }
    child.on('exit', (code) => {
      expect(code).toBe(0);
      const state = loadStateFile(path.join(dir, 'state.json'));
      expect(state.tasks.length).toBe(parentDone + 12);
      done();
    });
  });

  test('corrupt state file recovers to empty without throwing', () => {
    const dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), '{not-json', 'utf8');
    const cp = new DistributedCloudControlPlane({ dir });
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'after-corrupt' });
    expect(enq.ok).toBe(true);
    const state = loadStateFile(path.join(dir, 'state.json'));
    expect(state.version).toBe(2);
    expect(state.tasks.length).toBe(1);
  });
});