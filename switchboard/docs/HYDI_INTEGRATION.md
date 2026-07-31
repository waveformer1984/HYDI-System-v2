# Switchboard HYDI Integration

## Overview

Switchboard is an independently functioning ProtoForge capability. HYDI can orchestrate it, but Switchboard never depends on HYDI to operate.

The integration is a one-way bridge: Switchboard domain events are translated into HYDI capability events and forwarded to a HYDI ingestion endpoint.

## Architecture

```text
Switchboard
    │
    ▼
EventBus
    │
    ▼
HydiAdapter
    │
    ▼
HYDI /events
```

`HydiAdapter` implements the `EventBus` transport contract (`handle(event)`). It also exposes `publish`, `health`, and `flush` for explicit control.

## Activation

Default: disabled.

```bash
# Memory only
EVENT_TRANSPORT=memory

# Forward to HYDI
EVENT_TRANSPORT=hydi
HYDI_ENDPOINT=http://localhost:7001
HYDI_CAPABILITY=switchboard.marketplace
HYDI_VERSION=1.0
```

Legacy `SWITCHBOARD_ENABLE_HYDI=true` and `SWITCHBOARD_HYDI_ENDPOINT` are still supported.

## Event Envelope

Switchboard event:

```json
{
  "id": "...",
  "type": "gig.created",
  "payload": { "id": "gig_1" },
  "meta": {},
  "createdAt": "2026-08-01T00:00:00.000Z"
}
```

HYDI envelope:

```json
{
  "system": "switchboard",
  "capability": "switchboard.marketplace",
  "event": "gig.created",
  "schemaVersion": "1.0",
  "id": "...",
  "createdAt": "2026-08-01T00:00:00.000Z",
  "data": {
    "id": "gig_1",
    "_meta": {}
  }
}
```

## Capability Contract

```json
{
  "capability": "switchboard.marketplace",
  "version": "1.0",
  "events": [
    "gig.created",
    "application.submitted",
    "contract.completed",
    "payment.completed",
    "rating.created",
    "moderation.reviewed",
    "availability.updated"
  ],
  "endpoints": {
    "events": "POST /events",
    "health": "GET /health"
  }
}
```

All Switchboard events can be forwarded. The list above is the recommended starter set for marketplace orchestration.

## Offline & Failure Behavior

- If `HYDI_ENDPOINT` is not set, no adapter is created.
- If `EVENT_TRANSPORT=memory`, no adapter is created.
- If HYDI is unreachable, the event is queued locally.
- The application continues to operate normally.
- Use `adapter.health()` to check reachability.
- Use `adapter.flush()` to retry queued events.
- No user-facing workflows are blocked by HYDI failures.

## API Reference

### `new HydiAdapter(options)`

- `options.endpoint` — HYDI base URL
- `options.capability` — capability name (`switchboard.marketplace`)
- `options.version` — schema version
- `options.enabled` — can force disable
- `options.logger` — logger instance

### `publish(event)`

Translates and POSTs a Switchboard event to `$HYDI_ENDPOINT/events`.
Returns `{ ok, error? }`.

### `handle(event)`

EventBus-compatible method. Calls `publish` and swallows errors.

### `health()`

GETs `$HYDI_ENDPOINT/health`. Returns `{ ok, status, outbox, error? }`.

### `flush()`

Retries all queued events. Returns `{ sent, failed }`.

### `subscribe(handler)`

Reserved for future inbound HYDI-to-Switchboard messaging.

## Domain Safety

- No Switchboard business logic imports `HydiAdapter`.
- The adapter is only wired in `createRepository` based on configuration.
- The adapter never throws from `handle`.
