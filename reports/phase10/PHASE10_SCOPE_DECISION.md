# Phase 10 Scope Decision

## Current baseline

* Branch: `release/v0.9.0`
* HEAD: `6bccb06` `feat(hydi): Phase 9 high-value security hardening`
* Phase 9 verdict: **GO WITH LIMITATIONS**

## Reconnaissance findings

* The Phase 10 operational qualification harness exists and is documented.
* Earlier attempts were blocked by local Docker/Supabase instability.
* The actual infrastructure uses a WSL2 `dockerd`; the expected `127.0.0.1:54321/54322` ports were not bridged to the WSL2 virtual network.
* A `netsh interface portproxy` host remediation from `127.0.0.1` to the WSL2 IP restored connectivity.

## Selection

**Phase 10 — Operational Qualification and Endurance** remains the current target.

## In scope

* Quick operational qualification (`npm run operational-qualification`).
* Infrastructure stabilization documentation.
* Gate A (typecheck, build, test), Gate B (runtime smoke), Gate C (quick OQ).

## Out of scope

* Phase 6 packet-level re-verification
* Credential rotation
* Ursula JWT Bearer migration
* Photo Forge image-data handling
* Failure injection / 1-hour soak / 24-hour endurance (next gates)

## Decision

The infrastructure blocker is resolved. Proceed with quick OQ and prepare report evidence.
