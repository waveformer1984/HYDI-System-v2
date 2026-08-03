# Container Health Assessment

**Date:** 2026-08-03
**Scope:** Unhealthy, crash-looping, and exited containers observed on the host.

## Container Inventory by Status

### Running but unhealthy

| Container | Project | Status | Evidence |
|-----------|---------|--------|----------|
| `ursula-hub` | `ursula_suite` | `unhealthy` (exit 0) | Docker health status = `unhealthy`; logs show `/health` endpoint responding 200, but health check apparently not meeting Docker's retry window |

### Crash-looping / restarting

| Container | Project | Status | Evidence |
|-----------|---------|--------|----------|
| `supabase_vector_hydi-local-supabase` | `hydi-local-supabase` | `restarting` (0), 2451 restarts | Vector cannot connect to Docker daemon `/var/run/docker.sock` (connection refused 111) and exits; container immediately restarts |

### Exited containers

| Container | Project | Exit code | Evidence |
|-----------|---------|-----------|----------|
| `hydi-grafana` | `docker` (TailNet) | 0 (clean) | Exited 2 weeks ago; not part of qualification |
| `protoforge-postgres` | `outputs` | 0 (clean) | Exited 44 hours ago; not part of qualification |
| `redis` | none | 255 | Exited 4 weeks ago; no compose project; stale container |
| `supabase_edge_runtime_hydi-local-supabase` | `hydi-local-supabase` | 255 | Exited 9 days ago; Deno 2.1.4 / std 0.224.0 compatibility warnings observed in log |

## Root-Cause Analysis

### `ursula-hub` (unhealthy)

- **Observation:** Logs contain continuous `GET /health` entries with timestamps. The endpoint is returning something (HTTP access log is being generated).
- **Docker `State.Health.Status`:** `unhealthy`.
- **Restart count:** 0, exit code 0, container still running.
- **Likely cause:** The Docker `HEALTHCHECK` test is `curl -f http://localhost:4000/health`. The log shows the endpoint responding, but the health check may be timing out or returning a non-2xx status. This can happen if:
  - the response body is large and `curl` exits non-zero,
  - `curl` is not in the image,
  - the container briefly failed the first N retries during startup and then never re-healthy,
  - the Node process is running but the `/health` route returns an error when the database or `flask-backend` is unavailable.
- **Impact on qualification:** `heidi-bridge` depends on `PROTOHUB_URL=http://localhost:4000`. If `ursula-hub` is unhealthy, the bridge health check may fail, causing the `bridge-request` workload to fail. This will lower the qualification success rate.
- **Whether it contributes to memory pressure:** No. It uses 183.3 MiB and is already running.

### `supabase_vector_hydi-local-supabase` (restarting)

- **Observation:** The latest log repeats:
  ```
  ERROR vector::sources::docker_logs: Listing currently running containers failed.
    error=... ConnectError("tcp connect error", Os { code: 111, ... "Connection refused" })
  ```
- **Likely cause:** Vector's `docker_logs` source is configured to read the Docker engine API, but the container cannot reach `/var/run/docker.sock` or the Docker API endpoint is not exposed inside the container.
- **Restart count:** 2451, indicating it has been in a tight restart loop for ~37 hours of uptime.
- **Impact on qualification:** Vector is a log shipper. It is **not required** for `api/health`, `api/chat`, or the `heidi-bridge`. The qualification does not depend on it.
- **Whether it contributes to memory pressure:** Minimal. It reports 0B memory in `docker stats` because it exits quickly, but the restart loop consumes some CPU and scheduling overhead. It should be stopped before qualification to remove noise.

### `supabase_edge_runtime_hydi-local-supabase` (exited 255)

- **Observation:** Log ends with Deno 2.1.4 / `supabase-edge-runtime-1.73.3` and a warning about `https://deno.land/std/path/posix/mod.ts` version `0.224.0`.
- **Likely cause:** The edge runtime may have crashed due to a missing or incompatible Deno import. It is an **optional** local Supabase component for running Edge Functions; the main DB, REST, Auth, and Storage are independent of it.
- **Impact on qualification:** None unless the qualification explicitly calls a local Supabase Edge Function. `qualification-config.json` endpoints are all `localhost:3000` or `localhost:5050`.
- **Whether it contributes to memory pressure:** No. It is not running.

### `protoforge-postgres` (exited 0)

- **Observation:** Clean exit, not part of any running HYDI qualification workload.
- **Project:** `outputs` (Claude scratch directory).
- **Impact on qualification:** None.
- **Whether it contributes to memory pressure:** No. Exited containers retain no runtime memory; they occupy disk (1.04 MB from `docker system df`).

### `hydi-grafana` (exited 0) and standalone `redis` (exited 255)

- **Observation:** Both exited; `hydi-grafana` from TailNet, `redis` has no compose project.
- **Impact on qualification:** None.
- **Whether it contributes to memory pressure:** No.

## Health Summary

| Container | Critical for qualification? | Action recommended |
|-----------|----------------------------|--------------------|
| `ursula-hub` | Yes | Investigate `/health` response and `HEALTHCHECK` configuration; ensure `ursula-flask` is running |
| `supabase_vector` | No | Stop the restart loop before qualification to reduce noise |
| `supabase_edge_runtime` | No | Optional Supabase component; can be left stopped |
| `protoforge-postgres` | No | No action; already exited |
| `hydi-grafana` | No | No action; already exited |
| `redis` (standalone) | No | Verify not needed, then remove as part of cleanup |
