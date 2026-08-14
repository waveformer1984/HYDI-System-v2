# Heidi Capability Matrix

## Risk Levels

| Level | Auto-execute | Requires Approval | Example |
|---|---|---|---|
| READ | yes | no | `health.read` |
| LOW | yes | no | `health.recover`, `test.run` |
| MEDIUM | dry-run default | no | `docker.local`, `wsl.local` |
| HIGH | no | yes | `database.local` (destructive subset) |
| CRITICAL | no | yes | `deploy.production`, `database.destructive` |

## Default Capabilities

| Capability | Risk | Environment | Target | Approval | Reversible | Timeout |
|---|---|---|---|---|---|---|
| `health.read` | READ | local | any | no | yes | 60s |
| `health.recover` | LOW | local | safe-local | no | yes | 60s |
| `test.run` | LOW | local | any | no | yes | 300s |
| `build.run` | LOW | local | any | no | yes | 600s |
| `git.local` | LOW | local | workspace | no | yes | 120s |
| `docker.local` | MEDIUM | local | any | no | yes | 120s |
| `wsl.local` | MEDIUM | local | any | no | yes | 120s |
| `database.local` | MEDIUM | local | any | no | yes | 120s |
| `deploy.production` | CRITICAL | production | vercel | yes | no | 300s |
| `credential.production` | CRITICAL | production | any | yes | no | 120s |
| `financial.transaction` | CRITICAL | production | any | yes | no | 120s |
| `database.destructive` | CRITICAL | production | any | yes | no | 60s |

## Registry API

```js
const { CapabilityRegistry } = require('./src/heidi-executive');
const reg = new CapabilityRegistry();
reg.register({
  id: 'my.action',
  riskLevel: 'LOW',
  requiresApproval: false,
  timeoutMs: 120000,
  retryPolicy: { maxRetries: 2, backoffMs: 1000 },
});
```
