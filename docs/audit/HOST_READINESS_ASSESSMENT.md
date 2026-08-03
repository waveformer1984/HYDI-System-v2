# Updated Host Readiness Assessment

**Date:** 2026-08-03
**Assessor:** Principal Site Reliability Engineer

## Summary

The host is currently **NOT READY** for a 24-hour HYDI operational qualification. Isolating Docker stacks is a prerequisite and will free approximately **833 MiB** of WSL2 memory, but it does not address the larger host memory pressure caused by non-Docker processes. The host cannot be considered fully ready without also reducing those Windows workloads or adding physical memory.

## Current State

| Resource | Measured value |
|----------|----------------|
| Total physical memory | ~15.7 GiB |
| Free physical memory | ~1.27 GiB |
| Running Docker containers | 26 |
| Docker memory used | ~1.54 GiB |
| Unrelated Docker memory | ~304.9 MiB |
| Optional Supabase Docker memory | ~528.2 MiB |
| WSL2 VM working set (`vmmemWSL`) | ~1.97 GiB |
| Largest non-Docker consumer | `Devin` (~1.38 GiB working set) |

## Required vs. Unrelated Services

### Required for qualification

- `hydi-local-supabase`: `supabase_db`, `supabase_kong`, `supabase_rest`, `supabase_auth`, `supabase_realtime`, `supabase_storage`
- `ursula_suite`: `ursula-postgres`, `ursula-redis`, `ursula-hub`, plus `ursula-flask` (must also start)
- Non-Docker: `next-app`, `hydi-core`, `memory-engine`, `heidi-bridge`, `supervisor`

### Not required for qualification

- `docker` (HYDI-TailNet): 8 running containers
- `outputs` (protoforge monitoring): 3 running containers
- `supabase_inbucket`, `supabase_pg_meta`, `supabase_studio`, `supabase_analytics`
- `supabase_vector` (already crash-looping)
- `supabase_edge_runtime` (already exited)
- Standalone `redis` container (exited)

## Health Issues to Resolve

| Container | Status | Required? | Action |
|-----------|--------|-----------|--------|
| `ursula-hub` | unhealthy | Yes | Investigate `/health` route and `HEALTHCHECK` config; start `ursula-flask` |
| `supabase_vector` | crash-looping (2451 restarts) | No | Stop to reduce CPU churn |
| `supabase_edge_runtime` | exited 255 | No | Optional; can remain stopped |
| `hydi-grafana` / `protoforge-postgres` / `redis` | exited | No | None; do not delete without approval |

## Is Isolation Sufficient?

**No.**

- Docker isolation will reduce the WSL2 footprint by roughly **833 MiB**, but the projected qualification Docker footprint will still be ~815 MiB.
- Windows still has only ~1.27 GiB of free physical memory.
- The top Windows consumers (`Devin`, `language_server_windows_x64`, `comet`, `ChatGPT Classic`, `claude`) are unrelated to the qualification and are using the bulk of host memory.
- A 24-hour qualification of `next-app`, the soak harness, `hydi-core`, `memory-engine`, and `heidi-bridge` under the current physical memory state will likely trigger memory pressure, swap, and performance artifacts that are not caused by HYDI.

## Classification

| Criterion | Status |
|-----------|--------|
| Every running Docker stack classified | **Complete** (see `DOCKER_STACK_CLASSIFICATION_REPORT.md`) |
| HYDI runtime dependencies identified | **Complete** (see `RUNTIME_DEPENDENCY_REPORT.md`) |
| Minimum qualification service set documented | **Complete** (see `QUALIFICATION_ISOLATION_PLAN.md`) |
| Reversible isolation plan exists | **Complete** (see `QUALIFICATION_ISOLATION_PLAN.md`) |
| No containers stopped or deleted | **Confirmed** during investigation |
| Host made ready by Docker isolation alone | **No** — insufficient |

## Recommendation

1. Execute the `QUALIFICATION_ISOLATION_PLAN.md` to stop unrelated and optional Docker containers.
2. Start `ursula-flask` (`flask-backend`) so `heidi-bridge` has both `localhost:4000` and `localhost:5000`.
3. Investigate the `ursula-hub` health check failure and confirm `/health` returns HTTP 200 within the Docker timeout.
4. **Before** starting the 24-hour qualification, either:
   - free an additional 2–4 GiB of Windows physical memory by closing `Devin`, `claude`, `comet`, `ChatGPT Classic`, `language_server_windows_x64`, or other large non-HYDI processes; or
   - extend host physical memory.

Only after these steps is the host expected to be **READY**.
