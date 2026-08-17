# HYDI Heidi → Rezonate Control-Plane Hardening Report

Date: 2026-08-14  
Repo: `C:\Users\Owner\HYDI-System-v2`  
Branch: `feat/hydi-system-wide-audit`  
Scope: Phase 3 — harden the Heidi control plane for the local-first Rezonate vertical slice.

## 1. Objective

Make the existing Heidi → Rezonate control plane safe, explicit, auditable, and reusable before any additional domain (e.g., Apex) is connected.

## 2. Verified operations

The five Rezonate operations that have been end-to-end verified through Heidi remain:

- `REZONATE_CREATE_PROJECT`
- `REZONATE_LIST_PROJECTS`
- `REZONATE_GET_PROJECT`
- `REZONATE_CREATE_TRACK`
- `REZONATE_LIST_TRACKS`

The following were **not** added because the canonical Rezonate repository does not currently provide matching methods or because they are intentionally forbidden:

- `REZONATE_GET_TRACK` — no `getTrack()` canonical method.
- `REZONATE_UPDATE_PROJECT` — no `updateProject()` canonical method.
- `REZONATE_UPDATE_TRACK` — no `updateTrack()` canonical method.
- `REZONATE_NFT`, `REZONATE_MARKETPLACE`, `REZONATE_MASTERING`, `REZONATE_BLOCKCHAIN` — forbidden by policy; not wired.

## 3. Authority model

| Task | Permission | Read / Mutation | Authorized success | Unauthorized rejection | Malformed rejection | No repo after auth failure |
|---|---|---|---|---|---|---|
| `REZONATE_LIST_PROJECTS` | `rezonate:manage` | READ | yes | yes | yes | yes |
| `REZONATE_GET_PROJECT` | `rezonate:manage` | READ | yes | yes | yes | yes |
| `REZONATE_CREATE_PROJECT` | `rezonate:manage` | MUTATE | yes | yes | yes | yes |
| `REZONATE_LIST_TRACKS` | `rezonate:manage` | READ | yes | yes | yes | yes |
| `REZONATE_CREATE_TRACK` | `rezonate:manage` | MUTATE | yes | yes | yes | yes |

`viewer`, `agent`, and unknown roles are denied before the repository is touched. `owner` and `operator` (with `rezonate:manage`) succeed for valid, verified tasks.

## 4. Intent model

- `lib/rezonate/intent.js` now validates and extracts parameters explicitly.
- It returns `{ taskType, parameters }` only for the five verified operations.
- It rejects malformed requests with explicit reasons (`malformed: REZONATE_... requires ...`).
- It classifies unsupported/planned/forbidden intents via `lib/rezonate/capability-guard.js`.
- It does not execute, does not call the repository, and does not use cloud or AI parsers.

## 5. Failure behavior

Failure boundaries, from user to response:

1. `lib/rezonate/intent.js` rejects malformed/ambiguous/unsupported input.
2. `HeidiController.processUserEvent` rejects unauthorized roles.
3. `HeidiController` rejects non-`VERIFIED` capabilities.
4. `HeidiController` rejects exact duplicate mutations within the 5-second idempotency window.
5. `RezonateAgent` validates parameters; repository errors throw and emit `REZONATE_TASK_FAILED`.
6. `HeidiController.routeToAgent` catches the error, records `HEIDI_AGENT_FAILURE`, and returns `{ ok: false, reason }`.

Repository failure never becomes a success response.

## 6. Audit behavior

- `pao-system/core/audit.log.ts` now adds an `ISO-8601` timestamp to every record.
- `AuditLog.redactPayload` masks fields containing `secret`, `key`, `token`, or `password`.
- Every verified operation produces a `HEIDI_USER_EVENT_RECEIVED` record and either `HEIDI_AGENT_SUCCESS` or `HEIDI_AGENT_FAILURE`.
- `RezonateAgent` emits `REZONATE_TASK_COMPLETED` or `REZONATE_TASK_FAILED`.
- Failed operations cannot emit a `*_SUCCESS` record.

## 7. Idempotency

- The canonical `ResonateRepository.createProject()` and `createTrack()` do not de-duplicate; they create a new entity every call.
- Heidi prevents exact duplicate mutations within a 5-second window using an in-memory `(taskType, JSON.stringify(input))` key.
- This is the safest behavior supported by the existing architecture without inventing a second persistence layer.

## 8. Health behavior

`lib/rezonate/control-health.js` reports six independent layers, each with its own `available` flag:

