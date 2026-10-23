# HEIDI Failure Taxonomy

## Purpose

Bounded classification of observed symptoms. HEIDI never fabricates a cause: if the evidence does not match a known class, the classification is `UNKNOWN_FAILURE` with `LOW` confidence.

## Failure classes

| Class | Meaning | Common patterns |
|---|---|---|
| `APPLICATION_FAILURE` | A Node/Python/Next.js process or module failed | `module_not_found`, syntax errors, uncaught exceptions |
| `CONTAINER_FAILURE` | A Docker container exited or is in a crash loop | `exited`, `restarting`, `crash loop` |
| `DOCKER_RUNTIME_FAILURE` | The Docker daemon/API is not reachable | `docker daemon`, `cannot connect to docker`, `dockerd` |
| `WSL_RUNTIME_FAILURE` | WSL is not responding | `wsl`, `the operation timed out`, distro errors |
| `DATABASE_FAILURE` | PostgreSQL / Supabase database is unavailable | `postgres`, `pgrst`, `database connection refused` |
| `CACHE_FAILURE` | Redis or other cache is unavailable | `redis`, `cache connection` |
| `NETWORK_FAILURE` | TCP/HTTP connection failed | `ECONNREFUSED`, `ETIMEDOUT`, `socket hang up` |
| `PORT_FAILURE` | Address already in use or port unreachable | `EADDRINUSE`, `already in use` |
| `DEPENDENCY_FAILURE` | A required upstream service is unhealthy | `dependency not ready`, `unhealthy` |
| `RESOURCE_EXHAUSTION` | CPU, memory, or disk pressure | `out of memory`, `no space left`, `disk full` |
| `CONFIGURATION_FAILURE` | Missing or invalid environment / configuration | `missing env`, `invalid configuration` |
| `AUTHENTICATION_FAILURE` | Auth token, HMAC, or credential rejection | `unauthorized`, `forbidden`, `invalid token` |
| `UNKNOWN_FAILURE` | Evidence does not match any known class | — |

## Classification output

```json
{
  "failure_class": "DOCKER_RUNTIME_FAILURE",
  "confidence": "MEDIUM",
  "matched": "cannot connect to docker"
}
```

## Source

Implemented in `src/heidi-executive/FailureClassifier.js`.
