# Switchboard Production Readiness Report

## Executive Summary

Switchboard has been hardened for offline-first, standalone operation. All persistence is abstracted, all business logic emits documented domain events, and the application is portable with no external service dependencies.

## Architecture Compliance

- **Store abstraction** — `Store` interface with `JsonStore` and `MemoryStore`
- **Repository pattern** — all persistence and audit goes through `Repository`
- **EventBus** — `MemoryTransport` (default), `FileTransport` (local replay), optional `HydiAdapter`
- **HYDI independence** — `HydiAdapter` is disabled by default; no HYDI code in core
- **Determinism** — in-memory tests, no external RNG beyond UUIDv4

## Hardening Completed

### API Validation

- `src/validation.js` with reusable validators for strings, numbers, integers, dates, emails, enums
- `validateUser`, `validateGig`, `validateVenue` at repository entry
- Invalid data is rejected before persistence with structured `ValidationError`

### Centralized Error Handling

- `src/errors.js` — `DomainError` hierarchy
- `src/middleware.js` — `errorHandler` middleware
- No stack traces leak to clients
- Structured internal logging

### Configuration

- `src/config.js` — all paths, ports, limits, and feature flags from environment variables or defaults
- No hardcoded paths in business logic
- Supports `PORT`, `SWITCHBOARD_*` variables

### Export / Import Hardening

- `repository.export()` strips `password_hash` and internal metadata
- `repository.import()` validates schema version, payload shape, supports dry-run
- Rollback to previous state on import failure

### Atomic Persistence

- `JsonStore` writes to `.tmp`, calls `fsync`, then `rename`
- Backup rotation (5 most recent)
- Corruption detection with automatic restore from latest backup
- Damaged file preserved as `.corrupt` timestamp
- `persistence.test.js` verifies atomic writes and migration

### Structured Logging

- `src/logger.js` — JSON line logs with `timestamp`, `level`, `component`, `event`, `message`, `requestId`
- Levels: `debug`, `info`, `warn`, `error`
- Log level controlled by `SWITCHBOARD_LOG_LEVEL`

### Request IDs

- `requestIdMiddleware` assigns `X-Request-Id` per request
- Included in logs and responses

### Rate Limiting

- `createRateLimiter` per-route sliding window
- Configurable limits for login, messages, applications, parent approvals, payments
- Defaults are conservative

### Diagnostics

- `GET /diagnostics` returns application version, schema version, storage health, backup status, event counts, pending contracts/payments/moderation, uptime, last atomic write
- `src/diagnostics.js` collects without external calls

### Event Verification

- Every repository state change emits exactly one domain event
- Event names match `docs/domain-events.md`
- `hardening.test.js` verifies `user.created` and no duplicate/undocumented events in observed operations

## Remaining Operational Notes

- `HydiAdapter` is a stub; wire endpoint when HYDI integration is desired
- Frontend is intentionally vanilla; no framework dependencies
- Rate limiting is in-process; multi-instance deployments should add an external store

## Test Coverage

18/18 tests passing:
- `api`
- `persistence`
- `scoring`
- `trust`
- `production hardening`
