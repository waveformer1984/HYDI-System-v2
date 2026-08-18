# Apex Phase 4 — Control Plane Audit

## Scope

This audit inspects the Heidi control plane as it exists after Apex Phase 3 and Rezonate control-plane hardening. It determines what Heidi can command, observe, persist, and recover for the local Apex + Rezonate workflow, and what remains forbidden or scaffolded.

## Architecture

```text
USER
  ↓
HEIDI (HeidiController)
  ↓
AUTHORIZATION  (lib/auth/rbac.js)
  ↓
INTENT / PAYLOAD VALIDATION (agent handle_event)
  ↓
CAPABILITY GUARD (lib/rezonate/capability-guard.js, lib/apex/apex-capability-guard.js)
  ↓
TASK ROUTER (pao-system/core/heidi.controller.ts routing matrix)
  ↓
APEX AGENT / REZONATE AGENT (pao-system/agents/execution/*.agent.ts)
  ↓
CANONICAL LOCAL REPOSITORY (lib/rezonate/rezonate-client.js, lib/apex/apex-client.js)
  ↓
LOCAL PERSISTENCE (JSON stores)
  ↓
AUDIT EVENT (pao-system/core/audit.log.ts)
  ↓
STATUS / RESPONSE
```

## 1. What Heidi can currently command

| Task | Domain | Action |
|---|---|---|
| `REZONATE_CREATE_PROJECT` | Rezonate | Create a music project in the canonical local repository |
| `REZONATE_LIST_PROJECTS` | Rezonate | List all projects |
| `REZONATE_GET_PROJECT` | Rezonate | Get a project by id |
| `REZONATE_CREATE_TRACK` | Rezonate | Create a track under a project |
| `REZONATE_LIST_TRACKS` | Rezonate | List tracks for a project |
| `REZONATE_GET_JOB` | Rezonate | (routed, not executed) |
| `REZONATE_CREATE_JOB` | Rezonate | (routed, not executed) |
| `REZONATE_START_JOB` | Rezonate | (routed, not executed) |
| `REZONATE_EXPORT_PROJECT` | Rezonate | (routed, not executed) |
| `REZONATE_HEALTH` | Rezonate | (routed, not executed) |
| `APEX_PROJECT_CREATED` | Apex | Create or recover a HYDI project identity, create an idempotent Rezonate project, and map Apex `project_id` to it |
| `APEX_EPISODE_CREATED` | Apex | Record an episode under the mapped project |
| `APEX_EVENT_RECORDED` | Apex | Append a generic observability event |
| `APEX_EPISODE_APPROVED` | Apex | Record approval observation |
| `APEX_EPISODE_PUBLISHED` | Apex | Record publication observation |
| `APEX_EPISODE_FAILED` | Apex | Record failure observation |
| `APEX_EPISODE_ARCHIVED` | Apex | Record analytics observation |
| `APEX_UPLOAD` | Apex | Rejected (SCAFFOLD) |
| `APEX_PUBLISH` | Apex | Rejected (FORBIDDEN) |
| `GET_APEX_PROJECT_STATUS` | Apex | Return mapping + Rezonate project + episode count |
| `GET_APEX_HEALTH` | Apex | Return local persistence metrics |

## 2. What Heidi can currently observe

- `HeidiController.getHealth()` returns availability of controller, task router, Rezonate agent, Rezonate client, local persistence, and event bus.
- `GET_APEX_HEALTH` returns Apex mapping count, event count, processed-id count, and data directory.
- `GET_APEX_PROJECT_STATUS` returns truthful existence/missing state for a given Apex project.
- `lib/rezonate/control-health.js` provides a dedicated Rezonate health probe.
- The `AuditLog` keeps an in-memory recent history and an append-only `data/pao-audit/audit.log.jsonl`.
- Agent task results are emitted back through the event bus and returned from `processUserEvent`.

## 3. What Heidi can persist

| State | Mechanism | Owner |
|---|---|---|
| Rezonate project/track records | `protoforge-applications/rezonate/src/persistence` JsonStore (`heidi-db.json`) | Rezonate canonical repository |
| Apex project → Rezonate mapping | `data/apex/project-map.json` (atomic write) | `lib/apex/apex-client.js` |
| Apex ingested events | `data/apex/events.jsonl` (append) | `lib/apex/apex-client.js` |
| Apex processed event ids | `data/apex/processed-event-ids.json` | `lib/apex/apex-client.js` |
| Controller audit trail | `data/pao-audit/audit.log.jsonl` | `pao-system/core/audit.log.ts` |

