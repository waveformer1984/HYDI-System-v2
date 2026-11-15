#!/usr/bin/env node
'use strict';

/**
 * Live/smoke harness for distributed cloud control plane.
 * Writes evidence JSON — never logs secrets.
 *
 * Environment: HYDI_DISTRIBUTED_WORKER_SECRET or HYDI_SERVICE_SECRET
 * Modes:
 *   default — VM-local worker (VERIFIED SIMULATED unless FRANK_WORKER=1)
 *   LIVE_NETWORK=1 — hit remotive read-only API (VERIFIED LIVE network only)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomBytes } = require('crypto');
const { DistributedCloudControlPlane } = require('../lib/distributed-cloud/control-plane');
const { DistributedCloudWorkerClient } = require('../lib/distributed-cloud/worker-client');
const { TASK_TYPES, TASK_STATES } = require('../lib/distributed-cloud/constants');
const { mobileSnapshot } = require('../lib/heidi-mobile/distributed-cloud-snapshot');

const RUN_ID = `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
const EVIDENCE_DIR = process.env.HYDI_SMOKE_EVIDENCE_DIR || path.join(process.cwd(), '.runtime', 'distributed-cloud', 'evidence');

function ensureSecret() {
  if (!process.env.HYDI_DISTRIBUTED_WORKER_SECRET && !process.env.HYDI_SERVICE_SECRET) {
    process.env.HYDI_DISTRIBUTED_WORKER_SECRET = randomBytes(32).toString('hex');
  }
}

async function maybeLiveNetwork() {
  if (process.env.LIVE_NETWORK !== '1') return { mode: 'skipped', ok: null };
  try {
    const res = await fetch('https://remotive.com/api/remote-jobs', { signal: AbortSignal.timeout(10000) });
    return { mode: 'VERIFIED_LIVE', ok: res.ok, status: res.status, note: 'read-only GET public API' };
  } catch (error) {
    return { mode: 'VERIFIED_LIVE', ok: false, error: error instanceof Error ? error.message : 'error' };
  }
}

async function main() {
  ensureSecret();
  const dir = path.join(process.cwd(), '.runtime', 'distributed-cloud-smoke', RUN_ID);
  const cp = new DistributedCloudControlPlane({ dir });
  const workerId = process.env.FRANK_WORKER === '1' ? 'frank-home-live' : 'cloud-agent-vm';

  const timeline = [];
  const stamp = (event, detail = {}) => {
    timeline.push({ at: new Date().toISOString(), event, ...detail });
  };

  stamp('coordinator_created', { runId: RUN_ID, dir, workerId });
  const enq = cp.enqueueTask({
    type: TASK_TYPES.LIGHTWEIGHT,
    objective: `diagnostic:${RUN_ID}`,
    input: { diagnostic: 'hostname_uptime', hostname: os.hostname() },
    idempotency_key: RUN_ID,
  });
  stamp('job_enqueued', { taskId: enq.task?.id, ok: enq.ok });

  const client = new DistributedCloudWorkerClient({
    workerId,
    controlPlane: cp,
    capabilities: ['lightweight'],
  });
  const reg = client.register({ trust: 'cloud_light', resources: { cpu_avail: os.cpus().length, mem_avail_gb: (os.freemem() / 1e9).toFixed(1), network: 'cloud' } });
  stamp('worker_registered', { ok: reg.ok, workerId });

  const claim = cp.claimNext(workerId, { capabilities: ['lightweight'] });
  stamp('job_claimed', { taskId: claim.task?.id, state: TASK_STATES.CLAIMED });

  const start = cp.startTask(workerId, claim.task.id);
  stamp('lease_running', { ok: start.ok });

  const diag = {
    hostname: os.hostname(),
    loadavg: os.loadavg(),
    freemem_gb: Number((os.freemem() / 1e9).toFixed(2)),
    uptime_s: os.uptime(),
    node: process.version,
  };
  const done = cp.completeTask(workerId, claim.task.id, { ok: true, diagnostic: diag }, { idempotencyKey: `${RUN_ID}-complete` });
  stamp('job_completed', { state: done.task?.state, ok: done.task?.result_summary?.ok });

  const mobile = mobileSnapshot({ controlPlane: cp, simulated: process.env.FRANK_WORKER !== '1' });
  const network = await maybeLiveNetwork();

  const classification = process.env.FRANK_WORKER === '1' ? 'VERIFIED_LIVE' : 'VERIFIED_SIMULATED';
  const evidence = {
    run_id: RUN_ID,
    classification,
    worker_id: workerId,
    task_id: claim.task?.id,
    final_state: done.task?.state,
    diagnostic: diag,
    timeline,
    mobile_job_count: mobile.jobs?.length,
    network_probe: network,
    tailscale: process.env.TS_AUTHKEY ? 'CONFIGURED_BUT_UNTESTED' : 'BLOCKED_no_TS_AUTHKEY',
    frank: process.env.FRANK_WORKER === '1' ? 'VERIFIED_LIVE' : 'BLOCKED_not_on_frank',
  };

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const out = path.join(EVIDENCE_DIR, `${RUN_ID}.json`);
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, evidence_file: out, classification, task_id: claim.task?.id, state: done.task?.state }));
  process.exit(done.task?.state === TASK_STATES.COMPLETED ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'error' }));
  process.exit(1);
});