# HYDI Post-Qualification Baseline

**Frozen at:** 2026-08-25T15:08:00Z

## Repository State

| Field | Value |
|-------|-------|
| Branch | feat/governed-autonomy |
| HEAD | fd7751b16f040919531f001d93d2f70b396c9a85 |
| Worktree files | 39 (all user-owned, 0 unknown) |
| Typecheck | 115 errors (baseline: 115, delta: 0) |

## Release Gate

| Gate | Status |
|------|--------|
| G01-G13 | PASS |
| G14 | PASS (39 user-owned, 4 generated, 0 unknown, 0 protected) |
| G15 | PASS (delta=0) |
| **Total** | **15/15 PASS** |

## 24-Hour Soak Evidence

| Metric | Value |
|--------|-------|
| Status | QUALIFIED_24H |
| Start | 2026-08-24T05:38:53.967Z |
| End | 2026-08-25T05:38:54.870Z |
| Duration | 86400.7s |
| Cycles | 85,568 |
| Safety violations | 0 |

## Runtime State

| Service | Status | Uptime |
|---------|--------|--------|
| PM2 hydi-boot | online | 3D |
| PM2 hydi-watchdog | online | 3D |
| protoforge-core (port 3005) | degraded (stable, no recent health runs) | — |
| heidi-web (port 3000) | responding (degraded) | — |

## Qualification Evidence

| Suite | Result |
|-------|--------|
| Security (Phase 8) | 85/85 assertions, 20/20 invariants |
| Crash/restart (Phase 7) | 246/246 assertions, 24/24 scenarios |
| 500-cycle soak (Phase 9) | 12/12 assertions |
| Daemon (Phase 11) | 76/76 assertions, 15/15 invariants |
| Watchdog (Phase 12) | 63/63 assertions, 12/12 invariants |
| Dashboard (Phase 13) | 75/75 assertions, 12/12 invariants |
| G14 ownership policy | 10/10 invariants |
| 24h soak (Phase 10) | QUALIFIED_24H |
