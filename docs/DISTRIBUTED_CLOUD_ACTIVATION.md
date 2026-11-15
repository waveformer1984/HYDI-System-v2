# Activation instructions (operator — not executed by agent)

## Control plane (cloud or Frank)

```bash
export HYDI_DISTRIBUTED_WORKER_SECRET="$(node -e "require('crypto').randomBytes(32).toString('hex')")"
export HYDI_DISTRIBUTED_CLOUD_DIR="/path/to/.runtime/distributed-cloud"
# Optional loopback HTTP surface:
node scripts/distributed-cloud-serve.js
```

## Home worker (outbound only)

```bash
export HYDI_DISTRIBUTED_WORKER_SECRET="<same as control plane>"
export HYDI_REPO_ROOT="/path/to/HYDI-System-v2"
node -e "
const { DistributedCloudControlPlane } = require('./lib/distributed-cloud/control-plane');
const { DistributedCloudWorkerClient } = require('./lib/distributed-cloud/worker-client');
const cp = new DistributedCloudControlPlane();
const w = new DistributedCloudWorkerClient({ workerId: 'frank-home', controlPlane: cp });
w.register({ resources: { cpu_avail: 8, mem_avail_gb: 16, network: 'tailnet', capabilities: ['lightweight','freelance.discover'] } });
console.log(w.pollAndRun());
"
```

## Mobile

Pair phone → open Heidi Mobile → `GET /api/heidi-mobile/distributed-jobs` (new route).

## Freelance discover task (scheduler follow-up)

Enqueue from heidi-core or a cron job:

```bash
node -e "const {DistributedCloudControlPlane}=require('./lib/distributed-cloud/control-plane');
const {buildDiscoverTask}=require('./lib/distributed-cloud/freelance-bridge');
const cp=new DistributedCloudControlPlane();
console.log(cp.enqueueTask(buildDiscoverTask()));"
```

## Rollback

Remove `.runtime/distributed-cloud/` and unset env vars. No migrations to revert.