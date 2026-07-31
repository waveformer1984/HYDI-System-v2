# Switchboard v1.0.0-rc1 Audit

## Checkpoint

| Item | Value |
|------|-------|
| Branch | `switchboard-rc1` |
| Commit | `switchboard-v1.0.0-rc1` (resolve with `git rev-parse switchboard-v1.0.0-rc1`) |
| Tag | `switchboard-v1.0.0-rc1` |
| Test Result | 18/18 passing |
| Duration | ~2.3s |
| Schema Version | 1 |
| Status | **Release Candidate** |

## Architecture Review

### Store Abstraction

- `src/persistence/store.js` defines the `Store` interface.
- `src/persistence/json-store.js` implements atomic, versioned, backed-up JSON persistence.
- `src/persistence/memory-store.js` implements the same interface for tests.
- Business logic depends only on the interface.

### Repository Layer

- `src/repository.js` is the only code path that writes to `store`.
- Every state-changing method emits exactly one documented domain event.
- All events are in `docs/domain-events.md`.
- `Repository` uses `src/validation.js` before persistence.

### EventBus

- `src/events/event-bus.js` provides `MemoryTransport` (default), `FileTransport`, and `HydiAdapter`.
- `HydiAdapter` is disabled by default; no HYDI code in the core.
- Transports are read-only from the domain perspective.

### API Layer

- `src/api.js` uses `createApp(repository, config, logger)`.
- `requestIdMiddleware`, `createRateLimiter`, and `errorHandler` are in `src/middleware.js`.
- No breaking changes to Phase 1 endpoints; shapes are additive or unchanged.

### Frontend

- Vanilla HTML/JS in `public/`.
- Login, Dashboard, Gigs, Applications, Trust, Parent Approval, Messages, Diagnostics screens.
- `window.SWITCHBOARD_API` override supported.

## Security Review

### Sensitive Data

- `password_hash` is stripped from all API exports (`repository.rowUser`).
- `repository.export()` filters internal metadata and secrets.
- No secrets committed to the repository (`switchboard/.gitignore` excludes `data/` and `node_modules/`).

### Validation

- All creation endpoints validate before persistence.
- `ValidationError` with `field` and `message` returned to clients.
- Invalid emails, short passwords, bad enums, and out-of-range numbers are rejected.

### Error Sanitization

- `errorHandler` does not expose stack traces.
- Unexpected errors return `Internal server error` with `requestId`.
- Internal details are logged.

### Rate Limiting

- Configurable per-route limits for login, messages, applications, parent approvals, payments.
- Defaults are conservative (see `src/config.js`).

## Operations Review

### Persistence

- `JsonStore` writes to `.tmp`, calls `fsync` best-effort, then `rename`.
- Five most recent backups are retained.
- Corruption detection restores from latest backup and preserves the damaged file.
- `tests/persistence.test.js` and `tests/hardening.test.js` verify this.

### Logging

- Structured JSON logs to `stdout`.
- Every log entry: `timestamp`, `level`, `component`, `event`, `message`, `requestId`.
- Log level controlled by `SWITCHBOARD_LOG_LEVEL`.

### Diagnostics

- `GET /diagnostics` returns health, counts, pending items, backup status, uptime.
- `public/diagnostics.html` renders the report.

### Configuration

- `src/config.js` loads from environment or defaults.
- No hardcoded paths in business logic.

## Test Results

```text
▶ api
  ✔ responds to /health
  ✔ creates a user and gig
  ✔ emits domain events for state changes

▶ production hardening
  ✔ configuration loads defaults and env overrides
  ✔ validation rejects invalid user
  ✔ request ID is included in response header
  ✔ diagnostics endpoint returns structured report
  ✔ JsonStore detects corruption and restores from backup
  ✔ event names match documented domain events

▶ persistence
  ✔ JsonStore migrates legacy schema to current version
  ✔ JsonStore writes atomically and preserves state
  ✔ MemoryStore is database-neutral and supports CRUD

▶ scoring engine
  ✔ ranks a user high when all factors align
  ✔ gives zero availability when no overlap
  ✔ ranks applications by score

▶ trust layer
  ✔ accepts an application and creates a contract
  ✔ approves a protected user and clears pending applications
  ✔ rejects rating before contract completion

ℹ tests 18
ℹ suites 5
ℹ pass 18
ℹ fail 0
```

## Product Gaps

The following are known and intentional post-RC work:

1. **Moderation Console** — quarantine queue, release, audit timeline, moderator actions
2. **Availability Calendar UI** — weekly schedule, blackout dates, timezone display
3. **Mobile UI polish** — responsive layout, loading states
4. **HYDI Adapter activation** — wire `HydiAdapter` when HYDI ingestion contract is stable

## Go / No-Go

| Criterion | Status |
|-----------|--------|
| Architecture stable | Go |
| Tests passing | Go |
| No secrets in repo | Go |
| No external dependencies | Go |
| Offline-first verified | Go |
| Diagnostics operational | Go |
| Documentation complete | Go |

**Recommendation: Go for RC1. Continue with Moderation Console.**
