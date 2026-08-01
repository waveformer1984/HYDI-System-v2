# HYDI Event Gateway

## Purpose

The HYDI Event Gateway is the shared ProtoForge infrastructure service that receives domain events from ProtoForge applications and commits them to the canonical RAW EVENT LEDGER.

Applications never write directly to the RAW EVENT LEDGER. They send events to the gateway. The gateway validates, fingerprints, and delegates persistence to the existing HYDI ledger implementation.

```text
Applications
     |
     v
HYDI Event Gateway
     |
     v
Canonical RAW EVENT LEDGER
     |
     v
Future:
CASCADE
KILO
ProtoForge Intelligence
```

## Canonical ledger

There is one and only one RAW EVENT LEDGER. It lives in:

- Implementation: `lib/protoforge/raw-ledger.ts`
- Table: `raw_event_ledger` (see `supabase/migrations/`)
- Columns: `id`, `fingerprint`, `event_type`, `payload`, `hash`, `created_at`

The gateway writes to this table through `src/adapters/raw-ledger.js` using `@supabase/supabase-js`.

The gateway does not maintain a second ledger, a JSON file, or any other shadow store.

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

The gateway adds `receivedAt` and computes a SHA-256 `fingerprint` and `hash`.

## Fingerprint and hashing

The gateway generates a deterministic `fingerprint` from the event:

```text
sha256({ source, eventId, eventType })
```

The canonical ledger `hash` is computed exactly as `lib/protoforge/raw-ledger.ts` computes it:

```text
sha256({ fingerprint, event_type, payload })
```

This guarantees that the gateway and the canonical ledger produce identical hashes for the same event.

## Authentication

All write and read endpoints require:

```text
Authorization: Bearer <HYDI_SERVICE_KEY>
```

`GET /health` is public.

## Environment

```env
HYDI_SERVICE_KEY=long-random-secret
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
PORT=4000
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required because the gateway commits to the canonical `raw_event_ledger` table.

## Endpoints

### `GET /health`

Public. Returns gateway status and ledger connectivity.

```json
{
  "ok": true,
  "status": "ok",
  "connected": true,
  "events": 0
}
```

If the ledger is unreachable, it returns 503 with `ok: false`.

### `POST /events`

Ingest an event. The gateway:

1. Validates the envelope.
2. Generates a fingerprint.
3. Checks the canonical ledger for an existing fingerprint.
4. Inserts the event with `fingerprint`, `event_type`, `payload`, and `hash`.
5. Returns 201 with the stored record, or 409 for duplicate fingerprints.

### `GET /events`

Query the canonical ledger.

Query parameters:

- `eventType` — filter by `event_type`
- `source` — filter by embedded `payload._meta.source`
- `since` — lower bound `created_at`
- `until` — upper bound `created_at`
- `offset` — pagination offset
- `limit` — max events (default 100, max 1000)

### `GET /events/:fingerprint`

Retrieve a single event by its canonical `fingerprint`.

## Replay

`GET /events?offset=0&limit=100` returns events in append order. Future consumers can replay from the beginning by iterating `offset`.

## Supported event types

The gateway is schema-agnostic. Expected first-class events:

- `audio.asset.created`
- `processing.completed`
- `ownership.created`
- `rights.registered`
- `contract.created`
- `payment.completed`

## Future expansion

- SSE stream for real-time subscribers
- CASCADE classification endpoint
- KILO hypothesis consumption
- Event deduplication beyond fingerprint (e.g., content hash)
