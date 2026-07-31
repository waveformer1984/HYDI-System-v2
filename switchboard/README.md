# Switchboard

A local-first, offline-first gig-matching MVP for performers and venues. Built to be extracted into a standalone project later while operating inside `HYDI-System-v2/switchboard` for now.

## Features

- Performer and venue profiles
- Gig discovery and search
- Deterministic match scoring (no AI)
- Applications, contracts, payments, ratings
- Parent approval workflow for protected accounts
- Moderation console for flagged content and users
- Availability calendar with weekly schedule and exceptions
- Offline-first JSON storage with atomic writes
- Synchronization via `/sync/export` and `/sync/import`
- Structured logging and diagnostics
- Optional HYDI integration via `HydiAdapter`

## Quick Start

```bash
cd C:\Users\Owner\HYDI-System-v2\switchboard
npm install
npm test
npm start
```

Then open `http://localhost:3001`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | API port |
| `SWITCHBOARD_DATA_DIR` | `data` | Data directory |
| `SWITCHBOARD_DB_PATH` | `data/db.json` | Database file |
| `SWITCHBOARD_BACKUP_DIR` | `data/backups` | Backup directory |
| `SWITCHBOARD_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `SWITCHBOARD_STORE` | `json` | `json` or `memory` |
| `SWITCHBOARD_ENABLE_HYDI` | `false` | Enable optional HYDI adapter |
| `SWITCHBOARD_HYDI_ENDPOINT` | — | HYDI event endpoint |

## Architecture

```text
Store (JsonStore / MemoryStore)
    ↑
Repository (domain logic + events)
    ↑
EventBus (MemoryTransport / FileTransport / HydiAdapter)
    ↑
API (Express with validation, rate limiting, request IDs)
    ↑
Frontend (vanilla HTML/JS)
```

## Domain Events

See `docs/domain-events.md`.

## Diagnostics

```text
GET /diagnostics
```

Returns storage health, backup status, event counts, and pending items.

## Documentation

- `BUILD_PROMPT.md` — original MVP spec
- `docs/domain-events.md` — event catalog
- `docs/PRODUCTION_READINESS_REPORT.md` — readiness checklist
- `docs/VALIDATION_REPORT.md` — test results
- `docs/DIAGNOSTICS.md` — diagnostics reference
- `docs/MODERATION_CONSOLE.md` — moderation console
- `docs/AVAILABILITY_CALENDAR.md` — availability calendar
- `docs/weekly-report.md` — engineering status

## Testing

```bash
npm test
```

31/31 tests passing.
