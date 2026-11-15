'use strict';

const { DistributedCloudControlPlane } = require('../distributed-cloud/control-plane');

function mobileSnapshot(opts = {}) {
  const cp = opts.controlPlane || new DistributedCloudControlPlane(opts);
  const status = cp.status();
  const tasks = cp.listTasks({ limit: 30 });
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    control_plane: status,
    jobs: tasks,
    durable: true,
    simulated: Boolean(opts.simulated),
  };
}

module.exports = { mobileSnapshot };