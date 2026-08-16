# Phase 10 Scope Decision

## Current baseline

* Branch: `release/v0.9.0`
* HEAD: `6bccb06` `feat(hydi): Phase 9 high-value security hardening`
* Phase 9 verdict: **GO WITH LIMITATIONS**

## Reconnaissance findings

* Local Supabase and Ursula Suite Docker containers are healthy when the Docker daemon is running.
* `supabase_vector` is in a `Restarting` loop — it is an analytics/logging sidecar and not on the critical path for this qualification.
* Operational qualification harness exists at `operational-qualification/` and is documented as fixed.
* Soak harness exists at `scripts/soak-test.js` with `1h` and `24h` targets.
* `services-manifest.json` lists `memory-engine`, `hydi-core`, `heidi-bridge`, `next-app`, and optional `docker-stack`/`forge-loop`.
* No code changes are required to run the existing qualification harness.
* Phase 6 (packet capture), credential rotation, Ursula JWT, and Photo Forge image data remain independent.
* The Docker Desktop daemon is unstable in this environment: it becomes unreachable after starting, causing the `next-app` health checks and the `docker-stack` service to fail.

## Selection

**Phase 10 — Operational Qualification and Endurance** is the next correct target.

### Why Phase 10 is selected

* It is the natural next target after the Phase 9 capability closeout.
* Phase 9 closed the security hardening gap; the remaining P1/P2 gaps are certification/qualification items (operational evidence, packet re-verification, image data).
* The existing operational qualification harness is intended for exactly this purpose, and the repository provides `npm run operational-qualification` (quick) and `npm run production-certification` (full).

### What is in scope

* Gate A — static validation: `npm run typecheck`, `npm run build`, `npm test`
* Gate B — runtime smoke: core endpoints, CORS, prompt guard
* Gate C — quick operational qualification via `npm run operational-qualification` (~30 minutes)
* Evidence capture: qualification report, logs, artifact paths

### What is out of scope

* Phase 6 packet-level re-verification
* Credential rotation
* Ursula JWT Bearer migration
* Photo Forge image-data handling
* 24-hour endurance unless quick qualification passes cleanly
* Failure injection (`--chaos`) — destructive and kept independent

### Blockers

* The local Docker/Supabase stack is not stable in this environment. It becomes unreachable during the qualification run, causing the `next-app` service to fail its health checks.
* No other verified blockers at this time.

## Decision

Phase 10 was attempted. The code and unit tests are healthy, but the operational qualification cannot produce valid evidence until the local Docker/Supabase stack is stable. Document the BLOCKED state and update the qualification reports.
