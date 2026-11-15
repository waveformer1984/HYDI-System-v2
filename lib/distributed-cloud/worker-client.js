'use strict';

const { signWorkerToken } = require('./auth');

/**
 * Home/cloud worker — initiates outbound calls to control plane (pull model).
 */
class DistributedCloudWorkerClient {
  constructor({ workerId, controlPlane, env = process.env, capabilities = ['lightweight'] }) {
    this.workerId = workerId;
    this.cp = controlPlane;
    this.env = env;
    this.capabilities = capabilities;
  }

  authToken() {
    return signWorkerToken(this.workerId, this.env);
  }

  register(resources = {}) {
    const token = this.authToken();
    if (!token) return { ok: false, error: 'no_worker_secret' };
    return this.cp.registerWorkerAuth(
      token,
      {
        worker_id: this.workerId,
        trust: resources.trust || 'home_trusted',
        resources: { ...resources, capabilities: this.capabilities },
      },
      this.env,
    );
  }

  heartbeat(patch = {}) {
    return this.cp.workerHeartbeat(this.workerId, patch);
  }

  pollAndRun(runners = {}) {
    const claim = this.cp.claimNext(this.workerId, { capabilities: this.capabilities });
    if (!claim.ok || !claim.task) return claim;
    const task = claim.task;
    const runner = runners[task.type];
    if (typeof runner === 'function') return runner(task);
    return this.cp.completeTask(this.workerId, task.id, { ok: true, simulated: true });
  }
}

module.exports = { DistributedCloudWorkerClient };