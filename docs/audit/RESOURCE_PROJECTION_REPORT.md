# Resource Projection Report

**Date:** 2026-08-03
**Host total physical memory:** 16,461,400 KB (~15.7 GiB)
**Current free physical memory:** 1,327,156 KB (~1.27 GiB)

## Method

All numbers are from the live host:

- `Get-CimInstance Win32_OperatingSystem` for physical memory.
- `docker stats --no-stream --format json` for per-container memory.
- `Get-Process | Sort WorkingSet` for top Windows processes.
- `docker ps -a` and `docker compose ls --all` for container inventory.

## Current Docker Memory by Project

| Project | Running containers | Memory used |
|---------|--------------------|-------------|
| `hydi-local-supabase` | 12 | ~1,058.9 MiB |
| `ursula_suite` | 3 | ~209.2 MiB |
| `docker` (HYDI-TailNet) | 8 | ~116.0 MiB |
| `outputs` (protoforge monitoring) | 3 | ~188.9 MiB |
| **Total running Docker containers** | **26** | **~1,573.0 MiB (~1.54 GiB)** |

## What Can Be Freed Without Affecting Qualification

### 1. Stop unrelated stacks

| Stack | Containers | Approx. memory saved |
|-------|------------|----------------------|
| `docker` (TailNet) | `hydi-api`, `hydi-dashboard`, `hydi-file-sync`, `hydi-loki`, `hydi-monitoring`, `hydi-notifications`, `hydi-redis`, `hydi-remote-commands` | ~116.0 MiB |
| `outputs` (monitoring) | `protoforge-grafana`, `protoforge-prometheus`, `protoforge-redis` | ~188.9 MiB |
| **Subtotal unrelated** | | **~304.9 MiB** |

### 2. Stop non-essential Supabase containers

| Container | Approx. memory saved |
|-----------|----------------------|
| `supabase_vector_hydi-local-supabase` | 0 B (already crashed) |
| `supabase_analytics_hydi-local-supabase` | ~224.0 MiB |
| `supabase_studio_hydi-local-supabase` | ~190.0 MiB |
| `supabase_pg_meta_hydi-local-supabase` | ~94.4 MiB |
| `supabase_inbucket_hydi-local-supabase` | ~19.8 MiB |
| **Subtotal optional Supabase** | **~528.2 MiB** |

### 3. Start required but missing Ursula service

| Service | Expected additional memory |
|---------|---------------------------|
| `ursula-flask` (`flask-backend`) | ~50–100 MiB (estimated) |

## Net Docker Projection After Isolation

| Item | Memory |
|------|--------|
| Current Docker container memory | ~1,573.0 MiB |
| Savings from stopping unrelated + optional | ~833.1 MiB |
| Additional `ursula-flask` | ~+75 MiB (midpoint estimate) |
| **Projected Docker container memory** | **~815 MiB** |

## WSL2 / Docker Desktop Memory

- `vmmemWSL` working set: ~1,971.7 MiB
- WSL2 memory denominator seen in Docker stats: ~3.829 GiB
- The WSL2 VM appears to be capped near 4 GiB.

After freeing ~833 MiB of Docker container memory, the WSL2 VM would have more headroom for the qualification Node.js processes (`next-app`, `hydi-core`, `memory-engine`, `heidi-bridge`, etc.) and the soak harness.

## Top Non-Docker Memory Consumers on Windows

| Process | Working set (MiB) |
|---------|-------------------|
| `vmmemWSL` | 1,971.7 |
| `Devin` | 1,382.8 |
| `language_server_windows_x64` | 985.1 |
| `comet` | 429.7 |
| `ChatGPT Classic` | 407.6 |
| `MsMpEng` | 391.4 |
| `com.docker.backend` | 333.1 |
| `claude` | 301.1 |
| `Devin` (second instance) | 220.4 |
| `claude` (second instance) | 208.9 |
| `Memory Compression` | 199.7 |

## Conclusion

- Docker isolation alone can free **~833 MiB** of WSL2 memory.
- Projected running Docker footprint during qualification: **~815 MiB**.
- This gives the WSL2 VM enough room for the qualification stack, but the Windows host still has only **~1.27 GiB** of free physical memory.
- The largest consumers (`Devin`, `language_server_windows_x64`, `comet`, `ChatGPT Classic`, `claude`) are not Docker containers and will not be affected by the Docker isolation plan.
- **Isolating Docker is necessary but not sufficient.** Without closing or reducing the non-Docker processes, the host remains in a **MARGINALLY READY** to **NOT READY** state for a 24-hour run.
