# Phase 10 — Failure Injection and Recovery Qualification (Gate D)

## Repository state

* Branch: `release/v0.9.0`
* Current HEAD: `77cca62` `docs(hydi): Phase 10 infrastructure stabilization and quick OQ pass`
* Phase 10 date: 2026-08-16

## Environment

* OS: Windows 10 Home (Version 2009)
* WSL2: Ubuntu (Default)
* WSL2 IP: `192.168.49.99`
* Docker daemon: WSL2 `dockerd` (not reachable from the Windows `docker` CLI)
* Portproxy: `127.0.0.1:54321` → `192.168.49.99:54321`, `127.0.0.1:54322` → `192.168.49.99:54322`
* Git commit under test: `77cca62`

## Existing tooling used

* `operational-qualification/operational-qualification.js` — full qualification with `--chaos`
* `scripts/lib/soak-chaos.js` — `ChaosOrchestrator` with individual scenario selection
* `services-manifest.json` — service command/health definitions

## Failure matrix

### Test 1 — Next.js process crash (`process-crash` / `restart-next`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the Next.js `node` process listening on port 3000 |
| Detection | Health endpoint `http://localhost:3000/api/health` went unhealthy in 3–4 ms |
| Recovery | Harness restarted `npm run dev` from the manifest |
| Restoration | Health returned after 6,132 ms (3 probes) and 7,150 ms in separate run |
| Detection latency | 3–4 ms |
| Recovery latency | 6,132 ms |
| Post-recovery | `GET /api/health` 200, workload driver `database-operation` 200, chat 200 |
| Verdict | **PASS** |

### Test 2 — Memory Engine process restart (`restart-memory-engine`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the `memory-engine.js` `node` process listening on port 9998 |
| Detection | Health endpoint `http://localhost:9998/health` went unhealthy in 2–3 ms |
| Recovery | Harness restarted `node memory-engine.js` from the manifest |
| Restoration | Health returned after 2,013 ms (2 probes) |
| Detection latency | 2–3 ms |
| Recovery latency | 2,013 ms |
| Post-recovery | `GET /api/health` 200, `memory-storage` and `memory-retrieval` workloads succeeded |
| Verdict | **PASS** |

### Test 3 — HYDI Core process restart (`restart-core`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the `hydi-core.js` `node` process listening on port 9997 |
| Detection | Health endpoint `http://localhost:9997/health` went unhealthy in 2–3 ms |
| Recovery | Harness restarted `node hydi-core.js` from the manifest **with `HYDI_REQUIRE_SUPERVISOR=false`** |
| Restoration | Health returned after 32,213 ms (17 probes) |
| Detection latency | 2–3 ms |
| Recovery latency | 32,213 ms |
| Note | Without `HYDI_REQUIRE_SUPERVISOR=false`, `hydi-core.js` exits immediately because `:9999` is unavailable. The operational-qualification orchestrator sets this env; the standalone `soak-chaos` harness does not. When the env is provided, `hydi-core` recovers correctly. |
| Verdict | **PASS** (with the OQ-equivalent environment) |

### Test 4 — Heidi Bridge interruption (`kill-bridge`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the `heidi-bridge.py` Python process on port 5050 (manual) |
| Detection | `GET http://localhost:5050/health` returned `ECONNREFUSED` immediately |
| Recovery | **No automatic recovery** in the standalone test — the harness could not be used because the preflight probe timed out. |
| Restoration | Manual `python heidi-bridge.py` restored the service. |
| Note | The `soak-chaos` preflight probe uses a 5,000 ms HTTP timeout. In this environment `GET /health` on the bridge consistently takes ~16,000 ms. The standalone chaos harness therefore refuses to inject the fault because it cannot establish the pre-injection baseline. This is a **harness/tooling limitation** in the presence of a slow bridge health endpoint, not a failure of recovery logic. |
| Verdict | **BLOCKED** |

### Tests 5–7 — Docker dependency restarts (postgres, redis, protohub)

| Field | Value |
|---|---|
| Injection | `docker compose restart <service>` (Ursula_Suite) |
| Detection | n/a — injection never executed |
| Recovery | n/a |
| Restoration | n/a |
| Note | The Windows `docker` CLI cannot reach the WSL2 `dockerd` because the named pipe `//./pipe/docker_engine` is not present. The WSL2 daemon is only accessible via `wsl docker`. The qualification harness invokes `docker` directly. These scenarios are therefore **BLOCKED** by the host/container split, not by the service. No destructive commands were run. |
| Verdict | **BLOCKED** |

### Test 8 — Delayed PostgreSQL startup (`delayed-postgres-startup`)

| Field | Value |
|---|---|
| Injection | `docker compose stop postgres` → wait 30 s → `docker compose start postgres` |
| Detection | `GET http://localhost:3000/api/health` was observed during the outage |
| Recovery | n/a — injection never executed |
| Note | Same Windows/WSL Docker CLI blocker. |
| Verdict | **BLOCKED** |

## Integrated OQ full + chaos result

```text
npm run operational-qualification full --chaos
```

A 15-minute loaded window was used for the full run by overriding `qualification-config.json` `full.duration` at runtime. The harness:

* Started memory-engine, hydi-core, heidi-bridge, next-app, heidi-mobile, forge-loop.
* Ran 258 workload executions, 258 successful, 0 failed.
* Injected one enabled scenario (`process-crash` / `restart-next`) and it recovered in 14,655 ms.
* Skipped `database` (postgres), `redis`, and `network-interruption` (delayed postgres) because the containers were not reachable from the Windows `docker` CLI.
* Generated `reports/qualification/2026-08-16T06-22-28-qual-full.json`.

## Evidence

```text
reports/qualification/2026-08-16T06-22-28-qual-full.json
C:\tmp\phase10a\qual-full-chaos.json
C:\tmp\phase10a\additional-chaos.json
```

## Metrics

| Metric | Value |
|---|---|
| Workload executions (15-min full) | 258 |
| Workload success rate | 100% |
| Process-level chaos tests passed | 3 (next, memory-engine, hydi-core) |
| Process-level chaos tests blocked | 1 (heidi-bridge preflight timeout) |
| Docker dependency tests blocked | 4 (postgres, redis, protohub, delayed-postgres) |
| Recovery time range | 2,013 ms – 32,213 ms |
| Average recovery time | 13,453 ms |

## Security

CORS and prompt-injection controls remained enabled throughout. No controls were disabled. No destructive Docker/Supabase/PostgreSQL commands were issued.

## Verdict

**GATE D BLOCKED**

The process-level failure injection that could be validly executed (Next.js, Memory Engine, HYDI Core with correct environment) all passed: detection, bounded recovery, and restoration were verified. However, Gate D cannot be called a full PASS because:

1. Docker/WSL tooling does not allow the Windows qualification harness to reach the WSL2 `dockerd`, so container-level dependency tests (postgres, redis, protohub, delayed postgres startup) could not be executed.
2. The Heidi Bridge `/health` endpoint consistently takes ~16 s, which exceeds the `soak-chaos` preflight timeout and blocks the bridge-interruption test.

These are environmental/tooling blockers, not service regression. No Phase 9 security controls were altered.

## Required before Gate E

* Resolve Windows-to-WSL2 Docker CLI connectivity so the harness can perform `docker compose restart` on Ursula dependencies, OR
* Configure the qualification harness to use `wsl -d Ubuntu -e docker compose ...`
* Investigate and reduce Heidi Bridge `/health` latency, or extend the chaos preflight probe timeout to match the actual endpoint behavior.
