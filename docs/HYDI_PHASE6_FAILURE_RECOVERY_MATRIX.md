# HYDI Phase 6 — Failure / Recovery Matrix

## Health subsystem (migrated in Phase 6)

| Scenario | Test | Evidence | Result |
|---|---|---|---|
| Normal operation — no Supabase | `api/health.js` returns healthy | `tests/unit/health-local-first.test.js` | PASS |
| Process restart — dashboard persists | `getDashboard()` after `setDashboard()` with fresh require | `tests/unit/health-local-first.test.js` | PASS |
| Local persistence unavailable | Default dashboard returned, status healthy | `tests/unit/health-local-first.test.js` | PASS |
| Local persistence restored | New writes appear after next read | `tests/unit/health-local-first.test.js` | PASS |
| Cloud unavailable | `cloud.available: false`, status still healthy | `tests/unit/health-local-first.test.js` | PASS |
| Duplicate operation | idempotent `setDashboard` overwrite | `tests/unit/health-local-first.test.js` | PASS |
| Malformed input | atomic JSON parse; defaults on corruption | `lib/health/local-dashboard-store.js` | PASS (defaults) |
| Unauthorized input | endpoint uses no auth; existing auth layer unchanged | N/A | N/A |
| Corrupted/missing state | `getDashboard` returns defaults | `tests/unit/health-local-first.test.js` | PASS |

## Other subsystems (audited, not yet migrated)

| Subsystem | Normal | Restart | Local DB missing | Cloud missing | Duplicate | Malformed | Unauthorized | Corruption | Status |
|---|---|---|---|---|---|---|---|---|---|
| Workers / job queue | not tested | not tested | fails (Supabase) | fails | not tested | not tested | not tested | not tested | NOT MIGRATED |
| CASCADE raw ledger | not tested | not tested | fails | fails | not tested | not tested | not tested | not tested | NOT MIGRATED |
| ProtoForge policy | not tested | not tested | fails | fails | not tested | not tested | not tested | not tested | NOT MIGRATED |
| Chat memory | not tested | not tested | fails | fails | not tested | not tested | not tested | not tested | NOT MIGRATED |
| Revenue | not tested | not tested | fails | fails | not tested | not tested | not tested | not tested | BLOCKED |

## Notes

- Health is the first subsystem to be migrated because all other local-first work depends on truthful observability.
- The local dashboard store defaults to a healthy `OK` state when no data is present. This prevents a cold local HYDI from reporting itself as dead.
- Cloud availability is reported separately in every health response; a missing cloud does not affect local status.
