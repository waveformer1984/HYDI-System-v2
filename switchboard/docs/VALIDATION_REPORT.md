# Switchboard Validation Report

## Validation Approach

All tests run deterministically against `MemoryStore` with no external services. The only filesystem access in tests is temporary directories for `JsonStore` persistence and backup/recovery tests.

## Test Matrix

| Suite | Cases | Purpose |
|-------|-------|---------|
| `tests/api.test.js` | 3 | Health, CRUD, domain event emission |
| `tests/persistence.test.js` | 3 | Schema migration, atomic writes, CRUD neutrality |
| `tests/scoring.test.js` | 3 | Deterministic scoring factors and ranking |
| `tests/trust.test.js` | 3 | Contract lifecycle, parent approval, rating guardrails |
| `tests/hardening.test.js` | 5 | Config, validation, request IDs, diagnostics, corruption recovery, events |

## Results

```text
18/18 passing
0 failing
0 skipped
```

Run:

```bash
cd C:\Users\Owner\HYDI-System-v2\switchboard
npm test
```

## Validation Cases

### User validation

- Invalid email rejected
- Short password rejected
- Invalid role rejected
- Valid user accepted

### Persistence

- Legacy `db.json` without `schemaVersion` migrated to v1
- Atomic write + backup produces a readable file
- `MemoryStore` passes CRUD without filesystem

### Scoring

- High match (>0.7) for aligned skills/location/availability
- Zero availability when no overlap
- Applications ranked by score

### Trust

- Accept application → contract + gig filled
- Parent approval clears `pending_approval` applications
- Rating rejected before contract completion

### Production hardening

- Config env overrides work
- Request ID returned in `X-Request-Id`
- `/diagnostics` returns structured report
- Corruption detected and restored from backup
- Observed events are in `docs/domain-events.md`

## Backward Compatibility

All existing API paths remain unchanged. Response shapes are additive or unchanged. `createApp(repository, config, logger)` is backward compatible with `createApp(repository)`.

## Determinism

- No external API calls
- No date dependencies in scoring
- UUIDs are the only non-deterministic values and are logged for traceability
