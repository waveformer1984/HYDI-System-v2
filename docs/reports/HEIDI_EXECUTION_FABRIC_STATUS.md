# Execution fabric unification status

**Plan:** `docs/EXECUTION_FABRIC_UNIFICATION_PLAN.md`  
**Authority:** `lib/execution-fabric/gateway.js`

## Implemented (this iteration)

| Item | Location | Status |
|------|----------|--------|
| Fabric task FSM | `lib/execution-fabric/constants.js` | **COMPLETE** (12 states + transitions) |
| Distributed → fabric adapter | `lib/distributed-cloud/fabric-adapter.js` | **PARTIAL** (2 capability mappings) |
| Mission ↔ fabric state bridge | `lib/execution-fabric/mission-bridge.js` | **NEW** (reference mapping only) |
| Mission lifecycle (heidi-core) | `heidi-core/missions/lifecycle.js` | **EXISTING** — source of human approval |
| Mobile fabric API | `pages/api/heidi-mobile/fabric.js` | **EXISTING** |

## Not migrated (requires phased PR + governance)

- Postgres single store (`EXECUTION_FABRIC_PERSIST=postgres`)
- Full distributed enqueue → fabric for all worker actions
- Deprecation of parallel JSON job store

## Next safe step (Phase 1 adapter)

Register additional `DISTRIBUTED_TO_FABRIC` entries only when matching capabilities exist in `lib/execution-fabric/capabilities.js` and idempotency keys align (`EXECUTION_FABRIC_UNIFICATION_PLAN.md` §51–53).

## Verification

- `tests/unit/distributed-cloud-fabric-adapter.test.js` — SIMULATED pass on clean-main
- `tests/unit/execution-fabric-mission-bridge.test.js` — mapping pass