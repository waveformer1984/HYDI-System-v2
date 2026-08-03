# Final Qualification Ready Decision

**Date:** 2026-08-03
**Scope:** Confirm the root cause of `supabase_vector_hydi-local-supabase` crash-looping and finalize the HYDI-TailNet / HeidiHub stack assessment, then re-assess host readiness.

## 1. `supabase_vector_hydi-local-supabase` — Root Cause

### Restart policy

```
docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' supabase_vector_hydi-local-supabase
> unless-stopped
```

The container is configured to restart forever unless explicitly stopped.

### Container configuration

```
Binds: []
Env:   [DOCKER_HOST=http://host.docker.internal:2375 ...]
Cmd:   []
```

Vector has **no host bind mounts** and is configured to reach the Docker engine over TCP at `http://host.docker.internal:2375`.

### Failure pattern in logs

```
ERROR source{component_id=docker_host component_type=docker_logs}: 
  vector::sources::docker_logs: Listing currently running containers failed.
  error=... ConnectError("tcp connect error", Os { code: 111, ... "Connection refused" })
```

This repeats every ~60 seconds, triggering a fresh restart.

### Why it is failing

The container is **not** failing because of missing dependencies, insufficient memory, or a code panic. It is a **configuration mismatch**:

- Vector's `docker_logs` source expects to talk to the Docker daemon.
- It is hardcoded to use `DOCKER_HOST=http://host.docker.internal:2375`.
- Docker Desktop on Windows/WSL2 is not exposing the daemon on TCP 2375; it uses a named pipe / WSL2 socket.
- `host.docker.internal` resolves, but the port is not listening.

On a correctly configured system, Docker Desktop would either:

- expose the daemon on TCP 2375 (unchecked by default, insecure), or
- the container would mount `/var/run/docker.sock` as a Unix socket.

The current compose/run does neither; it is intentionally not a runtime that can succeed.

### Does HYDI_System depend on it?

No. Evidence:

- `services-manifest.json` does not list `supabase_vector`.
- `.ports.json` does not list `supabase_vector`.
- `start-hydi.js` does not start it.
- `qualification-config.json` workloads all target `localhost:3000` and `localhost:5050`.
- `supabase/config.toml` has `[analytics] enabled = true`, which is why the container is started, but the `system_dashboard` view and all qualification API calls do not require Vector.

### Recommended action

**Disable the restart loop for the qualification duration.** Do not try to repair the Vector TCP configuration now, because:

- It is unrelated to the 24-hour HYDI qualification.
- The current 2451-restart loop consumes Docker scheduler cycles and noise.
- Stopping the container is reversible and safe.

```powershell
docker stop supabase_vector_hydi-local-supabase
```

To restore after qualification:

```powershell
docker start supabase_vector_hydi-local-supabase
```

Permanently disabling it would require `supabase config set analytics.enabled false` or equivalent, which touches configuration. That is out of scope for a reversible qualification plan.

## 2. HYDI-TailNet / HeidiHub Stack — Reassessment

### The eight containers

Project: `docker` (`C:\Users\Owner\HYDI-TailNet\docker\docker-compose.windows.yml`)

| Container | Service | Port | Purpose |
|-----------|---------|------|---------|
| `hydi-api` | `api-gateway` | 8000 | TailNet gateway |
| `hydi-dashboard` | `mobile-dashboard` | 8501 | TailNet mobile dashboard |
| `hydi-file-sync` | `file-sync` | none | File sync |
| `hydi-loki` | `loki` | 3100 | TailNet log aggregation |
| `hydi-monitoring` | `monitoring` | 9091 | TailNet metrics |
| `hydi-notifications` | `notifications` | 2586 | TailNet ntfy |
| `hydi-redis` | `redis` | 6379 | TailNet cache |
| `hydi-remote-commands` | `remote-commands` | none | Remote command execution |

### Evidence that they are unrelated to the qualification

Search of `C:\Users\Owner\HYDI_System` for references to TailNet ports or container names:

