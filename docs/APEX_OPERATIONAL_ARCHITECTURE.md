# Apex Archive Operational Architecture

Date: 2026-08-14  
Location: `C:\Users\Owner\OneDrive\Documents\Claude\Scheduled\apex-archive-weekly-episode\`  
Scope: local-first, no cloud dependency, human approval for publishing.

## 1. Boundaries

Apex Archive owns:
- episode lifecycle and state machine (`manifest.py`)
- episode registry (`episode_registry.json`)
- one-way event outbox (`hydi_outbox/`)
- package validation and QA
- YouTube upload scaffolding (`youtube_adapter.py`)

HYDI/Heidi owns:
- observation and recording of Apex events
- project/venture identity mapping
- local persistence of ingested events (`data/apex/`)

Neither system manipulates the other's internal state files.

## 2. State machine

```
RESEARCH -> FACT_CHECKED -> SCRIPTED -> GENERATED -> QA_PASSED -> RENDERED
    -> VERIFIED -> HUMAN_REVIEW -> APPROVED -> READY_TO_UPLOAD -> PUBLISHED -> ANALYZED
```

- Automated progression stops at `HUMAN_REVIEW`.
- `APPROVED` and beyond are human-only via `approve.py`.
- `ANALYZED` requires real analytics data via `analytics.py`.

## 3. Local persistence

| File | Purpose | Safety |
|---|---|---|
| `episode_registry.json` | cross-run episode ledger | atomic tmp + `os.replace` + `fsync` |
| `hydi_outbox/*.json` | one-way HYDI event files | atomic tmp + `os.replace` + `fsync` |
| `episode/manifest.json` | per-episode package manifest | `manifest.py` validates each transition |

## 4. Modules

| File | Status | Notes |
|---|---|---|
| `manifest.py` | implemented | 12-state state machine with validation and audit |
| `episode_registry.py` | implemented | atomic writes, duplicate detection |
| `hydi_bridge.py` | implemented | one-way outbox, optional HTTP POST, event IDs |
| `youtube_adapter.py` | SCAFFOLD | `upload()` raises `NotImplementedError` until real credentials/test exist |
| `approve.py` | implemented | human-only CLI |
| `analytics.py` | implemented | real or `NOT_CONNECTED` records, no fabrication |
| `editorial.py` | implemented | `INSUFFICIENT_DATA` by design |
| `qa_check.py` | implemented | technical + media QA |
| `verify_package.py` | implemented | independent release gate |
| `standalone_pipeline.py` | implemented | weekly scheduled orchestration |

## 5. Security

- No credentials in source code.
- No credentials in `episode_registry.json` or `hydi_outbox/`.
- No automatic YouTube publishing.
- No inbound control from HYDI to Apex.
- `.gitignore` excludes runtime data.
