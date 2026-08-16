# Phase 10 Scope Decision

## Current baseline

* Branch: `release/v0.9.0`
* HEAD: `6bccb06` `feat(hydi): Phase 9 high-value security hardening`
* Phase 9 verdict: **GO WITH LIMITATIONS**

## Reconnaissance findings

* Local Supabase and Ursula Suite Docker containers are healthy.
* `supabase_vector` is in a `Restarting` loop — it is an analytics/logging sidecar and not on the critical path for this qualification.
* Operational qualification harness exists at `operational-qualification/` and is documented as fixed.
* Soak harness exists at `scripts/soak-test.js` with `1h` and `24h` targets.
* `services-manifest.json` lists `memory-engine`, `hydi-core`, `heidi-bridge`, `next-app`, and optional `docker-stack`/`forge-loop`.
* No code changes are required to run the existing qualification harness.
* Phase 6 (packet capture), credential rotation, Ursula JWT, and Photo Forge image data remain independent.

## Selection

**Phase 10 — Operational Qualification and Endurance** is the next correct target.

### Why Phase 10 is selected

* It is the natural next evolution after the Phase 9 capability closeout.
* Phase 9 closed the security hardening gap; the remaining P1/P2 gaps are certification/qualification items (operational evidence, packet re-verification, image data).
* The existing operational qualification harness is intended for exactly this purpose, and the repository provides `npm run operational-qualification` (quick) and `npm run production-certification` (full).
* A quick qualification run is feasible and will produce evidence for or against moving to a longer soak.

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

* `supabase_vector` restart loop is a non-critical infrastructure anomaly; it is an optional logging sidecar, not a service on the critical qualification path.
* No other verified blockers at this time.

## Decision

Proceed to staged qualification. Execute Gate A, Gate B, and the quick operational qualification harness. Document results in `reports/phase10/` and determine whether the system is ready for a longer endurance run.
