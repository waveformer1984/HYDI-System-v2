# Phase 18D — Git Sensor

Date: 2026-07-25
Branch: clean-main
Builds on: Phase 18B (`ae6f038`)
Note: renumbered from 18C — Phase 18C is the Physical Operations Sensor Framework (`6485558`).

## Implementation Summary

Phase 18B established `BusinessEventBus` as the single integration boundary. This phase tests that claim by attaching a second, entirely different sensor. Git activity — commits, branches, and working-tree state — now becomes business signals through exactly the same path filesystem events already use.

**`ExecutiveOperatingSystem` required no changes to support it.** A test asserts its source contains no occurrence of the word "git" at all.

## Architecture

```
GitSensor  ──┐
             ├──▶ BusinessEventBus ──▶ BusinessSignalInterpreter ──▶ ExecutiveOperatingSystem
Filesystem ──┘         (dumb)              (assigns meaning)          (knows only BusinessSignal)
```

Three layers, three separate concerns:

- **GitSensor** knows git and no business vocabulary. It reports facts: a commit happened, a branch appeared, the tree is dirty.
- **BusinessSignalInterpreter** knows business meaning and no git. It turns `CommitCreated` into "Work committed to Resonate by J (2 files): Fix audio engine crash", assigns the strategic objective, and classifies impact.
- **ExecutiveOperatingSystem** subscribes only to `BusinessSignal` and is unaware either producer exists.

## Files Added

- `src/hydi-v3/GitRepository.js` — read-only git accessor.
- `src/hydi-v3/GitSensor.js` — polls a repository and publishes typed events.
- `tests/unit/hydi-v3/GitSensor.test.js` — 31 tests against real temporary git repositories.

## Files Modified

- `src/hydi-v3/BusinessSignalInterpreter.js` — interpretations and impact classes for the six git event types.
- `src/hydi-v3/ExecutiveOperatingSystem.js` — `recentActivitySummary()` now appends a "Most recent" detail tail (see Findings).
- `src/hydi-v3/OperatorSession.js` — constructs the event bus and interpreter; attaches an opt-in `GitSensor`; sensors are torn down first; the interpreter is detached and the bus destroyed after teardown.
- `src/hydi-v3/index.js` — exports `GitRepository` and `GitSensor`.
- `scripts/operator-cli.js` — `--git [path]`, `--git-poll <ms>`, `--git-project <name>`.
- `scripts/minitest.js` — added `done`-callback tests and the `toHaveBeenCalled*` matchers.

## Event Types

| Event | Meaning | Impact |
| --- | --- | --- |
| `CommitCreated` | new commit reachable from HEAD | `engineering-delivered` |
| `BranchCreated` | local branch appeared | `engineering-started` |
| `BranchDeleted` | local branch gone | `engineering-closed` |
| `BranchStale` | branch untouched beyond `staleAfterMs` | `risk-stale` |
| `WorkingTreeDirty` | uncommitted work appeared | `risk-uncommitted` |
| `WorkingTreeClean` | uncommitted work resolved | `engineering-progress` |

## Design Decisions

**Read-only is structural, not conventional.** `GitRepository` runs `execFile`, never `exec` — there is no shell, so commit messages, branch names, and paths cannot inject commands, and all three are attacker-influenced in a shared repository. A test commits the message ``fix; rm -rf / && echo $(whoami) `id` `` and asserts it round-trips as literal text. Beyond that, an allowlist permits only `rev-parse`, `log`, `show`, `status`, `for-each-ref`, and `symbolic-ref`: a future edit cannot turn this class into something that writes.

**A cold start distinguishes history from present state.** Replaying a repository's entire history as fresh activity would be useless noise, so the first poll adopts HEAD as a baseline and publishes no commits, and no `BranchCreated` for branches that already exist. But suppressing *everything* on first run meant the first briefing after configuring the sensor said "No recent project activity" while real risk sat in the repo. Staleness and uncommitted work are facts about *now*, not history, so they publish on the cold start too. A clean tree stays silent — announcing cleanliness the operator never saw become dirty is noise.

**Everything else is edge-triggered.** A steady repository produces zero events (asserted), so polling every 60s does not fill the briefing with repetition. Stale branches are reported once and the flag clears when the branch sees a commit, so a revived branch can go stale again later.

