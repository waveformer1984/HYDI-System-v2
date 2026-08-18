# Apex Archive Capability Audit

Date: 2026-08-14  
Source examined: `C:\Users\Owner\OneDrive\Documents\Claude\Scheduled\apex-archive-weekly-episode\SKILL.md`  
Evidence of actual files on disk: only `SKILL.md` (87 KB) exists in the scheduled-task folder. The ten `.py` files described in the skill have **not** been written to disk.

## 1. Application / module boundaries

Apex Archive is a weekly, human-in-the-loop video-generation pipeline for a faceless motorsport-history YouTube channel. It is described as a **Python codebase** of ten modules, but the actual runtime artifact at the inspected path is a single `SKILL.md` file that contains the intended source code in Markdown code blocks. The skill instructs the agent to write those files each run and to treat `episode_registry.json` and `hydi_outbox/` as persistent data.

Modules (from `SKILL.md`):

| Module | Responsibility | On disk? |
|---|---|---|
| `standalone_pipeline.py` | Weekly scheduled orchestration: topic selection, research, TTS, render, QA, package assembly | No |
| `qa_check.py` | Technical/media quality gates | No |
| `manifest.py` | 12-state lifecycle, manifest creation, state advance, human-only transitions | No |
| `approve.py` | CLI for J (or Claude under explicit instruction) to set `APPROVED`, `READY_TO_UPLOAD`, `PUBLISHED` | No |
| `hydi_bridge.py` | One-way event emitter to local `hydi_outbox/` and optional HTTP bridge | No |
| `episode_registry.py` | Append-only cross-run ledger of episode records | No |
| `analytics.py` | Analytics record ingestion (real or `NOT_CONNECTED`) and `ANALYZED` transition | No |
| `editorial.py` | Advisory topic scoring; currently `INSUFFICIENT_DATA` for everything | No |
| `youtube_adapter.py` | Upload readiness + payload assembly; `upload()` raises `NotImplementedError` | No |
| `verify_package.py` | Independent release gate before HUMAN_REVIEW | No |

## 2. Canonical API / service boundary

There is no operational canonical API at the inspected path. `SKILL.md` describes:

- `manifest.py` as the canonical state-machine authority.
- `youtube_adapter.py` as the canonical YouTube publishing interface.
- `hydi_bridge.py` as the canonical one-way HYDI event emitter.
- `episode_registry.py` as the canonical ledger.

All are currently **text inside a skill prompt**, not runnable code.

## 3. Persistence mechanism

The skill describes:

- `episode_registry.json` — append-only JSON file in the same directory.
- `hydi_outbox/*.json` — one-way event files (8 event types).
- Per-episode `manifest.json` and package files under an `episode/` directory.

None of these files were found in the inspected folder.

## 4. Existing task / command interfaces

Interfaces described in `SKILL.md`:

- `python3 standalone_pipeline.py` — weekly scheduled run.
- `python3 approve.py episode/manifest.json approve --by "J"` — human approval.
- `python3 approve.py episode/manifest.json ready --by "J"` — mark `READY_TO_UPLOAD`.
- `python3 approve.py episode/manifest.json published --by "J" --url <url>` — mark `PUBLISHED`.
- `python3 verify_package.py episode/manifest.json` — independent verification gate.
- `python3 -c "import youtube_adapter; youtube_adapter.upload(...)"` — manual upload (blocked by credentials + policy gates).

None are runnable because the source files do not exist.

## 5. Existing authentication / authorization

- **YouTube**: two environment gates (`APEX_YOUTUBE_CREDENTIALS_PATH`, `APEX_YOUTUBE_PUBLISHING_POLICY=enabled`). The code does not implement OAuth itself; it requires J-supplied credentials. `upload()` is not invoked automatically.
- **HYDI bridge**: optional `HYDI_BRIDGE_URL` for POSTing events; one-way and non-authoritative. `SKILL.md` explicitly forbids giving HYDI/Heidi any state-mutation path.
- **Approval**: human-only CLI in `approve.py`; `manifest.py` enforces that the scheduled `task` actor cannot advance past `HUMAN_REVIEW`.

## 6. Existing health endpoint

No health endpoint is described. `hydi_bridge.py` `project_status()` emits a status event but does not expose an HTTP health endpoint itself. The `youtube_adapter.py` `check_upload_readiness()` is a structural package check, not a service health check.

## 7. Existing event / audit mechanisms