- `HEIDI_CONTROLLER`
- `TASK_ROUTER`
- `REZONATE_AGENT`
- `REZONATE_CLIENT`
- `LOCAL_PERSISTENCE`
- `EVENT_BUS`

The top-level `ok` is only `true` when every layer reports available. Partial failure is not collapsed into a generic "healthy" status.

## 9. Capability awareness

`lib/rezonate/capability-guard.js` maps `REZONATE_*` task types to:

- `VERIFIED` — Heidi routes and executes.
- `FUNCTIONAL` / `SCAFFOLD` / `PLANNED` — Rejected with `state` and `reason`; not executed.
- `MISSING` — Rejected because no canonical repository method exists.
- `FORBIDDEN` — Rejected for policy reasons (NFT, marketplace, mastering, blockchain, delete).

Heidi never hallucinates an implementation.

## 10. Security findings

- No Heidi task can bypass `rezonate:manage` RBAC.
- No Heidi task can directly access Supabase for Rezonate state.
- No Heidi task can bypass the canonical `ResonateRepository`.
- The canonical `JsonStore` writes only inside the configured `REZONATE_DATA_DIR`.
- Audit payloads are redacted; no secrets are exposed through responses, events, or logs.

## 11. Test results

| Command / Suite | Result | Notes |
|---|---|---|
| `tests/unit/heidi-control-plane-acceptance.test.js` | **PASS** 35/35 | One suite covering authority, intent, capability, failure, idempotency, audit, health, E2E, and security. |
| `tests/unit/heidi-rezonate-acceptance.test.js` | **PASS** 8/8 | Phase 2/3 legacy acceptance, updated to cover mock client. |
| `tests/unit/chat-route-rezonate.test.js` | **PASS** 7/7 | Chat surface, HMAC service token, capability awareness. |
| `tests/unit/persistence-guard.test.js` | **PASS** 8/8 | Local JSON persistence and restart recovery. |
| `npm run typecheck` | **PASS** | `tsc --noEmit` clean. |
| `npm run build` | **PASS** | Succeeded with pre-existing ESLint warnings only. |
| `npm run validate:rezonate-contract` | **PASS** | 44 capabilities, 1 deprecated, 2 unaudited. |
| `node --test protoforge-applications/rezonate/tests/*.test.js` | **PASS** 128/128 | Canonical Rezonate Node test suite. |
| `npm test` (full suite) | 1794/1801 | 7 pre-existing unrelated failures: Hardware GPU count, GoalExecutor deploy, WSL Git ownership (`heidi-core-action-executor`, `no-hardcoded-secrets`), Proto YI reachability, V3 Heartbeat, V3 DistributedCompute. None caused by this change. |

## 12. Files changed

- `lib/rezonate/capability-guard.js` — new
- `lib/rezonate/intent.js` — hardened validation and forbidden-intent handling
- `lib/rezonate/control-health.js` — six-layer health surface
- `pao-system/core/heidi.controller.ts` — capability gate, idempotency guard, `task_router`/`rezonate_client` health fields
- `pao-system/core/audit.log.ts` — auto-timestamp records
- `tests/unit/heidi-control-plane-acceptance.test.js` — new single acceptance suite
- `tests/unit/heidi-rezonate-acceptance.test.js` — mock client updated for health probe
- `docs/HEIDI_OPERATIONAL_AUTHORITY_MATRIX.md` — Phase 3 authority table added
- `docs/HEIDI_REZONATE_INTEGRATION_MAP.md` — Phase 3 hardening section added
- `HYDI_HEIDI_CONTROL_PLANE_HARDENING_REPORT.md` — this file

## 13. Remaining blockers

- The PAO `ApprovalEngine` and `RiskEngine` are not yet active for the five Rezonate operations; they do not block the verified slice because all mutations are local and deterministic.
- No read-only `rezonate:view` permission exists; `viewer` cannot list state. This is a role-design gap, not a hardening blocker.
- Real health wiring to `api/ursula/status.js` has not been end-to-end tested against a running canonical API.
- Idempotency is in-process only; a future phase should persist an idempotency key if cross-process duplicate prevention is required.

## 14. Conclusion

The Heidi → Rezonate control plane now passes the hardening gate. It is explicit (validated intent + capability awareness), safe (RBAC + duplicate guard + no repository after auth failure), auditable (timestamped, redacted events), observable (six-layer health), and reusable (the authorization and failure boundaries are domain-agnostic). Additional domains should only be connected once each has a similar evidence-backed hardening pass.
