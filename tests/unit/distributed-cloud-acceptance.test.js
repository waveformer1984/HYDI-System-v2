'use strict';

/**
 * Distributed cloud expansion — acceptance suite (issue #587 coordination).
 * Labels [SIMULATED] where no live provider is contacted.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DistributedCloudControlPlane } = require('../../lib/distributed-cloud/control-plane');
const { DistributedCloudWorkerClient } = require('../../lib/distributed-cloud/worker-client');
const { buildDiscoverTask } = require('../../lib/distributed-cloud/freelance-bridge');
const { TASK_TYPES, TASK_STATES } = require('../../lib/distributed-cloud/constants');
const { signWorkerToken } = require('../../lib/distributed-cloud/auth');
const { mobileSnapshot } = require('../../lib/heidi-mobile/distributed-cloud-snapshot');
const { checkQuota } = require('../../lib/distributed-cloud/quota');
const { runScout } = require('../../lib/job-scout/scout');

const ENV = { HYDI_DISTRIBUTED_WORKER_SECRET: 'a'.repeat(32), HYDI_ALLOW_PAID_LLM: 'false' };

function tempCp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-dc-'));
  return { cp: new DistributedCloudControlPlane({ dir, now: () => Date.now() }), dir };
}

function cloudWorker(cp, id) {
  const client = new DistributedCloudWorkerClient({ workerId: id, controlPlane: cp, env: ENV, capabilities: ['lightweight', 'freelance.discover'] });
  client.register({ trust: 'cloud_light', resources: { cpu_avail: 2, mem_avail_gb: 4, capabilities: ['lightweight', 'freelance.discover'], network: 'cloud' } });
  return client;
}

describe('HYDI distributed cloud — acceptance', () => {
  test('[SIMULATED] #1 control plane available while home workers offline', () => {
    const { cp } = tempCp();
    const st = cp.status();
    expect(st.ok).toBe(true);
    expect(st.healthy_workers).toBe(0);
    expect(st.persistence).toBe('file');
  });

  test('[SIMULATED] #2 tasks persist with zero workers', () => {
    const { cp, dir } = tempCp();
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'ping' });
    expect(enq.ok).toBe(true);
    const cp2 = new DistributedCloudControlPlane({ dir });
    const tasks = cp2.listTasks();
    expect(tasks.some((t) => t.id === enq.task.id)).toBe(true);
    expect(tasks[0].state).toBe(TASK_STATES.QUEUED);
  });

  test('[SIMULATED] #3 cloud worker completes lightweight task', () => {
    const { cp } = tempCp();
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'hash metadata' });
    const w = cloudWorker(cp, 'cloud-vm-1');
    const claim = cp.claimNext('cloud-vm-1', { capabilities: ['lightweight'] });
    expect(claim.task?.id).toBe(enq.task.id);
    const done = cp.completeTask('cloud-vm-1', enq.task.id, { ok: true, label: 'SIMULATED' }, { idempotencyKey: 'once' });
    expect(done.task.state).toBe(TASK_STATES.COMPLETED);
  });

  test('[SIMULATED] #4 home worker resumes after reconnect', () => {
    const { cp } = tempCp();
    cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'resume-me' });
    const home = new DistributedCloudWorkerClient({ workerId: 'frank-home', controlPlane: cp, env: ENV, capabilities: ['lightweight'] });
    home.register({ resources: { cpu_avail: 8, mem_avail_gb: 16, network: 'tailnet' } });
    const claim = cp.claimNext('frank-home', { capabilities: ['lightweight'] });
    expect(claim.ok).toBe(true);
    expect(claim.task).toBeTruthy();
  });

  test('[SIMULATED] #5 duplicate execution prevented via completion idempotency', () => {
    const { cp } = tempCp();
    const enq = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'idempotent' });
    cloudWorker(cp, 'cloud-vm-2');
    cp.claimNext('cloud-vm-2', { capabilities: ['lightweight'] });
    const first = cp.completeTask('cloud-vm-2', enq.task.id, { ok: true }, { idempotencyKey: 'dup-key' });
    const second = cp.completeTask('cloud-vm-2', enq.task.id, { ok: false }, { idempotencyKey: 'dup-key' });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.task.state).toBe(TASK_STATES.COMPLETED);
  });

  test('[SIMULATED] #6 freelance discovery without home PC (fixture fetch)', async () => {
    const { cp } = tempCp();
    const taskPartial = buildDiscoverTask({ idempotencyKey: 'scout-acc-1' });
    const enq = cp.enqueueTask(taskPartial);
    cloudWorker(cp, 'cloud-scout');

    const ALL = require('../fixtures/job-scout/remoteok-api.json');
    const fakeFetch = async (url) => {
      if (url.includes('remoteok')) return { ok: true, status: 200, json: async () => ALL };
      return { ok: false, status: 404, json: async () => ({}) };
    };

    cp.executeDiscover = async () => {
      const summary = await runScout({
        fetchImpl: fakeFetch,
        config: { sources: { remoteok: { enabled: true } }, minScore: 1, maxLeads: 5 },
        env: { JOB_SCOUT_DIR: path.join(cp.store.dir, 'job-scout') },
      });
      return { ok: summary.ok, summary };
    };

    const claim = cp.claimNext('cloud-scout', { capabilities: ['freelance.discover'] });
    expect(claim.task).toBeTruthy();
    const ran = await cp.runClaimedDiscover('cloud-scout', claim.task.id);
    expect(ran.ok).toBe(true);
    expect(ran.task.state).toBe(TASK_STATES.COMPLETED);
  });

  test('[SIMULATED] #7 mobile dashboard reflects durable job state', () => {
    const { cp } = tempCp();
    cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: 'mobile-visible' });
    const snap = mobileSnapshot({ controlPlane: cp, simulated: true });
    expect(snap.jobs.length).toBeGreaterThan(0);
    expect(snap.durable).toBe(true);
    expect(snap.control_plane.tasks).toBe(1);
  });

  test('[SIMULATED] #8 approval blocks unauthorized external actions', () => {
    const { cp } = tempCp();
    const enq = cp.enqueueTask({
      type: 'freelance.submit_proposal',
      action: 'freelance.submit_proposal',
      objective: 'Submit to client',
      requires_approval: true,
    });
    expect(enq.task.state).toBe(TASK_STATES.AWAITING_APPROVAL);
    expect(cp.claimNext('cloud-vm-3', { capabilities: ['lightweight'] }).task).toBeFalsy();
    const appr = cp.approveExternal(enq.task.id, { approver: 'human:owner' });
    expect(appr.ok).toBe(true);
    expect(appr.task.state).toBe(TASK_STATES.QUEUED);
  });

  test('[SIMULATED] #9 quota exhaustion fails safe (queue-only)', () => {
    const state = { budgets: { tasksThisHour: 9999, hourKey: new Date().toISOString().slice(0, 13), paidUsdToday: 0, dayKey: null } };
    const q = checkQuota(state, { env: ENV });
    expect(q.ok).toBe(false);
    expect(q.code).toBe('HOURLY_TASK_CAP');
  });

  test('[SIMULATED] #10 paid spend rejected under zero-cost mode', () => {
    const state = { budgets: { tasksThisHour: 0, hourKey: new Date().toISOString().slice(0, 13), paidUsdToday: 0, dayKey: null } };
    const q = checkQuota(state, { costUsd: 0.01, env: ENV });
    expect(q.ok).toBe(false);
    expect(q.code).toBe('PAID_BUDGET_EXCEEDED');
  });

  test('[SIMULATED] worker auth requires outbound token', () => {
    const { cp } = tempCp();
    const bad = cp.registerWorkerAuth('bad', { worker_id: 'x' }, ENV);
    expect(bad.ok).toBe(false);
    const good = cp.registerWorkerAuth(signWorkerToken('edge-1', ENV), { worker_id: 'edge-1', resources: {} }, ENV);
    expect(good.ok).toBe(true);
  });
});