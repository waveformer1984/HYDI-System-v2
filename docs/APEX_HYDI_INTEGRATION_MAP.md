# Apex Archive → HYDI Integration Map

Date: 2026-08-14  
Scope: one-way, local, no cloud.

## 1. Event flow

```
Apex Archive
    ↓ emits
hydi_outbox/*.json
    ↓ ingested by (manual / scheduled)
tools/apex-archive-bridge.js
    ↓ calls
HeidiController.processUserEvent('APEX_*', input, 'owner')
    ↓ routes
ApexAgent
    ↓ records
lib/apex/apex-client.js
    ↓ writes
data/apex/project-map.json
data/apex/events.jsonl
```

## 2. Task types

| Apex event_type | Heidi task type | Capability state |
|---|---|---|
| `episode_generated` | `APEX_EPISODE_CREATED` | VERIFIED |
| `episode_verified` | `APEX_EVENT_RECORDED` | VERIFIED |
| `approval_event` | `APEX_EPISODE_APPROVED` | VERIFIED |
| `publication_event` | `APEX_EPISODE_PUBLISHED` | VERIFIED |
| `analytics_event` | `APEX_EPISODE_ARCHIVED` | VERIFIED |
| `project_status` | `APEX_EVENT_RECORDED` | VERIFIED |
| `orchestration_ping` | `APEX_EVENT_RECORDED` | VERIFIED |
| `failure_event` | `APEX_EPISODE_FAILED` | VERIFIED |
| (not emitted by bridge) | `APEX_UPLOAD` | SCAFFOLD |
| (not emitted by bridge) | `APEX_PUBLISH` | FORBIDDEN |

## 3. Project identity mapping

| ID | Meaning | Authority |
|---|---|---|
| `apex_venture_id` | Apex Archive project identity (`apex-archive`) | Apex Archive |
| `rezonate_project_id` | HYDI's canonical local project identity | HYDI/Rezonate persistence |

Mapping is stored in `data/apex/project-map.json`. It is created on first ingestion.

## 4. Authorization

- APEX tasks require `apex:manage` permission (owner/operator).
- `viewer` and `agent` are denied before any persistence is touched.
- `APEX_UPLOAD` and `APEX_PUBLISH` are rejected by the capability gate.

## 5. Local-first constraints

- No Supabase.
- No cloud database.
- The bridge runs as a CLI, not a network daemon.
- The HTTP POST in `hydi_bridge.py` is optional and is not used by the default bridge.