| Search term | Result |
|-------------|--------|
| `localhost:8000` | Only `src/hydi-v3/ModelConfiguration.js` (`vllm: { enabled: false, baseUrl: 'http://localhost:8000' }`) and old docs/reports |
| `localhost:8501` | No runtime code matches |
| `localhost:3100` | No runtime code matches |
| `localhost:9090/9091` | No runtime code matches |
| `localhost:2586` | No runtime code matches |
| `hydi-api`, `hydi-dashboard`, etc. | No matches in `services-manifest.json`, `.ports.json`, `supervisor.js`, `start-hydi.js`, or `qualification-config.json` |

The qualification workloads are explicitly:

- `http://localhost:3000/api/health`
- `http://localhost:3000/api/chat`
- `http://localhost:3000/api/memory`
- `http://localhost:3000/api/memory/search`
- `http://localhost:5050/health`
- `http://localhost:9999/status`

None of the TailNet/HeidiHub ports are in that set.

### Conclusion

The `docker` (HYDI-TailNet) stack is **unrelated to the qualification runtime**. All eight running containers become **candidates for temporary isolation** before the 24-hour run. Stopping them is safe for qualification and will reduce Docker memory usage by approximately **116 MiB** and remove their CPU scheduling footprint.

## 3. Updated Host Readiness Decision

### What changed from the previous assessment

- `supabase_vector` root cause confirmed as **TCP Docker engine misconfiguration, not a runtime dependency**; it can be safely stopped for qualification.
- HYDI-TailNet / HeidiHub stack confirmed **unrelated**; all eight containers can be safely stopped for qualification.
- The `outputs` (protoforge monitoring) stack remains unrelated and should also be stopped.

### Isolation effect

| Action | Approx. memory savings | CPU / scheduler noise reduction |
|--------|------------------------|---------------------------------|
| Stop `supabase_vector` | 0 B (it reports 0B, but removes 2451 restart cycles) | Yes |
| Stop HYDI-TailNet `hydi-*` 8 containers | ~116 MiB | Yes |
| Stop `outputs` `protoforge-*` 3 containers | ~188 MiB | Yes |
| Stop optional Supabase UI/analytics | ~528 MiB | Yes |
| **Total available relief** | **~832 MiB + removal of restart loops** | Yes |

### Required services that remain

After isolation, the Docker services required for qualification are:

- `hydi-local-supabase` core: `db`, `kong`, `rest`, `auth`, `realtime`, `storage`
- `ursula_suite` core: `postgres`, `redis`, `protohub-api`, and **must start** `flask-backend`

Projected Docker container memory: ~**815 MiB**.

### Non-Docker constraints remain unchanged

The Windows host still has:

- **~1.27 GiB free physical memory**
- Top consumers: `Devin` (~1.38 GiB WS), `language_server_windows_x64` (~985 MiB), `comet` (~430 MiB), `ChatGPT Classic` (~408 MiB), `claude` (~300+208 MiB)

Stopping Docker containers frees WSL2 headroom but does **not** return memory to the Windows host unless the `vmmemWSL` VM shrinks or WSL2 is shut down. The Windows side still has only ~1.27 GiB free for the Next.js process, soak harness, and other Windows services.

## Final Verdict

| State | Rationale |
|-------|-----------|
| **READY** | No. The Windows host is still under memory pressure from non-Docker processes. |
| **MARGINALLY READY** | **Yes, with conditions.** After applying the isolation plan and stopping `supabase_vector`, the 24-hour qualification can be attempted, but it should be monitored closely for memory pressure, and the host must not be used for other heavy work during the run. |

## Preconditions before starting the 24-hour qualification

1. Stop `supabase_vector` and the HYDI-TailNet / HeidiHub stack.
2. Stop the `outputs` monitoring stack.
3. Stop optional Supabase UI/analytics containers.
4. Start `ursula-flask` so `heidi-bridge` can reach `localhost:5000`.
5. Confirm `ursula-hub` `/health` returns HTTP 200 within the Docker health check window.
6. Either free an additional 1–2 GiB of Windows physical memory (close `Devin`, `claude`, `comet`, `ChatGPT Classic`, `language_server_windows_x64` where possible) or accept the risk and run under close monitoring.

If steps 1–5 are applied **and** the non-Docker memory consumers are minimized, the host can be considered **MARGINALLY READY**.
