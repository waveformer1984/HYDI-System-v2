# Switchboard Diagnostics

## Endpoint

```
GET /diagnostics
```

## Response Fields

| Field | Type | Meaning |
|-------|------|---------|
| `version` | string | Application version |
| `schemaVersion` | number | Current data schema version |
| `uptimeSeconds` | number | Process uptime in seconds |
| `storage.adapter` | string | `JsonStore` or `MemoryStore` |
| `storage.dbPath` | string | Active database file path |
| `storage.exists` | boolean | Whether the database file exists |
| `storage.healthy` | boolean | `schemaVersion === 1` |
| `backup.directory` | string | Backup directory path |
| `backup.count` | number | Number of `.bak` files |
| `backup.latest` | string | Path to most recent backup |
| `events.transport` | string[] | Active event transport names |
| `events.count` | number | In-memory event count |
| `counts.*` | number | Row counts per table |
| `pending.contracts` | number | Draft or signed contracts |
| `pending.payments` | number | Pending payments |
| `pending.moderation` | number | Quarantined messages + applications |
| `lastAtomicWrite` | string | ISO timestamp of last successful atomic write |

## Example Response

```json
{
  "version": "0.1.0",
  "schemaVersion": 1,
  "uptimeSeconds": 120,
  "storage": {
    "adapter": "JsonStore",
    "dbPath": ".../switchboard/data/db.json",
    "exists": true,
    "healthy": true
  },
  "backup": {
    "directory": ".../switchboard/data/backups",
    "count": 3,
    "latest": ".../db.json.2026-07-31T18-36-42-000Z.bak"
  },
  "events": {
    "transport": ["MemoryTransport", "FileTransport"],
    "count": 12
  },
  "counts": {
    "users": 5,
    "gigs": 2,
    "contracts": 1
  },
  "pending": {
    "contracts": 1,
    "payments": 0,
    "moderation": 0
  },
  "lastAtomicWrite": "2026-07-31T18:36:42.000Z"
}
```

## Frontend

Open `public/index.html` and use the Trust, Parent Approval, or Diagnostics UI. The `/diagnostics` page can be served as a standalone `public/diagnostics.html` if needed.

## Logs

Structured JSON logs are written to `stdout` with `level`, `component`, `event`, `message`, and `requestId`. Set `SWITCHBOARD_LOG_LEVEL=debug` for verbose output.
