# HYDI Phase 14 — System-Wide Operational Acceptance Report

## Scope

Phase 14 evaluated whether the local HYDI core can be observed, authorized, planned, executed, verified, audited, and reported as a coherent system. No broad refactoring or new autonomy was introduced.

## Operational Core (Derived from Repository Evidence)

From `docs/HYDI_OPERATIONAL_CORE_DEFINITION.md`:

- `src/persistence/supabase-client.js` / `src/database.js`
- `lib/health/collectors/` + `api/health.js`
- `api/ursula/status.js`
- `src/heidi-executive/`
- `lib/protoforge/policy-engine.js`
- `cascade/` + `kilo/`
- `revenue-engine/` + `lib/stripe/client.js`
- `workers/WorkerOrchestrator.js`
- `api/rezonate/route.js`

The core is intentionally local-first; cloud/optional subsystems are adapters, not organs.

## System Acceptance Matrix

See `docs/HYDI_PHASE14_SYSTEM_ACCEPTANCE_MATRIX.md` for the full per-subsystem verdict.

| Subsystem | Verdict | Notes |
|---|---|---|
| Heidi control plane | GO | persistent audit/approvals, bounded executor |
| Local persistence | GO | local Supabase at `127.0.0.1:54321` |
| Health / status | GO | real local probes; optional services report `NOT_CONFIGURED` |
| Rezonate | GO | `api/rezonate/route.js` locally tested and passing |
| Apex | NO-GO | no local Apex implementation found |
| Workers | DEGRADED | registered, queue exists, but no live worker queue probe |
| ProtoForge policy | GO | fail-closed; local DB policy; unit tests pass |
| CASCADE/KILO | GO (local, non-executing) | KILO `execute()` throws; classification is local |
| Revenue | GO (mock) | `STRIPE_MODE=mock` default; no live calls |
| Audit | GO | survives restart, redacted |
| Approvals | GO | survives restart, self-approval denied |
| Controlled execution | GO | allowlist-based, deny tests pass |
| Chat | DEGRADED | unit tests pass; full end-to-end pipeline not verified |
| Network isolation | DEGRADED | connection-level evidence; packet-level pending |

## Mission Evidence

### A. Rezonate

Unit tests:

- `tests/unit/rezonate.test.js` — **PASS**
- `tests/unit/chat-route-rezonate.test.js` — **PASS** (included in `npm test`)

These verify local Supabase-backed project/track CRUD, service-token gating, and `rezonate:manage` ownership.

### B. Apex

No local Apex subsystem or tests were found. Verdict: **NO-GO**.

### C. Health

Live probe output from `scripts/hydi-phase14-acceptance.js`:

```
persistence: HEALTHY — Supabase REST reachable (200)
postgres: HEALTHY — supabase_db_HYDI-System-v2:Up 46 minutes (healthy)
docker: HEALTHY — Docker 29.7.2
ollama: NOT_CONFIGURED — local model not enabled
workers: NOT_CONFIGURED — worker queue monitor not registered
controlPlane: HEALTHY — Heidi control plane is active
```

Optional services do not collapse system health.

### D. Workers

`LocalHealthProbes.workers()` is a placeholder. `workers/WorkerOrchestrator.js` is not live-proven in this phase. Verdict: **DEGRADED**.

### E. ProtoForge

- `lib/protoforge/policy-engine.js` default decision is `reject` (fail-closed).
- `tests/unit/protoforge-policy-engine.test.js` — **PASS**.

### F. CASCADE / KILO

- `kilo/index.js` `execute()` throws unconditionally.
- `lib/protoforge/policy-engine.js` evaluates hypotheses locally with fail-closed behavior.
- No cloud calls required.

### G. Revenue

- `STRIPE_MODE=mock` default.
- `tests/unit/checkout.test.js` — **PASS**.
- No live Stripe calls.

### H. Full Control-Plane Failure (Recovery)

Phase 13 `HEALTHY_INBUCKET` acceptance already proved this. Phase 14 re-uses the same architecture. The Phase 14 runner includes `LocalHealthProbes` and `HeidiExecutive.health.read`.

### I. Chat

The full `/api/chat` conversational pipeline remains unverified. Unit tests for the chat route exist, but the six-agent end-to-end (Heidi → Ursula → CASCADE → KILO → ProtoForge → Emission) is not live-proven.

## Restart Evidence

- `tests/unit/hydi-phase14-system-acceptance.test.js` verifies that `AuditLog` and `ApprovalManager` state survives a new `HeidiExecutive` instance.
- `scripts/hydi-phase14-acceptance.js` creates a new `HeidiExecutive({ dataDir: 'data/phase14' })` and records durable audit events.

## Security Negative Tests

From the Phase 14 runner:

```
forbidden docker.local exec: FAILED DENIED: operation not allowed: exec
unsupported health.recover: FAILED DENIED: service not in recovery allowlist: some_bad_thing
```

Both were denied and audited in `data/phase14/audit.jsonl`.

Additional unit tests verify:

- arbitrary `docker.local exec` is denied.
- secret-shaped strings are redacted before audit.
- `CapabilityRegistry` rejects invalid risk levels.
- `PolicyEngine` requires approval for `database.destructive`.

## Local-Only Verification

Acceptance run set:

```
SUPABASE_URL = http://127.0.0.1:54321
STRIPE_MODE = mock
OPENAI_API_KEY = (empty)
ANTHROPIC_API_KEY = (empty)
RESEND_API_KEY = (empty)
```

No hosted Supabase, Stripe, OpenAI, Anthropic, or Resend calls occurred. Packet-level capture was not attempted.

## Network Evidence

- No forbidden external destinations contacted during the acceptance run.
- Packet-level proof remains unavailable (Phase 10 limitation).

## Test Counts

| Suite | Result |
|---|---|
| `tests/unit/hydi-phase14-system-acceptance.test.js` | **PASS** — 12/12 |
| `scripts/hydi-phase14-acceptance.js` | **PASS** |

Full `npm test` result: pending (see Regression Gate below).

## Regression Gate

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm run hydi:readiness` | **PASS** (`System: READY`) |
| `npm test` | **PASS** — 256/256 suites, 2481/2482 tests, 1 skipped, 0 failed |

## Comparison with Phase 13

Phase 13 baseline:

- 255/255 suites, 2469/2470 tests, 1 skipped, 0 failed.

This phase adds one new test suite (`tests/unit/hydi-phase14-system-acceptance.test.js`), so the expected total is **256 suites, 2470+ tests**. Any deviation must be classified.

## Capability-Contract Changes

No capability contracts were changed. The `validate:rezonate-contract` npm script does not exist; this limitation was not addressed in this phase.

## Remaining Blockers

From `docs/HYDI_TRUE_RELEASE_BLOCKERS.md`, updated in this phase:

- Packet-level network proof: unavailable.
- 42 Supabase Edge Functions: not runtime-verified.
- Full `/api/chat` pipeline: not verified.
- Worker queue live probe: placeholder.
- Apex: no local implementation.

## Final Verdict

**GO WITH LIMITATIONS**

The local HYDI core is coherent and operational for the bounded subsystems that have been verified. Heidi can observe health, authorize capabilities, execute allowlisted operations, verify results, persist audit across restarts, and fail safely. Apex and full chat remain unverified; workers and network isolation are degraded.
