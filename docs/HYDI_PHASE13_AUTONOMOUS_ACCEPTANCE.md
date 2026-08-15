# HYDI Phase 13 — Autonomous Operational Acceptance Mission

## Mission

`HEALTHY_INBUCKET` — prove that Heidi can autonomously observe, authorize, execute, verify, and audit the safe recovery of a disposable local Supabase mailpit (inbucket) container.

## Target Service

`supabase_inbucket_HYDI-System-v2` — a non-critical, optional, disposable local Docker container.

## Sequence

1. **Observe** — `LocalHealthProbes.inbucket()` reports `HEALTHY`.
2. **Inject failure** — external test harness `docker stop supabase_inbucket_HYDI-System-v2`.
3. **Detect** — `LocalHealthProbes.inbucket()` reports `UNAVAILABLE`.
4. **Authorize** — `HeidiExecutive` policy checks `health.recover` capability and actor.
5. **Approve** — `health.recover` is `LOW` risk, no human approval required.
6. **Execute** — `ControlledExecutor` performs `docker restart supabase_inbucket_HYDI-System-v2`.
7. **Verify** — `LocalHealthProbes.inbucket()` re-probed and reports `HEALTHY`.
8. **Audit** — full record persisted to `data/audit.jsonl`.
9. **Idempotency** — second recovery within 5s is a no-op.
10. **Failure path** — an unsupported service is denied and audited.
11. **Restart persistence** — new `AuditLog` instance reloads the records.

## Governing Constraints

- No cloud Supabase.
- No Stripe, OpenAI, Anthropic, or external APIs.
- No arbitrary shell commands.
- No destructive filesystem operations.
- Only `health.recover` with `service: 'supabase_inbucket'` (mapped to `supabase_inbucket_HYDI-System-v2`) is allowed.

## Success Criteria

| # | Criterion |
|---|---|
| 1 | Initial health observed as `HEALTHY` |
| 2 | Stopped service observed as `UNAVAILABLE` |
| 3 | Recovery authorized by capability registry and policy |
| 4 | Executor uses only the allowlisted `docker restart` operation |
| 5 | Post-recovery health is `HEALTHY` |
| 6 | Audit record contains all required fields and survives a new process instance |
| 7 | Duplicate request within 5s is idempotent |
| 8 | Unsupported/failed request is denied and audited |
| 9 | `npm run typecheck`, `npm run build`, `npm run hydi:readiness`, `npm test` pass |
