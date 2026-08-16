# Phase 10 — Operational Qualification

## Repository state

* Branch: `release/v0.9.0`
* HEAD: `6bccb06` `feat(hydi): Phase 9 high-value security hardening`
* Timestamp: 2026-08-16

## Phase selected

Phase 10 — Operational Qualification and Endurance.

## Staged gates

### Gate A — Static validation

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | PASS | no errors |
| `npm run build` | PASS | production build compiled |
| `npm test` | FAIL (4 tests) | `tests/unit/worker-queue-live.test.js` failed with `connect ECONNREFUSED 127.0.0.1:54322` |

The 4 failing tests are live Supabase connectivity tests. They require a running local Supabase on `54322`. At the time of execution the Docker daemon was not reachable, so these tests could not connect. This is an infrastructure failure, not a code regression.

### Gate B — Runtime smoke

The manual production server (`npm start`) was launched and exercised:

```text
GET /                 = 200
GET /photo-forge      = 200
GET /api/status       = 200
GET /api/health       = 200
GET /api/ursula/status (allowed origin)  = 200
GET /api/ursula/status (rejected origin) = 403
POST /api/chat (normal question)         = 200, model_used: local-mock
POST /api/chat (prompt injection)        = 200, model_used: guard
```

Runtime smoke artifacts:

```text
C:\tmp\phase10\gate-b-smoke.txt
C:\tmp\phase10\smoke-response.txt
C:\tmp\phase10\injection-response.txt
```

### Gate C — Quick operational qualification

Command:

```text
npm run operational-qualification
```

Result: **FAILED** at stack-lifecycle.

The harness started `memory-engine` and `hydi-core` successfully. It attempted to start `docker-stack` (optional), which immediately failed because the Docker daemon at `npipe:////./pipe/dockerDesktopLinuxEngine` was not reachable.

Then it started `heidi-bridge` successfully. When it started `next-app` (`npm run dev`), the health check repeatedly failed:

```text
Caused by: Error: connect ECONNREFUSED 127.0.0.1:54321
```

Because local Supabase could not be reached, `/api/health` returned `503` and the qualification harness aborted after the configured number of attempts.

## Root cause

The Docker Desktop daemon became unreachable during the qualification attempt. This prevented the qualification stack from reaching local Supabase on `54321` and caused the live Supabase unit tests to fail on `54322`. The HYDI code, build, and static test suite are otherwise healthy.

## Evidence

* `npm test` output: `tests/unit/worker-queue-live.test.js` — `connect ECONNREFUSED 127.0.0.1:54322`
* `npm run operational-qualification` output: `connect ECONNREFUSED 127.0.0.1:54321`
* `docker ps` and `docker logs` later returned `dockerDesktopLinuxEngine` not found

## Classification

This is an environmental/infrastructure blocker. No code changes were made and no security or reliability controls were weakened.

## Verdict

**BLOCKED**

Phase 10 cannot be validly completed until the local Docker/Supabase stack is restored and reachable.