- `manifest.py` writes immutable audit events for every state transition (`episode_id`, `previous_state`, `new_state`, `timestamp`, `actor`, `reason`, `manifest_hash`) into `manifest.json`.
- `hydi_bridge.py` emits 8 one-way event types to `hydi_outbox/`: `project_status`, `orchestration_ping`, `episode_generated`, `episode_verified`, `approval_event`, `publication_event`, `analytics_event`, `failure_event`.
- `episode_registry.py` records the cross-run history of all episodes.

## 8. Capability classification

Based on the evidence (code in `SKILL.md` only, no files on disk):

| Capability | State | Evidence |
|---|---|---|
| Weekly episode generation (research, TTS, render, QA, package) | **PLANNED** | Code is in the skill prompt but no files on disk; not runnable. |
| Quality assurance (`qa_check.py`) | **PLANNED** | Code in skill; no files. |
| 12-state manifest lifecycle | **SCAFFOLD** | State machine is fully specified in `manifest.py` block, but no runnable module. |
| Human approval CLI (`approve.py`) | **PLANNED** | Code in skill; no files. |
| Independent package verification (`verify_package.py`) | **PLANNED** | Code in skill; no files. |
| Episode registry (`episode_registry.py`) | **SCAFFOLD** | Data schema and load/save helpers specified; no `episode_registry.json` found. |
| HYDI one-way bridge (`hydi_bridge.py`) | **FUNCTIONAL** (in specification) | Event types and `_write_local`/`_post` are described; no file on disk. |
| Analytics records (`analytics.py`) | **FUNCTIONAL** | `ingest_analytics()` and `not_connected_record()` logic is specified; no file on disk. |
| Editorial scoring (`editorial.py`) | **SCAFFOLD** | `score_topics()` returns `INSUFFICIENT_DATA` by design. |
| YouTube readiness check (`youtube_adapter.py::check_upload_readiness`) | **FUNCTIONAL** (in specification) | Structural checks described. |
| YouTube payload assembly (`youtube_adapter.py::build_upload_request`) | **FUNCTIONAL** (in specification) | Payload assembly described. |
| YouTube real upload (`youtube_adapter.py::upload`) | **PLANNED** | `upload()` raises `NotImplementedError` and will require real credentials and policy. |

No capability is **VERIFIED** or **PRODUCTION** because the modules are not physically present and no tests have been run.

## 9. Local vs. cloud dependencies

Dependencies described in `SKILL.md`:

- `Pillow`, `ffmpeg`, `requests` — local tools.
- `piper-tts` / `espeak` — local TTS (optional).
- `google-api-python-client`, `google-auth-oauthlib` — cloud YouTube Data API (only when `upload()` is wired and credentials provided).
- Optional `HYDI_BRIDGE_URL` — could be local or remote HTTP endpoint (one-way POST).

The pipeline is designed to be **local-first** except for the optional YouTube upload.

## 10. Is Apex actually runnable locally?

**No.** At the inspected path, only `SKILL.md` exists. The ten Python modules and the data files (`episode_registry.json`, `hydi_outbox/`) are absent. Running `python3 standalone_pipeline.py` or any other module would fail with `ModuleNotFoundError`.

The `SKILL.md` contains a complete, ready-to-write source specification, but the archive is not yet a deployed/runnable application.

## 11. Implications for Heidi integration

- **Heidi cannot yet route to Apex as a second domain** because there are no runnable Apex modules or canonical persistence to call.
- The most natural first integration is **read-only observation** of `hydi_outbox/*.json` and `episode_registry.json`, because that is already one-way and non-mutating.
- The only state-mutating operation that should ever be wired through Heidi is `human_mark_published`/`upload()`, and only with explicit human authorization and J-supplied credentials. `approve` and `ready` must remain human-only CLI operations.
- **No cloud Supabase dependency** is required for the read-only observation slice.

## 12. Blockers for the two concrete tasks

### Task 1: Real YouTube `upload()`
- Blocker: `youtube_adapter.py` does not exist on disk.
- Blocker: `google-api-python-client` / `google-auth-oauthlib` not verified installed.
- Blocker: J has not yet generated `APEX_YOUTUBE_CREDENTIALS_PATH`.
- Non-blocker: the policy gate (`APEX_YOUTUBE_PUBLISHING_POLICY=enabled`) and default `privacyStatus=private` are specified and can be enforced.

### Task 2: Real HYDI ingestion
- Blocker: `hydi_outbox/` and `episode_registry.json` do not exist on disk.
- Blocker: `protoforge.db` (local SQLite) contains no project/venture tracking table.
- Blocker: `HYDI-System-v2` has no local, cloud-free project registry in the inspected tree.

Because no project-tracking mechanism exists, adding one would require new tables or files, which the prompt explicitly says to ask about before creating.
