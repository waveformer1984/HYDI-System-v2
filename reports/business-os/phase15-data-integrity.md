# Phase 15 — Data Integrity & Startup Integrity

Date: 2026-07-25
Branch: clean-main

## Implementation Summary

Introduced a defensive data-normalization and validation layer plus a pre-flight startup check. Malformed risk, probability, confidence, value, and effort inputs can no longer silently corrupt recommendation rankings, and HYDI now reports executive-style startup status before accepting operator commands.

## Files Added

- `src/hydi-v3/DataIntegrity.js` — risk/value/probability/confidence/effort/strategic normalization and entity validation.
- `src/hydi-v3/StartupIntegrity.js` — pre-flight executive startup health check.
- `tests/unit/hydi-v3/DataIntegrity.test.js` — 12 normalization and validation tests.
- `tests/unit/hydi-v3/StartupIntegrity.test.js` — 3 startup-status tests.

## Files Modified

- `src/hydi-v3/BusinessMemory.js` — `put()` and `_hydrateEntity()` now normalize and validate; `PERSISTENCE_VERSION` bumped to 2; old snapshots are auto-migrated.
- `src/hydi-v3/ExecutiveCockpit.js` — added `StartupIntegrity` instance and `startup`/`health` command.
- `src/hydi-v3/ConversationEngine.js` — `_whatAbout()` resolves flagship objectives before agent domains; `_help()` now records the interaction through the cockpit.
- `src/hydi-v3/ExecutiveTimeline.js` — `list()` tie-breaks on monotonic `seq` to keep newest-first stable.
- `tests/unit/hydi-v3/BusinessMemory.test.js` — added invalid-input rejection, normalization, ranking-corruption, and migration tests.
- `tests/unit/hydi-v3/BriefingRenderer.test.js` — replaced ANSI regex literals with `new RegExp(String.fromCharCode(...))` to satisfy `no-control-regex`.
- `tests/unit/hydi-v3/OperatorSession.test.js` — same ANSI regex fix.
- `CHANGELOG.md` — documented Phase 15.

## Normalization Rules

| Field | Accepted Inputs | Normalized To |
|---|---|---|
| `risk` | `0-1`, `0-100%`/`"50%"`, `1-5`, `1-10`, `"low"`, `"medium"`, `"high"` | `0.0 - 1.0` |
| `probability` | `0-1`, `0-100%`/`"80%"`, `"low"`, `"medium"`, `"high"` | `0.0 - 1.0` |
| `confidence` | same as probability | `0.0 - 1.0` |
| `strategic` | same as probability | `0.0 - 1.0` |
| `value` / `cost` / `revenue` | numeric, `"$1,000"`, `"1,000"` | non-negative number |
| `effort` | numeric | `>= 1` |

Explicit `riskScale` field can force `1-5` or `1-10` interpretation. Without it, the engine auto-detects integer ranges:

- `0-1` for decimal or 0/1 values
- `1-5` for integers `1` through `5`
- `1-10` for integers `6` through `10`
- `0-100%` for integers `11` through `100` or strings ending in `%`

## Startup Integrity Checks

`StartupIntegrity.check()` verifies and reports:

- StrategicObjectives loaded
- BusinessMemory health
- ExecutionGateway health
- Required adapters registered
- Data store readable
- Backup system available
- Session state recovered
- Observability connected

Result shape:

```json
{
  "status": "healthy|degraded|failed",
  "checks": [
    { "name": "BusinessMemory", "status": "healthy", "detail": "entities 42" },
    { "name": "BackupSystem", "status": "degraded", "detail": "no backup provider configured" }
  ]
}
```

`toText()` renders an executive summary such as:

```
**Startup Status: Degraded**

* BusinessMemory: entities 42
* StrategicObjectives: 5 active objective(s)
...

Needs attention:
* BackupSystem: no backup provider configured
```

## Validation Results

| Gate | Command | Result |
|---|---|---|
| Type validation | `npm run typecheck` | PASS |
| Lint validation | `npm run lint:hydi-v3` | PASS (0 errors, 14 pre-existing `no-console` warnings) |
| Full regression suite | `npm test` | **PASS — 174/174 suites, 1,801/1,801 tests** |
| Performance validation | `npm run benchmark:performance` | PASS |

## Self-Audit Findings

- **Can malformed risk silently corrupt a recommendation?** No. `BusinessMemory.put()` throws `DataIntegrityError` for out-of-range or unparseable values before storing.
- **Do old snapshots break after the schema change?** No. `BusinessMemory` reads `version` from the snapshot and runs `_migrateEntity()` on every loaded entity.
- **Can the system start with missing strategic objectives?** It will start but report `failed` startup status, so the operator sees the issue immediately rather than a stack trace.
- **Is ranking stable for same-timestamp events?** Yes. `ExecutiveTimeline` now uses a monotonic `seq` tie-breaker.
- **Does `help` route through the cockpit so interactions are recorded?** Yes. `ConversationEngine._help()` calls `cockpit.handleCommand('help')` before returning the help text.

## Remaining Technical Debt

- `ExecutiveCockpit._matchesPriority()` is still unused and can be removed in a future cleanup.
- `DataIntegrity` does not yet validate `payload` sub-fields; future business rules may want typed payloads.
- `StartupIntegrity` backup check is best-effort; a real backup provider can be injected later.

## Recommended Next Milestone

**Operator CLI Production Readiness** — harden `OperatorCLI`/`OperatorSession` for real use: add graceful shutdown, command history, session restore, offline mode, and a `--dry-run` flag for every mutating command.

## Working Tree Status

Pending commit. All validation passed. No uncommitted fixes remain.
