# ProtoForge Event Flow

## Overview

ProtoForge applications are independent organisms. They communicate through the HYDI Event Gateway so that the canonical RAW EVENT LEDGER remains the single source of truth.

```text
Resonate
        |
audio.asset.created
        |
Switchboard
        |
payment.completed
        |
HYDI Gateway
        |
RAW EVENT LEDGER
        |
CASCADE (future)
        |
KILO (future)
```

## Responsibilities

### Producer (Resonate, Switchboard)

- Owns the business event
- Emits events through the existing `EventBus`
- Translates internal events into the canonical envelope
- Sends `POST /events` to the HYDI Gateway
- Does not write to the ledger
- Retries locally if the gateway is temporarily unreachable

### HYDI Gateway

- Receives canonical event envelopes
- Authenticates the producer
- Validates the envelope
- Generates a SHA-256 fingerprint
- Computes a matching hash
- Tries to append directly to `raw_event_ledger`
- If the ledger is unreachable, stores the event in the outbox and retries with exponential backoff
- Never duplicates an event because `fingerprint` is unique

### Canonical RAW EVENT LEDGER

- One and only one ledger exists
- Implementation: `lib/protoforge/raw-ledger.ts`
- Table: `raw_event_ledger`
- Append-only, immutable, hashed
- RLS-protected
- No application writes directly to it

## Canonical event envelope

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

## Resonate producer events

- `audio.asset.created`
- `processing.completed`
- `ownership.created`
- `rights.registered`

Configuration:

```env
HYDI_GATEWAY_ENDPOINT=http://localhost:4000
HYDI_SERVICE_KEY=...
```

## Switchboard producer events

- `contract.created`
- `contract.completed`
- `payment.completed`
- `rating.created`
- `moderation.created`
- `moderation.released`
- `moderation.removed`
- `user.restricted`

Configuration:

```env
HYDI_ENDPOINT=http://localhost:4000
HYDI_SERVICE_KEY=...
```

## Retry lifecycle

1. Producer emits a canonical event to `POST /events`.
2. Gateway tries to commit immediately.
3. If it succeeds, the event is in the ledger.
4. If it fails, the event is queued in the outbox.
5. `RetryWorker` polls the outbox on a fixed interval.
6. It attempts to commit each due event.
7. On success, the event is removed from the outbox.
8. On failure, the attempt counter increases and the next attempt is scheduled using exponential backoff.
9. Duplicate fingerprints are rejected by the ledger, preventing double writes.

## Failure behavior

- Producer sees `201 Created` on immediate success.
- Producer sees `202 Accepted` when the event is queued in the gateway outbox.
- Producer sees `409 Conflict` for duplicate fingerprints.
- Producer sees `502 Bad Gateway` only when no outbox is available or the event is malformed.
- The canonical ledger never receives a duplicate.