**The cursor persists.** Restarting does not replay. An unknown cursor — rebased away, or a store copied between repositories — falls back to a cold read rather than leaving the sensor permanently broken.

**Sensors are opt-in.** The bus is always constructed so the Executive OS has something to subscribe to, but no sensor starts without being asked. Observing the outside world should be a deliberate choice. Sensors are also torn down first in `_components()`, so a poll in flight cannot publish into a half-destroyed stack.

**Absence is not failure.** No git installed, or a directory that is not a repository, is reported as an inactive sensor with a specific reason and never gates session health — a missing observation is not a broken system.

## Findings

1. **The sensing layer was never wired into the running system.** `BusinessEventBus`, `FilesystemMonitor`, and `BusinessSignalInterpreter` existed and were tested, but nothing outside the test suite ever constructed a bus — `OperatorSession` had no reference to any of them. Phase 18B's "the bus is now the single integration boundary" was true of the design and not yet of the running process. `OperatorSession` now builds the bus and interpreter and passes the bus to the Executive OS, so the wiring exists in production, not only in tests.

2. **The briefing reported activity counts but never what happened.** `recentActivitySummary()` aggregated to "1 activity signal for resonate", discarding the human-readable interpretation each signal already carries. A commit and a deleted branch were indistinguishable to the reader. A "Most recent" tail now lists the three latest interpretations. The existing aggregate lines are unchanged and come first, so no existing test or consumer is affected.

3. **`--git-project` matters more than it looks.** Without it the project label defaults to the directory name, which for this repo is `HYDI_System` — matching no strategic objective, so commits score as `default` rather than `operations`. The flag exists so git activity lands against the right objective.

## Self-Audit Results

- `ExecutiveOperatingSystem` source contains no occurrence of "git" (asserted by test).
- `GitSensor` contains no business vocabulary; all interpretation lives in `BusinessSignalInterpreter`.
- No git event falls through to the interpreter's generic `Activity in <project>` default (asserted across all six types).
- Only allowlisted read-only subcommands can run; `commit`, `push`, `reset`, `clean`, `checkout`, and `config` are all refused (asserted).
- Shell metacharacters in commit subjects are treated as data (asserted).
- A steady repository publishes nothing (asserted).
- Concurrent polls do not double-publish (asserted).
- Corrupt cursor stores are archived and recovered, matching every other hydi-v3 store.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `GitSensor.test.js` | 31/31 pass |
| Sensing + briefing suites | 67/67 pass — ExecutiveOperatingSystem, BusinessSignalInterpreter, BusinessEventBus, FilesystemMonitor, BriefingRenderer, ExecutiveCockpit, BusinessMemory |
| Operator suites | 48/48 pass — OperatorSession, OperatorMode, localAccessGuard |
| Gateway/workflow suites | 47/47 pass |
| Live: sensor against this repository | 52 real commits parsed, authors and file counts correct |
| Live: restart | 0 commits republished |
| Live: present-state on first run | real stale branches detected — `main` 86 days, `claude/session3-production-fixes` 67 days |
| Live: `--git-project "ProtoForge Operations"` | commits scored against `operations` instead of `default` |

**Not run in this environment:** full `npm test` (182 suites) and `npm run lint:hydi-v3` — Jest's crawler and ESLint's plugin resolution stall on the mounted volume. `scripts/minitest.js` executed the real test files instead. Run both on the host before merge.

## Operator Reference

```
node scripts/operator-cli.js --git                          # watch cwd
node scripts/operator-cli.js --git /path/to/repo --git-project "Resonate"
node scripts/operator-cli.js --git . --git-poll 30000       # poll every 30s
node scripts/operator-cli.js --git . --git-poll 0           # manual poll only
```

Without `--git`, no sensor starts and the bus simply carries no git events.

## Next Recommended Milestone

A third sensor of a different shape — one that is *pull*-based against an external system rather than a local observation — would test the boundary in the remaining untested direction. The obvious candidate is a Stripe sensor turning settled payments into revenue signals, since Stripe is already the one deliberate external dependency. Note that it is the first sensor that would need network access, so it must interact correctly with `--offline` rather than silently hanging.
