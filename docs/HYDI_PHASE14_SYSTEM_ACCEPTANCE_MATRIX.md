# HYDI Phase 14 — System Acceptance Matrix

## Evaluation Discipline

A subsystem is **GO** only if it is observed, authorized, executed, verified, and audited through the local-first architecture. **DEGRADED** means it operates locally but has a known gap. **NO-GO** means it depends on cloud infrastructure or is not currently operational. **NOT APPLICABLE** means it is not a defined HYDI subsystem.

## Matrix

| Subsystem | Observation | Capability | Authority | Executor | Persistence | Verification | Failure | Audit | Evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Heidi control plane | `HeidiExecutive.run()` | `CapabilityRegistry` | `PolicyEngine` + `ApprovalManager` | `ControlledExecutor` | `AuditLog` / `Approvals` files | unit tests pass, `hdi:readiness` READY | returns `FAILED`, no unsafe fallback | `data/audit.jsonl` | `HeidiExecutive` tests, Phase 13 runner | GO |
| Local persistence | `LocalHealthProbes.persistence()` | `database.local` (status) | `health.read` | `ControlledExecutor` | Supabase/Postgres at `127.0.0.1:54322` | `npm test` persistence tests pass | `UNAVAILABLE` status | `AuditLog` records DB ops | `tests/unit/persistence-guard.test.js`, Phase 13 | GO |
| Health / status | `LocalHealthProbes` + `api/health` | `health.read`, `health.recover` | `HeidiExecutive` | `ControlledExecutor` | `system_dashboard` view, local DB | `/api/health` and `/api/ursula/status` return local results | `DEGRADED`/`UNAVAILABLE` truthful | health events logged | `api/health`, `api/ursula/status`, Phase 13 | GO |
| Rezonate | `api/rezonate/route.js` | `rezonate:manage` | `requireAuth` + `HYDI_SERVICE_TOKEN` | route handler | local Supabase `rezonate_projects`/`rezonate_tracks` | `tests/unit/rezonate.test.js` 15/15 pass | 401/403/404 | actions table (Rezonate dispatch) | unit tests | GO |
| Apex | `src/apex/index.js` boundary stub | `createApex` | n/a — explicitly non-operational in local-first | `ApexLocalBoundary` | n/a | returns `NOT_AVAILABLE_IN_LOCAL_MODE` deterministically | returns safe `NOT_AVAILABLE_IN_LOCAL_MODE` | n/a | `tests/unit/apex-local-boundary.test.js` | GO (boundary stub) |
| Workers | `LocalHealthProbes.workers()` placeholder | `workers/` registration | `WorkerOrchestrator` required | not exercised live | local DB queue table | placeholder only | `NOT_CONFIGURED` | not wired into executive audit | no live worker dispatch test | DEGRADED |
| ProtoForge policy | `lib/protoforge/policy-engine.js` | `policies` table | local DB rules | policy engine | `policies` + `decisions` tables | `npm test` policy tests pass | fail-closed `reject` | `decisions` table | `tests/unit/policy-engine.test.js` | GO |
| CASCADE / KILO | `cascade/`, `kilo/` modules | event classification / hypotheses | in-process | no execution authority | RAW LEDGER + `cascade_log` | `npm test` passes | KILO `execute()` throws | immutable ledger | unit tests | GO (local, non-executing) |
| Revenue | `lib/stripe/client.js` | `financial.transaction` | `STRIPE_MODE=mock` default | mock objects | local `ledger` | `npm test` revenue tests pass | mock objects, no calls | ledger entries | `tests/unit/checkout.test.js` | GO (mock) |
| Audit | `AuditLog` + `data/audit.jsonl` | `AuditLog.record()` | redaction via `SecretBroker` | append-only | `data/audit.jsonl` | survive restart test pass | corrupted lines ignored | self-recording | Phase 13, `phase12-autonomous.test.js` | GO |
| Approvals | `ApprovalManager` + `data/approvals.json` | `approval.request` / `.approve` | self-approval prohibited | not executable directly | `data/approvals.json` | survive restart test pass | `EXPIRED` / `REJECTED` | audit records request/approve | `phase12-autonomous.test.js` | GO |
| Controlled execution | `ControlledExecutor.execute()` | allowlisted capabilities | `CapabilityRegistry` | `execFile` to `docker` only for allowlist | result object + audit | deny tests pass | returns `success: false` / throws | all executions logged | `control-plane.test.js`, `phase13` | GO |
| Chat | `api/chat/route.js` | chat router | `requireAuth` / `HYDI_SERVICE_TOKEN` | not fully proven end-to-end | `chat_conversations`/`chat_messages` | `tests/unit/chat.test.js` pass; full pipeline not live | `{"error":"..."}` | not fully audited | partial evidence | DEGRADED |
| Network isolation | `Get-NetTCPConnection` / `netstat` | — | — | — | `artifacts/phase10-network-trace.txt` | no external matches | — | — | Phase 10 connection-level | DEGRADED (packet-level pending) |

## Cloud-Bound / Not Applicable

| Subsystem | Reason | Verdict |
|---|---|---|
| Apex | No local Apex implementation found | NO-GO |
| Hosted Supabase | Local persistence factory rejects hosted URLs | BLOCKED (by design) |
| Live Stripe | Requires `STRIPE_MODE=live` + key; not used in local mode | BLOCKED (by design) |
| OpenAI / Anthropic | Optional, require API keys; not called without keys | BLOCKED (by design) |
| 42 Edge Functions | Vendored but not runtime-served | DEGRADED |
