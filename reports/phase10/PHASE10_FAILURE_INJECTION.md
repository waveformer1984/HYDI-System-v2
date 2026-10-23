# Phase 10 — Failure Injection and Recovery Qualification (Gate D)

## Repository state

* Branch: `release/v0.9.0`
* Current HEAD: `66e7fed` `docs(hydi): Phase 10 Gate D failure injection qualification`
* Phase 10 date: 2026-08-16
* Note: this run used the working-tree version of `scripts/lib/soak-chaos.js` (uncommitted), which routes Windows `docker` and `docker compose` calls through `wsl -d Ubuntu -e` to reach the WSL2 `dockerd`.

## Environment

* OS: Windows 10 Home (Version 2009)
* WSL2: Ubuntu (Default)
* WSL2 IP: `192.168.49.99`
* Docker daemon: WSL2 `dockerd` (not reachable from the Windows `docker` CLI)
* Portproxy: `127.0.0.1:54321` → `192.168.49.99:54321`, `127.0.0.1:54322` → `192.168.49.99:54322`
* Git commit under test: `66e7fed`

## Existing tooling used

* `operational-qualification/operational-qualification.js` — full qualification with `--chaos` (15-minute loaded window)
* `scripts/lib/soak-chaos.js` — `ChaosOrchestrator` with WSL `docker compose` routing and individual scenario selection
* `services-manifest.json` — service command/health definitions

## Failure matrix

### Test 1 — Next.js process crash (`process-crash` / `restart-next`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the Next.js `node` process listening on port 3000 |
| Detection | Health endpoint `http://localhost:3000/api/health` went unhealthy in 25 ms |
| Recovery | Harness restarted `npm run dev` from the manifest |
| Restoration | Health returned after 15,323 ms (6 probes) |
| Detection latency | 25 ms |
| Recovery latency | 15,323 ms |
| Post-recovery | `GET /api/health` 200, `database-operation` 200, `conversation` 200 |
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
| Note | Evidence from the previous Phase 10 Gate D run; no code changes that would affect this scenario. |
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
| Note | Evidence from the previous Phase 10 Gate D run; `HYDI_REQUIRE_SUPERVISOR=false` remains in the orchestrator. No regression. |
| Verdict | **PASS** |

### Test 4 — Heidi Bridge interruption (`kill-bridge`)

| Field | Value |
|---|---|
| Injection | `taskkill` on the `heidi-bridge.py` Python process on port 5050 |
| Detection | `GET http://localhost:5050/health` returned ECONNREFUSED after 30 ms |
| Recovery | Harness restarted `python heidi-bridge.py` from the manifest |
| Restoration | Health returned after 2,038 ms (2 probes) |
| Detection latency | 30 ms |
| Recovery latency | 2,038 ms |
| Post-recovery | `bridge-request` workload returned 200 in the subsequent OQ |
| Note | The previous ~16 s preflight latency is no longer observed; the bridge `/health` endpoint now responds in <100 ms under load. |
| Verdict | **PASS** |

### Test 5 — PostgreSQL restart (`restart-postgres`)

| Field | Value |
|---|---|
| Injection | `docker compose restart postgres` in Ursula_Suite |
| Detection | TCP connect to `127.0.0.1:5432` refused briefly |
| Recovery | Docker compose restart |
| Restoration | TCP connect accepted after 6 ms |
| Recovery latency | 6 ms |
| Verdict | **PASS** |

### Test 6 — Redis restart (`restart-redis`)

| Field | Value |
|---|---|
| Injection | `docker compose restart redis` in Ursula_Suite |
| Detection | TCP connect to `127.0.0.1:6379` refused briefly |
| Recovery | Docker compose restart |
| Restoration | TCP connect accepted after 2 ms |
| Recovery latency | 2 ms |
| Verdict | **PASS** |

### Test 7 — ProtoHub API restart (`restart-protohub`)

| Field | Value |
|---|---|
| Injection | `docker compose restart protohub-api` in Ursula_Suite |
| Detection | `GET http://localhost:4000/health` refused briefly |
| Recovery | Docker compose restart |
| Restoration | `GET /health` returned 200 after 40 ms |
| Recovery latency | 40 ms |
| Verdict | **PASS** |

### Test 8 — Delayed PostgreSQL startup (`delayed-postgres-startup`)

| Field | Value |
|---|---|
| Injection | `docker compose stop postgres` → wait 30 s → `docker compose start postgres` |
| Detection | `GET http://localhost:3000/api/health` stayed healthy during the outage |
| Recovery | Docker compose start + dependent reconnect |
| Restoration | `GET /api/health` returned 200 after 83 ms |
| Recovery latency | 83 ms |
| Post-recovery | `database-operation` workload returned 200 |
| Note | Dependent endpoint remained healthy (degraded-tolerant) while Postgres was down. |
| Verdict | **PASS** |

## Integrated OQ full + chaos result

```text
node --expose-gc C:\tmp\phase10a\qual-15m-chaos.js
```

A 15-minute (900,217 ms) loaded window was used. The harness:

* Started memory-engine, hydi-core, heidi-bridge, next-app, heidi-mobile, forge-loop.
* Ran 822 workload executions, 822 successful, 0 failed.
* Injected four enabled scenarios:
  * `restart-postgres` — passed, 6 ms recovery
  * `restart-redis` — passed, 2 ms recovery
  * `restart-next` — passed, 15,323 ms recovery
  * `delayed-postgres-startup` — passed, 83 ms recovery
* No uncontrolled restart loops.
* Generated `reports/qualification/2026-08-16T09-15-33-qual-full.json`.

## Evidence

```text
reports/qualification/2026-08-16T09-15-33-qual-full.json
C:\tmp\phase10a\qual-15m-chaos.log
C:\tmp\phase10a\bridge-chaos.js  (standalone heidi-bridge kill test)
C:\tmp\phase10a\qual-15m-chaos.js (15-minute driver with custom full.duration)
```

## Metrics

| Metric | Value |
|---|---|
| Workload executions (15-min full) | 822 |
| Workload success rate | 100% |
| Process-level chaos tests passed | 4 / 4 (next, heidi-bridge standalone; memory-engine and core previously verified) |
| Docker dependency tests passed | 4 / 4 (postgres, redis, protohub, delayed postgres) |
| Recovery time range | 2 ms – 32,213 ms |
| Average recovery time (OQ) | 3,853.5 ms |
| CPU avg / p95 | 54.87% / 78.81% |
| Memory avg / p95 | 96.53% / 98.32% |
| Harness heap trend | 2.19 MB/hour (below 5 MB/h threshold) |
| Resource leaks | None |

## Security

CORS and prompt-injection controls remained enabled throughout. No controls were disabled. No destructive Docker/Supabase/PostgreSQL commands were issued beyond the controlled `docker compose restart` and `taskkill` scenarios.

## Verdict

**GATE D PASS — READY FOR GATE E**

The WSL2 `dockerd` runtime was restored and verified. The working-tree `soak-chaos.js` WSL Docker/Compose routing removed the previous Windows/WSL Docker CLI blocker, allowing the container-level dependency tests to run and pass. All eight failure-injection scenarios are now accounted for with bounded recovery and restoration evidence. The integrated 15-minute OQ with chaos passed 4/4 injected scenarios, 822/822 workloads succeeded, and the harness exhibited no resource leaks. No Phase 9 security controls were altered.

## Required before Gate E

* (Optional) Review and commit the `scripts/lib/soak-chaos.js` WSL Docker routing change and this report update if the dirty working tree is approved.
* Gate E may proceed.
