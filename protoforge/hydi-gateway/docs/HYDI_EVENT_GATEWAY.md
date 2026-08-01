# HYDI Event Gateway

## Purpose

The HYDI Event Gateway is the first shared ProtoForge infrastructure service. It receives domain events from ProtoForge applications and stores them in the RAW EVENT LEDGER without controlling application behavior.

Applications decide what to do. HYDI observes, coordinates, and reasons.

## Architecture

```text
Applications
     |
     v
HYDI Event Gateway
     |
     v
RAW EVENT LEDGER  (data/events.json)
     |
     v
Future:
CASCADE
KILO
ProtoForge Intelligence
```

## Event envelope

```json
{
  "eventId": "uuid",
  "eventType": "audio.asset.created",
  "source": "resonate",
  "version": "1",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "payload": {}
}
```

Validation rules:

- `eventId` required, string
- `eventType` required, string
- `source` required, string
- `payload` required, object
- `version` optional, string
- `timestamp` optional, ISO 8601 string

The gateway adds `receivedAt` on storage.

## Authentication

All write and read endpoints require:

```text
Authorization: Bearer <HYDI_SERVICE_KEY>
```

`GET /health` is public.

## Environment

```env
HYDI_SERVICE_KEY=long-random-secret
PORT=4000
DATA_DIR=./data
LEDGER_FILE=events.json
```

## Endpoints

### `GET /health`

Public. Returns basic gateway status and event count.

```json
{ "ok": true, "status": "ok", "events": 0 }
```

### `POST /events`

Ingest an event. Returns 201 with the stored record.

### `GET /events`

Query the ledger.

Query parameters:

- `eventType` — filter by event type
- `source` — filter by source application
- `since` — lower bound timestamp
- `until` — upper bound timestamp
- `offset` — pagination offset
- `limit` — max events (default 100, max 1000)

### `GET /events/:id`

Retrieve a single event by `eventId`.

## Storage

The RAW EVENT LEDGER is a single JSON file (`data/events.json`) that is appended to atomically. Writes use a temporary file and `fs.rename` to avoid corruption. This is a starting point; a real deployment can replace it with a database-backed store without changing the API.

## Supported event types

The gateway is schema-agnostic by design. These are the first expected events:

- `audio.asset.created`
- `processing.completed`
- `ownership.created`
- `rights.registered`
- `contract.created`
- `payment.completed`

## Replay

`GET /events?offset=0&limit=100` returns events in append order. Future consumers can replay from the beginning by iterating `offset`.

## Future expansion

- Replace file ledger with immutable database
- Add `CASCADE` classification endpoint
- Add `KILO` hypothesis generation consumption
- Add SSE stream for real-time subscribers
- Add event deduplication by `eventId`
