# Phase 14B — Unified Operator Surface (CLI + Local Dashboard)

Date: 2026-07-25
Branch: clean-main
Builds on: Phase 14A (`44bf2ab`)

## Implementation Summary

The executive stack was fully assembled but had no human entry point — `ExecutiveCockpit` could only be driven from test code. Phase 14B adds two operator surfaces, a readline CLI and a localhost-only dashboard route, both built on one shared renderer and one shared session bootstrap so they cannot drift apart.

The owner can now type `npm run cockpit`, enter "Good morning", and receive the full multi-section executive briefing.

## Architecture

```
ExecutiveOperatingSystem.morningBriefing()   ← structured briefing object
                 ↓
        BriefingRenderer.toSections()        ← format-neutral section model
           ↓            ↓            ↓
        toText()     toAnsi()     toHtml()
           ↓            ↓            ↓
    EOS.toText()   Operator CLI   /api/cockpit
```

```
OperatorSession  ← single bootstrap for both surfaces
    ├── BusinessMemory
    ├── ExecutiveOperatingSystem
    ├── TaskEngine
    ├── BusinessWorkflowEngine
    ├── ExecutionGateway
    └── ExecutiveCockpit
```

Both surfaces construct an `OperatorSession`; neither instantiates components itself. This guarantees they share one `StrategicObjectives` instance, one owner priority, and one persistence directory.

## Files Added

- `src/hydi-v3/BriefingRenderer.js` — single source of truth for briefing presentation. `toSections()` produces a format-neutral model; `toText()`, `toAnsi()`, and `toHtml()` render it. Adding a briefing section is a one-place edit.
- `src/hydi-v3/OperatorSession.js` — boots and tears down the full executive stack with a shared `StrategicObjectives` instance; exposes `ask()`, `briefing()`, `briefingText()`, `briefingHtml()`, `healthCheck()`.
- `src/hydi-v3/OperatorCLI.js` — CLI intent parsing and command handling with no I/O, so it is unit-testable without a terminal.
- `src/hydi-v3/localAccessGuard.js` — loopback-only request guard for the dashboard routes.
- `src/hydi-v3/cockpitSession.js` — process-wide `OperatorSession` cache for Next.js routes (hot-reload safe via `globalThis`).
- `scripts/operator-cli.js` — readline wrapper. Flags: `--priority`, `--once`, `--no-colour`, `--data-path`.
- `scripts/minitest.js` — minimal Jest-compatible runner for environments where the Jest crawler is unavailable. Verification convenience only; `npm test` remains authoritative.
- `pages/api/cockpit/index.js` — GET, serves the HTML dashboard.
- `pages/api/cockpit/briefing.js` — GET, returns `{ briefing, model, text }` for programmatic consumers.
- `pages/api/cockpit/command.js` — POST `{ text }`, runs one cockpit command.
- `tests/unit/hydi-v3/BriefingRenderer.test.js` — 16 tests.
- `tests/unit/hydi-v3/OperatorSession.test.js` — 20 tests (session + CLI).
- `tests/unit/hydi-v3/localAccessGuard.test.js` — 9 tests.

## Files Modified

- `src/hydi-v3/ExecutiveOperatingSystem.js` — `toText()` now delegates to `BriefingRenderer`; the ~50-line inline formatter was removed. Added `toSections()`. `_executiveSummary()` now derives health from `BriefingRenderer.healthOf()`.
- `src/hydi-v3/index.js` — exports the executive layer (`BusinessMemory`, `ExecutiveOperatingSystem`, `ExecutiveCockpit`, `StrategicObjectives`, `BriefingRenderer`, `OperatorSession`, `OperatorCLI`, `localAccessGuard`), which were previously unreachable through the package entry point.
- `package.json` — added `cockpit` and `cockpit:brief` scripts; extended `lint:hydi-v3` scope to `pages/api/cockpit` and `scripts/operator-cli.js`.
- `tsconfig.typecheck.json` — added the new script and route paths.

## Design Decisions

**One renderer, three formats.** Phase 14A's `toText()` hard-coded the section list inside `ExecutiveOperatingSystem`. Adding a web surface would have duplicated it. `BriefingRenderer.toSections()` is now the only place section content is defined; the three renderers are pure formatting over that model. A test asserts that every line present in the ANSI output is also present in the plain text output.

