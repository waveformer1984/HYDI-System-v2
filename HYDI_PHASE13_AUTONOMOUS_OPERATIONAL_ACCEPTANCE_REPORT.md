# HYDI Phase 13 — Autonomous Operational Acceptance Report

## Mission

`HEALTHY_INBUCKET` — prove that Heidi can autonomously observe, authorize, execute, verify, and audit the safe recovery of a disposable local Supabase mailpit (inbucket) container.

## Target Service

`supabase_inbucket_HYDI-System-v2` — a non-critical, optional, disposable local Docker container.

## Sequence

1. **Observe** — `LocalHealthProbes.inbucket()` reports `HEALTHY`.
2. **Inject failure** — `docker stop supabase_inbucket_HYDI-System-v2`.
3. **Detect** — `LocalHealthProbes.inbucket()` reports `UNAVAILABLE`.
4. **Authorize** — `HeidiExecutive` policy checks `health.recover` capability and actor.
5. **Approve** — `health.recover` is `LOW` risk, no human approval required.
6. **Execute** — `ControlledExecutor` performs `docker restart supabase_inbucket_HYDI-System-v2`.
7. **Verify** — `LocalHealthProbes.inbucket()` re-probed and reports `HEALTHY`.
8. **Audit** — full record persisted to `data/phase13/audit.jsonl`.
9. **Idempotency** — second recovery (when healthy) is a no-op (`SKIPPED`).
10. **Restart persistence** — new `HeidiExecutive` instance loads the audit records.

## Live Acceptance Evidence

Command:

```bash
node scripts/hydi-phase13-acceptance.js
```

Result:

```
1. initial health: { status: 'HEALTHY', detail: 'supabase_inbucket_HYDI-System-v2:Up 34 minutes (healthy)' }
2. stopping supabase_inbucket...
3. stopped health: { status: 'UNAVAILABLE', detail: '' }
4. authorizing and executing recovery...
5. recovery result: RECOVERED
   health-before: { status: 'UNAVAILABLE', detail: '' }
   health-after: { status: 'HEALTHY', detail: 'supabase_inbucket_HYDI-System-v2:Up Less than a second (health: starting)' }
6. idempotency check...
   second result: SKIPPED
7. persistent audit records:
   - 2026-08-15T01:46:03.738Z recover-supabase_inbucket-1786758363233 COMPLETED actor=phase13-acceptance
8. prove records survive a new process...
   recovered events: 1

=== PHASE 13 ACCEPTANCE: PASS ===
```

## Authorization Evidence

| Layer | Check | Result |
|---|---|---|
| Identity | `actor.id` passed to `HeidiExecutive.run` | `phase13-acceptance` |
| Permission | `health.recover` has no `requiredPermissions` in `CapabilityRegistry` | pass |
| Capability | `CapabilityRegistry` contains `health.recover` | pass |
| Approval policy | `health.recover` is `LOW` risk, no approval | auto-authorized |
| Executor allowlist | `ControlledExecutor` only allows `supabase_inbucket` service | pass |

## Failure Path Evidence

Unit tests verify:

- `docker.local` `stop_service` → `DENIED` and audited.
- `health.recover` with `service: 'some_unsupported_container'` → `DENIED` and audited.
- `npm test` output shows these as passing.

## Persistent Audit Record

File: `data/phase13/audit.jsonl`

```json
{
  "timestamp": 1786758363233,
  "taskId": "recover-supabase_inbucket-1786758363233",
  "capabilityId": "health.recover",
  "actor": "phase13-acceptance",
  "target": "local",
  "inputs": { "service": "supabase_inbucket" },
  "approvalState": { "decision": "auto" },
  "executionResult": { "success": true, "result": { "status": "recovered", "service": "supabase_inbucket" }, "duration": 0 },
  "verificationResult": null,
  "duration": 0,
  "error": null,
  "resultingState": "COMPLETED"
}
```

A new `HeidiExecutive({ dataDir: 'data/phase13' })` process recovered the same record.

## Idempotency Evidence

- Live script: second call returned `SKIPPED` because the service was already `HEALTHY`.
- Unit test: `tests/unit/hydi-phase13-autonomous-acceptance.test.js` explicitly keeps the service `UNAVAILABLE` and verifies `IDEMPOTENT` within the 5-second dedup window, with only one `docker restart` recorded.

## Local-Only Evidence

The acceptance script explicitly sets:

- `SUPABASE_URL = 'http://127.0.0.1:54321'`
- `STRIPE_MODE = 'mock'`
- `OPENAI_API_KEY = ''`
- `ANTHROPIC_API_KEY = ''`
- `RESEND_API_KEY = ''`

No cloud endpoints were called. No outbound network traffic was generated for the mission.

Packet-level capture was not re-attempted; the limitation from Phase 10 remains.

## Regression Gate

| Command | Result | Counts |
|---|---|---|
| `npm run typecheck` | PASS | — |
| `npm run build` | PASS | — |
| `npm run hydi:readiness` | PASS | `System: READY` |
| `npm test` | PASS | 255/255 suites, 2469/2470 tests, 1 skipped, 0 failed |

## Test Counts

| Suite | Result |
|---|---|
| `tests/unit/hydi-phase13-autonomous-acceptance.test.js` | **PASS** — 4/4 |
| `tests/unit/heidi-executive/phase12-autonomous.test.js` | **PASS** — 14/14 (prior run) |

## Remaining Blockers

From `docs/HYDI_TRUE_RELEASE_BLOCKERS.md`, updated:

- `make_operational` generic acceptance remains **BLOCKED**; the bounded `HEALTHY_INBUCKET` mission is now **VERIFIED**.
- Packet-level network proof remains **NOT AVAILABLE**.
- 42 Edge Functions runtime verification not done.
- Full `/api/chat` pipeline not verified.

## Final Verdict

**GO WITH LIMITATIONS**

Heidi successfully completed an end-to-end autonomous local recovery mission with persistent audit, idempotency, and safe failure paths. The autonomy is bounded to `supabase_inbucket` recovery and does not include unrestricted self-healing.
