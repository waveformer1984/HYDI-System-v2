# Switchboard Reference Architecture

This document captures Switchboard as the first ProtoForge reference application. The patterns below are reusable for new ProtoForge apps.

## 1. Layered Flow

```text
Frontend (public/)
        ↓
    API (src/api.js)
        ↓
    Repository (src/repository.js)
        ↓
    Store (src/persistence/*)
        ↓
    Persistence (JSON file / memory)
```

Cross-cutting concerns (validation, errors, logging, events, config) are defined in `src/` and composed in `src/index.js` and `src/api.js`.

## 2. Persistence Patterns

### Store Interface

All storage is behind a `Store` contract:

```text
init()
create(table, record)
getById(table, id)
getAll(table)
update(table, id, record)
delete(table, id)
load()
```

Implementations:

- `JsonStore` — production file storage
- `MemoryStore` — tests and embedded use

### Schema Versioning

- A `SCHEMA_VERSION` constant tracks the latest schema.
- `JsonStore` runs migration functions when loading older files.
- `MemoryStore` inits at the current version.

### Atomic Writes

`JsonStore` writes to a temp file, flushes, then renames. This prevents torn writes. A backup copy is rotated.

### Backup Rotation

- `data/db.json` is the primary file.
- `data/backups/` keeps `db.1.json`, `db.2.json`, `db.3.json`.
- Corruption detection falls back to the newest backup.

## 3. Domain Architecture

### Repository Pattern

`src/repository.js` is the only file that speaks to `Store`. It owns:

- validation
- auditing
- event emission
- business rules

### Validation Layer

`src/validation.js` contains deterministic, synchronous validation helpers. Repository methods call them before persistence.

### Error Handling

`src/errors.js` defines `ValidationError`, `NotFoundError`, `ConflictError`. `src/middleware.js` centralizes HTTP error responses and request IDs.

### Configuration

`src/config.js` loads env vars with typed helpers. Defaults are defined inline; env overrides are explicit.

## 4. Event System

### Domain Event Contracts

Every state change emits exactly one domain event. Events are documented in `docs/domain-events.md`.

```json
{
  "id": "...",
  "type": "gig.created",
  "payload": { ... },
  "meta": { ... },
  "createdAt": "..."
}
```

### EventBus

`src/events/event-bus.js` provides `emit`, `on`, `off`. It broadcasts events to all registered transports.

### Transports

- `MemoryTransport` — in-memory capture for tests and debugging
- `FileTransport` — persistent JSON event log
- `HydiAdapter` — optional external bridge

### External Adapter Pattern

Adapters sit at the edge. They translate domain events to external envelopes and never throw. Failures are logged and queued. The domain remains unaware of the adapter.

## 5. API Layer

- `src/api.js` builds the Express app.
- `src/middleware.js` adds request IDs, rate limiting, and error handling.
- Validation errors return 400 with structured messages.
- Uncaught errors return 500 and are logged.

## 6. Frontend Conventions

- `public/styles.css` is the shared mobile-first stylesheet.
- `public/ui.js` is the shared helper set.
- Pages use semantic HTML, `<label>`, and ARIA live regions.
- No external UI framework.

## 7. Operations

### Diagnostics

`GET /diagnostics` returns structured health data.

### Logging

`src/logger.js` emits JSON log lines with `timestamp`, `level`, `component`, `event`, `message`.

### Request IDs

`X-Request-Id` header is generated per request and returned in responses.

### Rate Limiting

Per-route limits are configured in `src/config.js` and applied by `src/middleware.js`.

## 8. Testing Strategy

- `node --test` runs all `tests/**/*.test.js` files.
- `MemoryStore` is used for isolation.
- Tests cover repository, API, events, persistence, scoring, hardening, and transport adapters.
- 38/38 tests pass.

## 9. Documentation Patterns

Each major feature has its own doc:

- `docs/<FEATURE>.md` for design and usage
- `docs/weekly-report.md` for status
- `README.md` for getting started
- `docs/RC1_AUDIT.md` for release checkpoints
- `docs/V1_RELEASE_AUDIT.md` for final release verification

## 10. Reusable Checklist

New ProtoForge apps can reuse this structure:

```text
src/
  api.js
  config.js
  errors.js
  logger.js
  middleware.js
  repository.js
  validation.js
  persistence/
    store.js
    json-store.js
    memory-store.js
  events/
    event-bus.js
    memory-transport.js
    file-transport.js
    <external>-adapter.js
public/
  styles.css
  ui.js
  index.html
docs/
  README.md
  weekly-report.md
  <feature>.md
tests/
  *.test.js
```

Domain logic is placed in `src/repository.js` and remains not reusable. The layer contracts and conventions are reusable.
