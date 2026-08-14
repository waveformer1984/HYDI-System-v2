# HYDI Heidi → Rezonate Operational Phase 2 Report

Branch: `feat/hydi-system-wide-audit`  
Commit base: `78ec4bbd7d6e73b4d89597852129f1dbf97046a3`  
Date: 2026-08-14

## 1. What Is Now Operational

The Heidi → Rezonate control plane is now a small, bounded, locally operating orchestrator for the verified Rezonate project/track API surface. The following are proven end-to-end:

| Capability | Status | Evidence |
|---|---|---|
| Heidi-controlled local Rezonate project creation | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 18; `tests/unit/chat-route-rezonate.test.js` line 126 |
| Heidi-controlled local Rezonate project listing | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 32 |
| Heidi-controlled local Rezonate project retrieval | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 44 |
| Heidi-controlled local Rezonate track creation | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 58 |
| Heidi-controlled local Rezonate track listing | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 72 |
| Explicit intent normalization | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 112; `lib/rezonate/intent.js` |
| `rezonate:manage` enforcement | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 86 |
| Local audit log | **FUNCTIONAL** | `pao-system/core/audit.log.ts`; verified in tests via `controller.getAuditLog()` |
| Control-plane health surface | **FUNCTIONAL** | `lib/rezonate/control-health.js`; `tests/unit/heidi-rezonate-acceptance.test.js` line 121 |
| Failure-safety (failed repo → truthful response) | **VERIFIED** | `tests/unit/heidi-rezonate-acceptance.test.js` line 136 |

## 2. Exact Task Types Implemented

These task types map 1:1 to the canonical `lib/rezonate/rezonate-client.js` and the canonical Rezonate repository. No second persistence path exists.

- `REZONATE_CREATE_PROJECT` → `createProject(input)`
- `REZONATE_LIST_PROJECTS` → `listProjects()`
- `REZONATE_GET_PROJECT` → `getProject(id)`
- `REZONATE_CREATE_TRACK` → `createTrack(projectId, { name })`
- `REZONATE_LIST_TRACKS` → `listTracks(projectId)`

The following remain in the routing matrix but are **not** implemented because the canonical repository does not support them:

- `REZONATE_UPDATE_PROJECT`
- `REZONATE_UPDATE_TRACK`
- `REZONATE_GET_TRACK`
- `REZONATE_CREATE_JOB` / `REZONATE_START_JOB` (only `createProcessingJob` and `getProcessingJob` exist)
- `REZONATE_EXPORT_PROJECT`

## 3. Exact Authorization Behavior

- All `REZONATE_*` operations routed through `HeidiController.processUserEvent()` require the `rezonate:manage` permission.
- `lib/auth/rbac.js` `hasPermission(role, 'rezonate:manage')` is called before any repository or agent action.
- `owner` and `operator` hold `rezonate:manage`; `viewer` and `agent` do not.
- A request with `viewer` role returns `{ ok: false, reason: "role 'viewer' lacks permission 'rezonate:manage'" }` and is recorded in the audit log.
- The chat router (`api/chat/route.js`) still validates the HMAC `x-hydi-service-token`, which is treated as `owner` for backward compatibility.

## 4. Exact Persistence Path

```
User message
  → lib/rezonate/intent.js
  → api/chat/route.js
  → pao-system/core/heidi.controller.ts
  → pao-system/agents/execution/rezonate.agent.ts
  → lib/rezonate/rezonate-client.js
  → protoforge-applications/rezonate/src/repository.js
  → protoforge-applications/rezonate/data/heidi-db.json
  → protoforge-applications/rezonate/data/heidi-events.json
```

No cloud Supabase, no direct table queries, no second repository.

## 5. Exact Audit/Event Behavior

- Every `processUserEvent()` call records `HEIDI_USER_EVENT_RECEIVED`.
- Permission denials record `HEIDI_PERMISSION_DENIED`.
- Agent results record `HEIDI_AGENT_SUCCESS` or `HEIDI_AGENT_FAILURE`.
- `RezonateAgent` emits `REZONATE_TASK_COMPLETED` or `REZONATE_TASK_FAILED` with: `task_type`, `task_id`, `input`, `result`, `success`, `failure_reason`, `routed_by`, `timestamp`.
- Audit records are written to `data/pao-audit/audit.log.jsonl` when `PAO_AUDIT_LOG` is not `false`.
- Secrets are redacted from `payload` and `result` before persistence.
- Failed operations are durably recorded as failures.

## 6. Health Behavior

`lib/rezonate/control-health.js` returns a health object with independent status for:

- `heidi_controller` — `HeidiController` constructed and `running` state.
- `rezonate_agent` — `RezonateAgent` registered and `active`.
- `rezonate_canonical_api` — canonical client import verified.
- `local_persistence` — canonical JsonStore with `heidi-db.json` file. A fresh repository instance recovers the same projects.
- `event_bus` — `EventBus` exists.

Each layer reports `available: true/false`. The top-level `ok` is `true` only when every layer is available.

## 7. Failure Behavior

