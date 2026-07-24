# HYDI V3 Deployment Guide

This guide explains how to install, configure, and deploy the HYDI V3 reliability and autonomy layer.

## Prerequisites

- Node.js >= 20.x
- npm >= 10
- A writable `data/` directory (or configured `dataPath`)
- Required environment variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET_01`
  - `STRIPE_CONNECT_WEBHOOK_SECRET`
  - `ANTHROPIC_API_KEY` (optional, for external model use)

## Installation

```bash
npm install
```

## Local Deployment

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run benchmark:performance
npm run security-audit
npm run test:soak
```

Start the system:

```bash
node boot-agent.js
```

or

```bash
npm run dev   # Next.js frontend + API routes
```

## Configuration

The `HYDIAutonomyManager` accepts a `config` object:

| Option | Default | Purpose |
|--------|---------|---------|
| `dataPath` | `./data` | Root for V3 persistence |
| `enableWatchdog` | `true` | Supervise core agents |
| `enableHeartbeat` | `true` | Publish and monitor heartbeats |
| `enableGracefulShutdown` | `true` | Handle SIGINT/SIGTERM |
| `enableMissionPlanning` | `true` | Patch core loop pending tasks |
| `enableDecisionIntelligence` | `true` | Validate decisions before execution |
| `enableReflection` | `true` | Generate post-mission reflections |
| `enableSelfHealing` | `true` | Enable automatic recovery |
| `enableDistributedCompute` | `true` | Register local node and scheduling |
| `enableMemoryIntegrity` | `true` | Run nightly integrity scans |
| `enableObservability` | `true` | Record snapshots and dashboards |
| `enableSecurity` | `true` | Run security audit at startup |

Example:

```js
const manager = new HYDIAutonomyManager({
  coreLoop,
  orchestrator,
  memorySystem,
  actionLayer,
  modelStack,
  config: {
    dataPath: '/var/lib/hydi/data',
    enableGracefulShutdown: false,
    enableMissionPlanning: true,
    enableDecisionIntelligence: true,
  },
});
```

## Production Deployment Checklist

- [ ] `NODE_ENV=production`
- [ ] `data/` directory is on persistent storage and backed up
- [ ] All required environment variables are injected (no secrets in repo)
- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] `npm test`, `npm run test:integration`, `npm run test:soak` pass
- [ ] `npm run benchmark:performance` meets targets
- [ ] `npm run security-audit` passes
- [ ] Health endpoint `/api/health` is reachable
- [ ] Prometheus exporter is scraped (if used)
- [ ] Log aggregation is configured
- [ ] Backup job is scheduled for `data/`

## Container Deployment

Example `Dockerfile` snippet:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV DATA_PATH=/app/data
VOLUME ["/app/data"]
CMD ["node", "boot-agent.js"]
```

## Kubernetes Notes

- Mount a `PersistentVolumeClaim` at `dataPath`.
- Use a `livenessProbe` on `/api/health`.
- Use a `readinessProbe` that checks `manager.getStatus().started`.
- Store secrets in a `Secret` resource, not in the image.
- Set `resources.requests` and `resources.limits` to avoid OOM kills.

## Vercel / Next.js

- `api/` routes remain serverless.
- V3 background processes run in `boot-agent.js` or a long-lived container, not in serverless functions.
- Do not commit `.env` files; use Vercel environment variables.

## Rollback

1. Stop the running process.
2. Restore the previous `data/` snapshot.
3. Re-deploy the previous code version.
4. Start the process and verify `manager.getStatus()`.
