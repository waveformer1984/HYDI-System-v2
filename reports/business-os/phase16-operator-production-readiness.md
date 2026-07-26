# Phase 16 — Operator CLI Production Readiness

Date: 2026-07-25
Branch: clean-main
Builds on: Phase 15 (`4780286`)

## Implementation Summary

The operator CLI worked but was not safe to leave running: Ctrl-C killed it mid-write, history vanished on exit, there was no way to preview a destructive command, and nothing asserted the local-first guarantee the architecture claims. Phase 16 adds graceful shutdown, persisted command history, offline mode, and `--dry-run`.

## Architecture

```
scripts/operator-cli.js          ← argv parsing only
        ↓
OperatorRuntime                  ← readline loop, queue, history, signals, shutdown
        ↓
OperatorCLI → OperatorSession → ConversationEngine → ExecutiveCockpit
                    ↑
              OperatorMode       ← wraps the mutation authorities
```

The terminal lifecycle moved out of `scripts/` into `src/hydi-v3/OperatorRuntime.js` so it is unit-testable with injected streams. The script is now 116 lines of flag parsing and wiring.

## Files Added

- `src/hydi-v3/OperatorMode.js` — enforces `--dry-run` and `--offline`.
- `src/hydi-v3/OperatorRuntime.js` — readline loop, serialised command queue, history wiring, signal handling, bounded graceful shutdown.
- `tests/unit/hydi-v3/OperatorMode.test.js` — 19 tests.
- `tests/unit/hydi-v3/OperatorRuntime.test.js` — 17 tests.

## Files Modified

- `src/hydi-v3/OperatorSession.js` — accepts a `mode` and installs it last in `start()`; added `_components()`, `flushAll()`, and `shutdown()`.
- `src/hydi-v3/SessionMemory.js` — added `getRecentCommands(limit)`.
- `src/hydi-v3/ExecutionGateway.js` — `approve()` now honours `config.simulate` (see Defects).
- `src/hydi-v3/index.js` — exports `OperatorMode` and `OperatorRuntime`.
- `scripts/operator-cli.js` — reduced to argv parsing; new flags.
- `package.json` — added `cockpit:dry-run` and `cockpit:offline`.

## Design Decisions

**Dry run is enforced at the mutation boundary, not the parser.** The obvious implementation — classify operator text as mutating or read-only — would duplicate `ConversationEngine`'s routing table and drift from it the first time a verb is added. A missed verb in that design means a dry run performing a real mutation, which is the one failure this feature exists to prevent. `OperatorMode` instead wraps the small closed set of methods that are the only ways the stack can affect anything outside itself:

```
ExecutionGateway.execute / approve / reject / requestModification
BusinessWorkflowEngine.approveWorkflow / rejectWorkflow / startWorkflow
ConsoleAPI.backup
```

Any phrasing that reaches a real effect must pass through one of these, so the guard cannot be bypassed by rewording a command, and adding a new conversational synonym requires no change here.

**`approve` routes to `ExecutionGateway.simulatePending()`.** Dry run introduces no new execution route — it reuses the gateway's existing simulation path, and `execute()` is forced down the gateway's own `simulate: true` branch. The pending action is left in place, so the operator can preview and then really approve without re-queuing.

**Mode is installed by `OperatorSession`, not the CLI.** Installing last in `start()` means the guard wraps fully constructed components, and every surface built on an `OperatorSession` — CLI, local routes, anything future — inherits the same guarantee. A dry run cannot be bypassed by switching frontend.

**Session-view preferences are deliberately unguarded.** `focus` and `priority` change what the operator sees, not what the system does. Blocking them would make a dry run useless for exploring focus areas.

**Offline mode is enforcement plus assertion.** Every network-capable action type is already `forbidden` in `ExecutionGateway`'s classification, so the stack has no network path today. Offline mode re-checks at the call boundary, which matters because the gateway's own adversarial test proves an adapter can be registered at runtime — `verifyOffline()` detects exactly that case and reports it at startup rather than at first use.

**History reads from `SessionMemory`, not a new file.** `ConversationEngine.recordCommand()` already persists commands. Adding a separate `.cockpit_history` would have created two sources of truth. `saveHistory()` records only the lines `SessionMemory` never saw — CLI-local intents like `exit`, and anything typed while a previous command was still running — so recall is complete without duplicate entries.

