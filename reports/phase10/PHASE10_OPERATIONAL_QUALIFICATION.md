# Phase 10 — Operational Qualification

## Repository state

* Branch: `release/v0.9.0`
* HEAD before this phase: `6bccb06` `feat(hydi): Phase 9 high-value security hardening`
* Current HEAD: `d169f2a` `docs(hydi): Phase 10 operational qualification scope and evidence`
* Timestamp: 2026-08-16

## Phase selected

Phase 10 — Operational Qualification and Endurance.

## Staged gates

### Gate A — Static validation

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | PASS | no errors |
| `npm run build` | PASS | production build compiled |
| `npm test` | PASS | 266 suites, 2521 passed, 2522 total, 1 skipped |

The test suite passes when the local Supabase stack is reachable. In the first attempt, with the Docker daemon stopped, `tests/unit/worker-queue-live.test.js` failed with `connect ECONNREFUSED 127.0.0.1:54322`. After restoring Docker and starting the local Supabase containers, the same suite passed.

### Gate B — Runtime smoke

The manual production server (`npm start`) was launched and exercised. The core endpoints returned healthy responses, CORS restriction worked, and the prompt guard rejected an injection attempt while allowing a normal Photo Forge question.

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

The harness started `memory-engine` and `hydi-core` successfully. The optional `docker-stack` service could not start a second Docker Compose stack because the Docker Desktop npipe is not accessible to child processes. `heidi-bridge` started successfully. When the harness started `next-app` (`npm run dev`), the `GET /api/health` health check repeatedly returned `503`:

```text
Caused by: Error: connect ECONNREFUSED 127.0.0.1:54321
```

Because the `next-app` process could not reach local Supabase, the qualification harness aborted after the configured number of attempts.

## Root cause

The local Supabase stack is not stable enough to sustain the qualification run. Between attempts, the Docker Desktop daemon stopped and restarted. Even when `supabase_kong` briefly became healthy and the Postgres port (`54322`) was reachable for the unit tests, the Kong API gateway (`54321`) became unreachable again before the `next-app` health checks could succeed. The HYDI code, build, and unit test suite are otherwise healthy.

## Evidence

* `npm test` second run: PASS (after Docker was restored)
* `npm run operational-qualification` second run: `next-app` health checks failed with `connect ECONNREFUSED 127.0.0.1:54321`
* `docker ps` repeatedly returned `dockerDesktopLinuxEngine` not found after starting from the PowerShell session
* Manual `GET /api/health` under `next dev` returned `unavailable` with `Unable to connect to health monitoring database` when Kong was unreachable

## Classification

This is an environmental/infrastructure blocker. No code changes were made and no security or reliability controls were weakened.

## Verdict

**BLOCKED**

Phase 10 cannot be validly completed until the local Docker/Supabase stack is stable and reachable for the duration of the qualification run.
