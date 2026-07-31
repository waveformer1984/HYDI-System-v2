# HYDI Operational Entry-Point Audit (Phase 23B)

Scope: every current path that boots or exposes the HYDI v3 executive stack.

| Entry point | Startup module | Services initialized | Sensors loaded | Health checks | Shutdown handling | Production capable? | Notes |
|---|---|---|---|---|---|---|---|
| `npm run cockpit` / `node scripts/operator-cli.js` | `OperatorSession` constructed directly (`scripts/operator-cli.js:117`) | Full stack: `BusinessMemory`, `BusinessEventBus`, `ExecutiveOperatingSystem`, `ExecutionGateway`, `WorkflowEngine`, `LearningMetrics`, `AuditLedger`, `ConversationEngine`, `ConsoleAPI` | Opt-in via `--git`, `--filesystem`, `--simulate-manufacturing`, `--revenue-ledger` | `session.healthCheck()`, `session.certify()` on request, `OperatorMode` dry-run/offline | `--once` path calls `session.shutdown()`; interactive path uses `OperatorRuntime` with `SIGINT`/`SIGTERM` graceful shutdown | **No — bypasses `HYDIOperationalBoot`** | Main production CLI; needs to route through `HYDIOperationalBoot.boot()` |
| `node scripts/hydi-cli.js status` / `npm run hydi:status` | `HYDIOperationalBoot.boot()` (`scripts/hydi-cli.js:21`) | Same full stack via `HYDIStartupSequence` | None by default | `HYDIStartupSequence.generateHealthReport()` | `session.destroy()` in `finally` | **Yes** | Already canonical; only output needs human-friendly polish |
| `node scripts/hydi-cli.js readiness` / `npm run hydi:readiness` | `HYDIOperationalBoot.boot()` | Same full stack via `HYDIStartupSequence` | None by default | `HYDIStartupSequence.generateHealthReport()` | `session.destroy()` in `finally` | **Yes** | Already canonical |
| `pages/api/cockpit/index.js` and `command.js` | `getCockpitSession()` in `src/hydi-v3/cockpitSession.js:28` constructs `OperatorSession` directly | Full stack, cached on `globalThis` | None unless env vars set (none currently) | `session.briefingHtml()` / `session.ask()` indirectly | `resetCockpitSession()` destroys cached session | **No — bypasses `HYDIOperationalBoot`** | Web dashboard; needs `HYDIOperationalBoot.boot()` |
| `node scripts/hydi-demo.js` / `npm run hydi-demo` | `OperatorSession` constructed directly (`scripts/hydi-demo.js:31`) | Full stack | None | `session.briefing()` | `session.destroy()` | **Demo only** | Non-production demonstration script; should also route through `HYDIOperationalBoot.boot()` for consistency |
| `node scripts/hydi-operational-demo.js` / `npm run hydi-operational-demo` | `OperatorSession` constructed directly (`scripts/hydi-operational-demo.js:31`) | Full stack | None (events emitted manually) | `session.briefing()` | `session.destroy()` + temp `dataPath` cleanup | **Demo only** | Non-production demonstration script; should also route through `HYDIOperationalBoot.boot()` for consistency |
| `node scripts/boot-agent.js` / `npm run boot` | `boot.config.json` + `child_process.spawn` (`scripts/boot-agent.js:111`) | Spawns Supabase, Ollama, HEIDI Core, Next.js as separate processes | N/A (process supervisor) | Module-by-module health polling | Kills child processes on `SIGINT` | **Out of scope** | Service orchestrator, not the HYDI v3 executive boot path |
| `node scripts/start-hydi.js` / `npm run start:hydi` | Hard-coded service list in `scripts/start-hydi.js:32` | Spawns Supabase, Ollama, HEIDI Core, mobile chat, Next.js | N/A | Port checks + health polling | Kills child processes | **Out of scope** | Legacy service orchestrator, not the HYDI v3 executive boot path |
| `tests/integration/hydi-v3-integration.test.js` | `HYDIAutonomyManager` from `src/hydi-v3/index.js` (`tests/integration/hydi-v3-integration.test.js:37`) | Autonomy manager stack (missions, reflection, distributed compute, etc.) | N/A | `manager.getStatus()` | `manager.stop()`/`manager.destroy()` | **Test only** | Tests the older `HYDIAutonomyManager`, not `OperatorSession` |
| `tests/integration/hydi-operational-demo.test.js` | `OperatorSession` constructed directly (`tests/integration/hydi-operational-demo.test.js:32`) | Full stack | None (events emitted manually) | `session.briefing()` | `session.destroy()` | **Test only** | Superseded by `hydi-morning-executive-simulation.test.js` |
| `tests/integration/hydi-operational-failure-modes.test.js` | `OperatorSession` constructed directly (`tests/integration/hydi-operational-failure-modes.test.js:36`) | Full stack | None | `session.healthCheck()`, `SignalCoverage.audit()` | `session.destroy()` | **Test only** | Overlaps with `hydi-production-failure-modes.test.js`; keep unique tests (`rejected approval`, `no evidence`) and consolidate duplicates |
| `tests/integration/hydi-production-failure-modes.test.js` | `OperatorSession` constructed directly (`tests/integration/hydi-production-failure-modes.test.js:34`) | Full stack | None | `session.healthCheck()`, `SignalCoverage.audit()` | `session.destroy()` | **Test only** | Newer failure-mode suite; should eventually also boot via `HYDIOperationalBoot.boot()` |
| `tests/unit/hydi-v3/*.test.js` (multiple) | `OperatorSession` constructed directly | Full stack or subset | None / mocks | `session.healthCheck()`, subsystem-specific | `session.destroy()` | **Test only** | Direct construction is acceptable for unit tests of subsystems |

## Duplicate startup paths

1. **Production CLI bypass:** `scripts/operator-cli.js` and `src/hydi-v3/cockpitSession.js` both create `new OperatorSession(...)` directly. This duplicates the construction and ordering already encoded in `HYDIStartupSequence` and `HYDIOperationalBoot`.
2. **Demo scripts bypass:** `scripts/hydi-demo.js` and `scripts/hydi-operational-demo.js` also construct `OperatorSession` directly, duplicating the same setup.
3. **Test bypass:** `tests/integration/hydi-operational-demo.test.js`, `hydi-operational-failure-modes.test.js`, and `hydi-production-failure-modes.test.js` construct `OperatorSession` directly. Unit tests that test `OperatorSession` itself are acceptable.

## Recommendation

Choose `HYDIOperationalBoot.boot()` as the single canonical production boot path.

- `scripts/operator-cli.js` and `src/hydi-v3/cockpitSession.js` must call `HYDIOperationalBoot.boot()`.
- `scripts/hydi-demo.js` and `scripts/hydi-operational-demo.js` should also call `HYDIOperationalBoot.boot()` to keep demo scripts aligned with production.
- A guard test should verify the production entry-point files no longer contain `new OperatorSession`.
- `scripts/boot-agent.js` and `scripts/start-hydi.js` remain process orchestrators and are intentionally outside the `HYDIOperationalBoot` scope.