**Shutdown flushes before destroying.** `destroy()` alone meant a failure in one component's teardown could cost data another component had already buffered. `flushAll()` persists everything first and reports per-component failures instead of throwing.

## Shutdown Contract

1. Stop accepting new input.
2. Let the in-flight command finish, bounded by `--shutdown-timeout` (default 10s).
3. Persist command history into `SessionMemory`.
4. Flush every store, then destroy the session.
5. Exit `0` on a clean drain, `1` if the drain timed out or a flush failed.

A second interrupt during shutdown exits immediately with `130`, so a wedged flush can never trap the operator.

## Self-Audit Results

- No text-pattern classifier decides what is mutating; the guard wraps the authorities themselves.
- Dry run adds no execution path — it delegates to `simulatePending()` and the gateway's existing `simulate` branch.
- Dry-run `approve` leaves the action pending and writes no completed entry to the audit log (both asserted).
- A live backup was confirmed to write files, proving the dry-run refusal is meaningful rather than a broken code path.
- Offline refusal takes precedence over dry-run simulation when both are active (asserted).
- `uninstall()` fully restores real behaviour (asserted), so the guard cannot leak into a later live session.
- Flush is asserted to happen before destroy by call-order instrumentation.
- Shutdown never throws; every failure path returns an exit code.
- The shutdown timeout was verified to fire in a bare event loop, not just under a test harness that happened to hold handles open.
- History is capped, de-duplicated, and skips blank lines (all asserted).

## Defects Found and Fixed

1. **`ExecutionGateway.approve()` ignored its own `simulate` config.** It passed `false` unconditionally to `_runEntry`, so a gateway constructed with `simulate: true` would simulate `execute()` but perform **real side effects on approval**. This is a pre-existing latent bug independent of Phase 16 — any caller trusting the gateway-wide simulate flag was silently unprotected on the approval path. Fixed and covered by a regression test.

2. **Dry-run journal overstated interceptions.** A review-required action that was merely queued was recorded as "simulated". Now only actions that actually reach an adapter are journalled.

3. **The shutdown timeout timer was `unref()`'d.** Found by running the drain path outside a test harness, with no readline interface holding the event loop. With the timer unref'd, Node exited *silently with status 0* the instant a stalled command became the last thing keeping the loop alive — the exact failure the timeout exists to report, reported as success. Inside the test harness readline's handles masked it. The timer is no longer unref'd, and a regression test now drives `shutdown()` with no other handles present.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `node --check` on all new/changed files | pass |
| `OperatorMode.test.js` | 19/19 pass |
| `OperatorRuntime.test.js` | 17/17 pass |
| `OperatorSession.test.js` | 20/20 pass |
| Executive-stack regression suites | 97/97 pass — ExecutionGateway, ExecutiveCockpit, ExecutiveOperatingSystem, BusinessWorkflowEngine, BusinessMemory, StrategicObjectives, BriefingRenderer, localAccessGuard |
| Live: `--dry-run --once` | dry-run summary printed, no mutations |
| Live: dry-run `backup` | refused; `data/backups/` not created |
| Live: real `backup` (control) | 4 files written — refusal is meaningful |
| Live: `--offline` + `send-email` | refused at the gateway with an explicit reason |
| Live: SIGINT during interactive session | "Interrupt received" printed, stores persisted, exit 0 |
| Live: history across restarts | `['help','status','backup','help','exit']` persisted and reloaded newest-first |

**Not run in this environment:** full `npm test` (174 suites) and `npm run lint:hydi-v3` — Jest's crawler and ESLint's plugin resolution both stall on the mounted volume. `scripts/minitest.js` executed the real test files instead. Run both on the host before merge.

## Operator Reference

```
npm run cockpit                                  # interactive
npm run cockpit:dry-run                          # simulate everything
npm run cockpit:offline                          # refuse network actions
node scripts/operator-cli.js --dry-run --offline # both
node scripts/operator-cli.js --no-history
node scripts/operator-cli.js --shutdown-timeout 30000
```

Ctrl-C drains and persists. Ctrl-C twice exits immediately (130). Up/Down recalls commands from previous sessions.

## Next Recommended Milestone

Approval workflow ergonomics: `simulate all`, batch approve with a confirmation summary, and a `--yes` guard so the batch path cannot be driven non-interactively by accident. This is the natural follow-on now that previewing an action is cheap and safe.