**The CLI owns exactly two intents.** `exit` (a terminal concern) and `briefing` (the full EOS briefing rather than the cockpit's short `goodMorning()` summary). Everything else falls through to `ExecutiveCockpit.parseCommand`, so the CLI cannot grow a parallel command vocabulary. A test asserts that unrecognised input reaches the cockpit's own "I did not understand" response rather than a CLI-local message.

**Local-first by refusal, not authentication.** The cockpit exposes unredacted business memory, pipeline value, and approval controls. The route guard refuses non-loopback requests outright rather than authenticating them, and treats `X-Forwarded-For` / `X-Real-IP` / `Forwarded` as evidence of a proxy hop and therefore non-local. Unknown peer addresses fail closed.

**Handlers live in `pages/api/cockpit/`, not bridged from `api/`.** The repo's bridge pattern exists because `api/` is a Vercel-platform convention. The cockpit is explicitly never deployed, so bridging it would wrongly imply it is a deploy target.

**No authority escalation.** Both surfaces call `ExecutiveCockpit.handleCommand`, which routes approvals and rejections through `ExecutionGateway` unchanged. The operator surface is an interface, not a new permission path.

## Self-Audit Results

- CLI and dashboard render from the same `toSections()` model; no surface can invent content the briefing object does not contain.
- No surface constructs stack components directly — all go through `OperatorSession`.
- All six components verified to share one `StrategicObjectives` instance (asserted by test).
- Owner priority set on the session propagates to cockpit, registry, and memory (asserted by test).
- Executive summary health string and rendered status line derive from one function (asserted by test).
- Every scored priority action returns a `reason` (asserted by test).
- Dashboard escapes all briefing-derived content; an XSS-shaped entity name is rendered inert (asserted by test).
- CLI errors are reported without terminating the loop (asserted by test).
- Commands are serialised through a promise chain, so piped or pasted input cannot interleave responses or run `exit` before earlier commands finish.

## Defects Found and Fixed During Verification

1. **`localAccessGuard` treated an unknown peer address as local.** `isLocalRequest({})` returned `true` because the empty string was in the loopback set. Fixed to fail closed; regression test added.
2. **Executive summary and status line disagreed.** `_executiveSummary()` computed a two-state health (`stable`/`degraded`) while the renderer computed three (`stable`/`watch`/`degraded`), so a briefing could print "ProtoForge status: watch" above "ProtoForge is stable." Both now use `BriefingRenderer.healthOf()`; regression test added.
3. **Readline handlers raced under piped input.** Async `line` handlers ran concurrently, so `exit` could shut the session down before earlier commands finished printing. Fixed with a serial promise queue.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `node --check` on all new/changed files | pass |
| New unit tests (`minitest`) | 45/45 pass |
| Executive-stack regression suites (`minitest`) | 68/68 pass — `ExecutiveOperatingSystem`, `ExecutiveCockpit`, `StrategicObjectives`, `BusinessMemory`, `BusinessWorkflowEngine`, `ExecutionGateway` |
| Live CLI `--once "good morning"` | full 13-section briefing rendered |
| Live CLI interactive loop | `good morning` / `focus` / `status` / unknown / `exit` in correct order |
| Live route check (real HTTP server on 127.0.0.1) | `/api/cockpit` 200 with 13 sections; `/api/cockpit/command` 200 for `focus` and `help`; `/api/cockpit/briefing` 200 matching CLI text; spoofed `X-Forwarded-For` → 403 |
| Ranked output with seeded data | Resonate opportunity correctly ranked first under `--priority resonate` (10944.00 vs 1663.20 vs 957.60) |

**Not run in this environment:** full `npm test` (162 suites) and `npm run lint:hydi-v3`. Jest's file crawler and ESLint's plugin resolution both stall on the mounted volume used for this session. `scripts/minitest.js` was written to execute the real test files instead; it ran every executive-stack suite plus the three new ones. Both commands should be run on the host before merge.

## Operator Reference

```
npm run cockpit                    # interactive prompt
npm run cockpit:brief              # print one briefing and exit
node scripts/operator-cli.js --priority resonate
node scripts/operator-cli.js --once "focus" --no-colour

npm run dev                        # then open http://localhost:3000/api/cockpit
```

Commands: `good morning` · `status` · `focus` · `approvals` · `history` · `workflows` · `approve <id>` · `reject <id>` · `priority <p>` · `help` · `exit`

## Known Issue (pre-existing, not introduced here)

`StrategicObjectives.score()` clamps `entity.risk` to `0..1` and multiplies by `(1 - risk)`. Any entity stored with `risk >= 1` — natural if an operator enters risk on a 1–5 scale — scores exactly `0`, silently ranks last, and produces recommendation text reading `Highest score (0.00)`. The scoring semantics are correct as designed, but nothing validates or documents the expected range at the `BusinessMemory.put()` boundary. Recommend a follow-up to validate `risk`/`effort` ranges on entry.

## Next Recommended Milestone

Entity input validation and an `add`/`log` command set for the cockpit, so the owner can populate `BusinessMemory` conversationally rather than through code — closing the loop between the briefing and the data that drives it.
