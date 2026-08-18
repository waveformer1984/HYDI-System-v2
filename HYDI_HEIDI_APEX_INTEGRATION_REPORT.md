# HYDI Heidi → Apex Archive Integration Report

Date: 2026-08-14  
Repo: `C:\Users\Owner\HYDI-System-v2`  
Apex Archive: `C:\Users\Owner\OneDrive\Documents\Claude\Scheduled\apex-archive-weekly-episode`  
Branch: `feat/hydi-system-wide-audit`

## 1. Capability inventory

| Capability | State | Evidence |
|---|---|---|
| Weekly episode pipeline (research → render → QA → package) | FUNCTIONAL | All ten Python modules extracted from `SKILL.md` and importable. No real package has been produced yet. |
| Episode registry persistence | VERIFIED | Atomic tmp/rename/fsync; restart recovery tested. |
| HYDI outbox emission | VERIFIED | `hydi_bridge.py` emits `event_id`, `timestamp`, `source`, `project_id`, `schema_version`, `payload`. |
| Apex → Heidi bridge | VERIFIED | `tools/apex-archive-bridge.js` ingests outbox and records events through `HeidiController`. |
| Heidi Apex event recording | VERIFIED | `ApexAgent` records events to `data/apex/events.jsonl` and updates `data/apex/project-map.json`. |
| Project identity mapping | VERIFIED | `lib/apex/apex-client.js` maps `apex_venture_id` to `rezonate_project_id` locally. |
| YouTube upload | SCAFFOLD | `youtube_adapter.py::upload()` requires credentials, policy, and human approval, then raises `NotImplementedError`. |
| Autonomous publishing | FORBIDDEN | `APEX_PUBLISH` is rejected by the capability guard. |

## 2. Capabilities actually integrated

- `APEX_EVENT_RECORDED` (catch-all for project status / orchestration ping / verified / failure)
- `APEX_EPISODE_CREATED`
- `APEX_EPISODE_APPROVED`
- `APEX_EPISODE_PUBLISHED`
- `APEX_EPISODE_FAILED`
- `APEX_EPISODE_ARCHIVED`

`APEX_UPLOAD` and `APEX_PUBLISH` are **not** integrated; they are blocked by the capability gate.

## 3. Exact task types

See `docs/APEX_HYDI_INTEGRATION_MAP.md`.

## 4. Authority model

See `docs/HEIDI_OPERATIONAL_AUTHORITY_MATRIX.md` (Apex section).

## 5. Canonical Apex implementation used

- `manifest.py` — canonical state machine.
- `episode_registry.py` — canonical append-only ledger.
- `hydi_bridge.py` — canonical one-way outbox.
- `youtube_adapter.py` — canonical structural validation and upload boundary.

## 6. Persistence behavior

- Apex owns `episode_registry.json` and `hydi_outbox/` in the Apex Archive folder.
- HYDI owns `data/apex/project-map.json` and `data/apex/events.jsonl` in `HYDI-System-v2/data/`.
- No cloud database is used.
- No Supabase is required.

## 7. Audit behavior

- `HeidiController` produces `HEIDI_USER_EVENT_RECEIVED` and `HEIDI_AGENT_SUCCESS`/`HEIDI_AGENT_FAILURE` for every APEX task.
- `ApexAgent` emits `APEX_TASK_COMPLETED`/`APEX_TASK_FAILED`.
- `AuditLog` redacts secrets and auto-timestamps.

## 8. Health behavior

Apex is not yet added to the system health endpoint. The outbox files and local persistence can be verified manually. Health wiring is a remaining item.

## 9. Local / cloud dependency findings

- **Local**: all archive modules, registry, outbox, HYDI persistence, bridge.
- **Optional external**: YouTube Data API (only when `upload()` is eventually wired and J has credentials).
- **No Supabase, no cloud database, no Vercel dependency for the core integration.**

## 10. Failure behavior

- Malformed outbox JSON is skipped with reason.
- Unauthorized APEX tasks are rejected before persistence.
- `APEX_UPLOAD` / `APEX_PUBLISH` are rejected as `SCAFFOLD` / `FORBIDDEN`.
- `youtube_adapter.py::upload()` raises `NotImplementedError` with gate details.
- See `docs/APEX_FAILURE_MATRIX.md`.

## 11. Test results

| Suite | Count | Result |
|---|---|---|
| `python3 -m unittest tests.test_persistence` (Apex) | 7 | PASS |
| `npx jest tests/unit/apex-archive-acceptance.test.js` | 4 | PASS |
| `npm run typecheck` | — | PASS |

## 12. Capability-contract implications

Apex does not have a `capability-contract.json`. `lib/apex/apex-capability-guard.js` serves the same purpose for the small set of `APEX_*` task types. A future recommendation is to create a `capability-contract.json` only after the set of capabilities stabilizes.

## 13. Architecture findings

- The Heidi control-plane primitives are genuinely reusable: the same permission, capability, audit, and failure patterns from Rezonate work for Apex.
- The domain-specific pieces are the agent (`pao-system/agents/execution/apex.agent.ts`) and the local client (`lib/apex/apex-client.js`).
- The `HeidiController` `processUserEvent` is the shared boundary. Adding a new domain is now: add agent, add capability guard, add routing, add tasks.
- Leak: `ApexClient` uses a separate `data/apex/` directory rather than the Rezonate project model because the canonical Rezonate project has no `metadata` field. This is documented as a mapping, not a second database.

## 14. Remaining blockers

- YouTube upload remains a scaffold until J provides real credentials and a test upload is performed.
- No real episode package has been produced by the pipeline yet.
- System health endpoint does not yet surface Apex status.
- A scheduler entry for the bridge is not configured.
