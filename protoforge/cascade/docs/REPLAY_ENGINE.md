# Replay Engine

## Purpose

The Replay Engine lets CASCADE (re)process events from the RAW EVENT LEDGER from any starting point. This supports backfills, recovery, and selective reprocessing.

## Endpoints

### `POST /replay`

```json
{
  "from": "beginning",
  "eventType": "audio.asset.created",
  "limit": 100,
  "offset": 0
}
```

Or from a fingerprint:

```json
{
  "from": "{fingerprint}"
}
```

Or from a timestamp:

```json
{
  "fromTimestamp": "2026-08-01T00:00:00.000Z"
}
```

## Response

```json
{
  "ok": true,
  "processed": 10,
  "duplicates": 0,
  "failures": 0,
  "total": 10,
  "durationMs": 12,
  "lastFingerprint": "..."
}
```

## Modes

- **beginning** — process all events from the start.
- **fingerprint** — start from the `created_at` of the referenced event.
- **timestamp** — start from the given ISO timestamp.
- **event type** — filter to a single `event_type`.

## Idempotency

Replaying an already-derived event does not modify the ledger. The `DerivedStore` ignores duplicates and `Metrics` counts them.