- Malformed or ambiguous user intent → `{ ok: false, reason }` before any agent is invoked.
- Missing `name` for create-project → `REZONATE_CREATE_PROJECT requires { name: string }`.
- Unknown project id → `Project not found`.
- Unauthorized role → `role 'viewer' lacks permission 'rezonate:manage'`.
- Repository errors propagate through `BaseAgent.execute()` and are returned as `{ ok: false, reason }` by `HeidiController`. No false-success path exists.
- Forbidden intents (`delete`, `publish`, `mint`, `nft`, etc.) are rejected at the normalization layer.

## 8. Tests Run and Exact Results

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** (warnings only) |
| `npm run validate:rezonate-contract` | **PASS** |
| `node --test protoforge-applications/rezonate/tests/*.test.js` | **128/128 PASS** |
| `npx jest tests/unit/persistence-guard.test.js` | **5/5 PASS** |
| `npx jest tests/unit/chat-route-rezonate.test.js tests/unit/heidi-rezonate-acceptance.test.js --verbose` | **17/17 PASS** |
| `npm test -- --testPathPattern=tests/unit` | **1089 PASS, 4 FAIL, 1 suite fail to run** |

The `npm test` failures are pre-existing and unrelated to this slice:

| Failed test | Reason |
|---|---|
| `tests/unit/no-hardcoded-secrets.test.js` | `git ls-files` fails due to `dubious ownership` in the WSL environment. |
| `tests/unit/heidi-core-action-executor.test.js` | Same `git` ownership issue when running `git` subcommands. |
| `tests/unit/goal-executor.test.js` | Pre-existing `deploy task` assertion failure (not related to Rezonate). |
| `tests/unit/proto-yi-diagnostics.test.js` | Proto YI reachable when test expected it to be unreachable. |
| `tests/unit/hydi-v3/HardwareDiscovery.test.js` | GPU enumeration mismatch in the current environment. |

No new failures were introduced by this work.

## 9. Capability-Contract Changes

No changes were made to `protoforge-applications/rezonate/capability-contract.json`.

Rationale: the existing contract captures Rezonate audio/studio capabilities. The new work is an integration and control-plane capability, not a new Rezonate feature. Heidi routing to an existing `VERIFIED` capability does not by itself justify promoting or adding a contract entry. A separate integration-level contract may be created in a future phase.

## 10. Remaining Gaps

1. **Update operations** (`REZONATE_UPDATE_PROJECT`, `REZONATE_UPDATE_TRACK`) are not implemented because the canonical repository does not yet have `updateProject`/`updateTrack` methods.
2. **Processing jobs** (`REZONATE_CREATE_JOB`, `REZONATE_START_JOB`) are not wired through Heidi because the public surface is still `createProcessingJob` / `getProcessingJob`, which require clearer intent parameters.
3. **Export** (`REZONATE_EXPORT_PROJECT`) is not implemented; `export` packaging exists but is not exposed as a Heidi task.
4. **Ownership / rights / collaborators** are not exposed through Heidi; they remain human-approval-required as per the authority matrix.
5. **Delete, publish, NFT, blockchain, marketplace** are forbidden and explicitly rejected by the intent normalizer.
6. **Device-token role resolution** is not yet wired into the chat router; the slice relies on the service-token owner path.
7. **Audit log** is local JSON only; long-term retention and integrity checks are not implemented.

## 11. Security Concerns

1. **Service token = owner**: any caller with a valid `x-hydi-service-token` is treated as `owner` for the chat router. This is acceptable for internal local use but must be revisited before exposing to external users.
2. **No `x-hydi-device-token` resolution** in this slice: the chat router does not resolve device tokens to roles. Device-token callers cannot yet use the Rezonate control plane.
3. **Audit log on filesystem**: `data/pao-audit/audit.log.jsonl` may contain operation metadata. It does not contain secrets (redaction is applied), but file permissions should be reviewed in production.
4. **No replay protection or integrity hashing** on audit records.

## 12. Recommended Next Phase

1. Add `updateProject` and `updateTrack` to the canonical Rezonate repository, then wire them through Heidi with human-approval gating.
2. Implement device-token role resolution in `api/chat/route.js` using the existing `lib/auth/deviceAuth.js` (with local fallback to avoid cloud dependency).
3. Promote `HEIDI_AGENT_SUCCESS`/`HEIDI_AGENT_FAILURE` events to durable, integrity-protected storage (append-only, hashed).
4. Add a real human-approval gate for `REZONATE_UPDATE_*` and any ownership/rights task types.
5. Wire `REZONATE_CREATE_PROCESSING_JOB` and `REZONATE_GET_PROCESSING_JOB` only when the canonical `createProcessingJob` input contract is fully understood and local-only.
6. Keep `delete`, `publish`, `NFT`, `marketplace`, and `blockchain` forbidden in the normalizer.

## 13. Summary

The first vertical slice has been hardened into a controlled, auditable, locally operating orchestrator. Heidi can now create, list, get, and track projects through an explicit, permission-gated, failure-safe control plane with durable audit events and a local health surface. No cloud dependency was added, no second persistence path was created, no false-success path exists, and no unrestricted autonomous authority was granted.