All persistence is local filesystem. No Supabase, no Redis, no cloud queues.

## 4. What Heidi can recover after restart

- Rezonate state is recovered by loading `heidi-db.json` into the canonical repository.
- Apex mapping is recovered by loading `project-map.json`.
- Events are recovered by reading `events.jsonl`.
- Tests in `tests/unit/apex-phase3-lifecycle.test.js` prove a fresh `HeidiController` recovers the same Rezonate project UUID after `resetRepo()`.

## 5. What requires human approval

- YouTube publishing / `APEX_PUBLISH` is `FORBIDDEN` without explicit human approval.
- Any `REZONATE_*` or `APEX_*` task not listed as `VERIFIED` is rejected unless explicitly promoted.
- Destructive operations (delete, drop, publish, mint, sell) are rejected by the Rezonate intent normalizer.
- `lib/auth/rbac.js` requires `owner` or `operator` for `rezonate:manage` and `apex:manage`.

## 6. What is forbidden

| Task / Phrase | State | Reason |
|---|---|---|
| `REZONATE_NFT` | FORBIDDEN | Policy |
| `REZONATE_MARKETPLACE` | FORBIDDEN | Policy |
| `REZONATE_MASTERING` | FORBIDDEN | Policy |
| `REZONATE_BLOCKCHAIN` | FORBIDDEN | Policy |
| `REZONATE_DELETE` | FORBIDDEN | Policy |
| `REZONATE_GET_TRACK` | MISSING | No canonical method |
| `REZONATE_UPDATE_PROJECT` | MISSING | No canonical method |
| `REZONATE_UPDATE_TRACK` | MISSING | No canonical method |
| `REZONATE_EXPORT_PROJECT` | SCAFFOLD | Not wired |
| `APEX_UPLOAD` | SCAFFOLD | No real YouTube call |
| `APEX_PUBLISH` | FORBIDDEN | Autonomous publishing disallowed |

## 7. What is merely scaffolded

- `REZONATE_EXPORT_PROJECT` — task is routed but not executed.
- `REZONATE_HEALTH` — routed but not executed.
- `REZONATE_GET_JOB`, `CREATE_JOB`, `START_JOB` — routed but not executed.
- `APEX_UPLOAD` — explicit scaffold; rejected.
- `GET_APEX_HEALTH` — implemented, but not yet integrated into a unified control health surface.

## 8. What still bypasses Heidi

- `tools/apex-archive-bridge.js` runs as a standalone CLI. It creates its own `HeidiController`, which is fine, but there is no centralized scheduler or daemon. It is a manual/scheduled tool.
- Direct file writes to `data/apex` and `data/pao-audit` only occur through the canonical clients (`lib/apex/apex-client.js`) and `AuditLog`. No bypass is found.
- The Rezonate canonical repository is the only writer to `heidi-db.json`.

## 9. Any direct Supabase/cloud access

- `lib/apex/apex-client.js` does not import Supabase.
- `lib/rezonate/rezonate-client.js` does not import Supabase.
- `pao-system/agents/execution/apex.agent.ts` and `rezonate.agent.ts` do not import Supabase.
- `lib/rezonate/rezonate-client.js` `createClient` accepts an injected client for a `supabase` store type, but the Heidi path defaults to `json` local store.
- Unrelated `utils/supabase/*.ts` and `supabase/functions/` exist elsewhere in HYDI; they are outside the Apex/Rezonate local slice and are not used by it.

## 10. Any direct filesystem mutation that bypasses the canonical owner

None found. All local file writes are through:
- `protoforge-applications/rezonate/src/persistence`
- `lib/apex/apex-client.js`
- `pao-system/core/audit.log.ts`

## 11. Any task that can execute without authorization/capability validation

None. `HeidiController.processUserEvent` checks:
1. `hasPermission(role, permission)` for `REZONATE_*` and `APEX_*`.
2. Capability guard state (`VERIFIED`) for `REZONATE_*` and `APEX_*`.
3. Idempotency for mutations.
4. Agent payload validation before execution.

## Conclusion

The control plane is structurally sound, locally-only, and bounded. The primary remaining gap is the lack of a unified operational status task that lets Heidi report the combined Apex + Rezonate subsystem state in a single, truthful call. This is the recommended minimum control for Phase 4.
