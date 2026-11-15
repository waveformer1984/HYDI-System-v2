#!/usr/bin/env node
'use strict';

const { DistributedCloudControlPlane } = require('../lib/distributed-cloud/control-plane');
const { TASK_TYPES } = require('../lib/distributed-cloud/constants');

const dir = process.argv[2];
const count = Number(process.argv[3] || 10);
const cp = new DistributedCloudControlPlane({ dir, lockTimeoutMs: 20_000 });

for (let i = 0; i < count; i += 1) {
  const out = cp.enqueueTask({ type: TASK_TYPES.LIGHTWEIGHT, objective: `child-${i}`, idempotency_key: `child-${i}` });
  if (!out.ok) process.exit(1);
}
process.exit(0);