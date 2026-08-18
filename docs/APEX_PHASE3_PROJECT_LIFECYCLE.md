# Apex Phase 3 — Project Lifecycle Through Heidi to Rezonate

## Objective

Prove one complete, restart-safe, local-first vertical slice:

```text
Apex Archive
     │
     ▼
Local outbox (hydi_outbox/)
     │
     ▼
Apex Archive Bridge
     │
     ▼
Heidi Control Plane
     │
     ▼
Apex Capability Guard + RBAC
     │
     ▼
HYDI Project Identity
     │
     ▼
Rezonate Canonical Repository
     │
     ▼
Local Persistent Storage
     │
     ▼
Process restart
     │
     ▼
Same project recovered
     │
     ▼
Truthful status returned
```

Cloud Supabase is optional and not used by this slice.

## Identity Model

```text
Apex project/venture ID  (owner: Apex Archive)
           │
           ├── maps to ──► HYDI project identity (owner: HYDI/Heidi)
           │                  │
           │                  ├── Rezonate project ID
           │                  │      (owner: Rezonate canonical repository)
           │                  │
           │                  └── Apex episode references
           │
           └── Hydi outbox events carry the Apex project_id
```

A single `project-map.json` inside `data/apex` holds the authoritative local mapping from each Apex `project_id` to its Rezonate project `id`. The Rezonate repository itself stores the project record, so a HYDI project is fully recoverable by re-reading the Rezonate JSON store and the Apex mapping file.

## Event Contract

All events processed by the bridge and Heidi must contain:

- `event_id` — globally unique
- `schema_version` — e.g. `draft-3`
- `event_type` — one of the supported types below
- `source` — `"apex_archive"`
- `timestamp` — ISO 8601
- `correlation_id` — traceable
- `project_id` — Apex project/venture identifier
- `payload` — type-specific data

Supported mappings from Apex to Heidi task:

| Apex `event_type` | Heidi task | Purpose |
|---|---|---|
| `project_created` | `APEX_PROJECT_CREATED` | Create the HYDI / Rezonate project |
| `episode_generated` | `APEX_EPISODE_CREATED` | Record an episode under the project |
| `project_status` | `APEX_EVENT_RECORDED` | General status observation |
| `orchestration_ping` | `APEX_EVENT_RECORDED` | Heartbeat |
| `episode_verified` | `APEX_EVENT_RECORDED` | QA observation |
| `approval_event` | `APEX_EPISODE_APPROVED` | Human approval signal |
| `publication_event` | `APEX_EPISODE_PUBLISHED` | Published signal |
| `analytics_event` | `APEX_EPISODE_ARCHIVED` | Analytics observation |
| `failure_event` | `APEX_EPISODE_FAILED` | Failure observation |

Malformed events are rejected by the bridge; the event file is moved to `hydi_outbox/.failed/` and the failure is reported.

## Authorization

- All `APEX_*` mutations require the `apex:manage` permission.
- `viewer` is denied for mutations; `owner` and `operator` are allowed.
- Capability guard runs before execution: `SCAFFOLD` and `FORBIDDEN` tasks are rejected.
- Read-only tasks (`GET_APEX_PROJECT_STATUS`, `GET_APEX_HEALTH`) do not go through the mutation idempotency window.

## Idempotency

Three layers prevent duplicate work:

1. **Bridge file handling** — an event file is moved to `.processed/` only after a successful `processUserEvent` result; failed events stay in the outbox for retry.
2. **Heidi controller idempotency window** — identical `APEX_PROJECT_CREATED` inputs within 5 seconds are blocked with a deterministic `duplicate` reason.
3. **Apex agent idempotent project creation** — before creating a Rezonate project, the agent checks the local `project-map.json` and the list of existing Rezonate projects by name. If a match is found, the existing project is returned and `idempotent: true` is reported.

## Persistence

- `lib/rezonate/rezonate-client.js` → canonical `JsonStore` at `protoforge-applications/rezonate/data/heidi-db.json`.
- `lib/apex/apex-client.js` → local `data/apex/project-map.json` and `data/apex/events.jsonl`.
- All writes use `fs.writeFileSync` to a temporary file and `fs.renameSync` for atomic replacement.
- Environment variables `REZONATE_DATA_DIR` and `APEX_DATA_DIR` override default locations, which is how tests use isolated temporary directories.

## Failure Recovery

- Malformed JSON or missing required fields → file moved to `.failed/`, reason recorded.
- Rezonate failure (e.g., disk, validation) → event left in outbox, agent emits `APEX_TASK_FAILED`, controller records audit.
- Retry is safe because of the idempotent project-creation logic.
- Process restart is safe because all state is on disk in the canonical stores.

## Audit Trail

The Apex agent emits `APEX_TASK_COMPLETED` or `APEX_TASK_FAILED` events that include:

- `task_id`
- `task_type`
- `input`
- `result` or `reason`
- `timestamp`

In addition, `lib/apex/apex-client.js` appends every ingested event to `events.jsonl` with an `ingested_at` timestamp.

## Files Changed / Added

- `lib/apex/apex-client.js` — local mapping, idempotency, health
- `lib/apex/apex-capability-guard.js` — `APEX_PROJECT_CREATED`, `APEX_EPISODE_CREATED`, `GET_APEX_PROJECT_STATUS`, `GET_APEX_HEALTH`
- `pao-system/agents/execution/apex.agent.ts` — project lifecycle and episode recording
- `pao-system/core/heidi.controller.ts` — routing and mutation detection for `APEX_*` tasks
- `tools/apex-archive-bridge.js` — validation, `project_created` mapping, `.failed/` retention
- `tests/unit/apex-phase3-lifecycle.test.js` — 8 lifecycle tests including restart and idempotency
- `docs/APEX_PHASE3_PROJECT_LIFECYCLE.md` (this file)
- `docs/APEX_PHASE3_READINESS_REPORT.md`

## Health Surface

`GET_APEX_HEALTH` returns:

```json
{
  "ok": true,
  "mappings": 1,
  "events_recorded": 5,
  "processed_ids": 0,
  "data_dir": "/path/to/data/apex"
}
```
