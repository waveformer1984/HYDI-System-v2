# ISSUES FOUND

Discovered problems, tracked with status. Newest first. See `WORKLOG.md` for
the narrative of what was fixed and why; this file is the flat list.

---

## Fixed this session (2026-07-15)

| # | Issue | File | Status |
|---|-------|------|--------|
| 1 | `npm run lint` failed to parse ~60 files across `pages/`, `components/`, `lib/`, `src/` — the project's `.eslintrc.json` had no Next.js/TypeScript parser configured, so the ESLint gate was silently non-functional for the entire frontend and much of the TS backend. | `.eslintrc.json` | **Fixed** — scoped `next/core-web-vitals` override added for `pages/`, `components/`, `lib/`, `hooks/`. |
| 2 | Fixing #1 crashed `next lint` with `TypeError: expand is not a function`. Caused by `package.json`'s `"overrides": {"brace-expansion": ">=5.0.6"}` force-pinning a breaking-change major version (v5, new export shape) onto every `minimatch@3.x` consumer in the ESLint toolchain, which expects the old `1.x` API. | `package.json` | **Fixed** — removed the blanket override; each consumer now resolves its own compatible (and already CVE-safe) major version. Verified `npm audit` stays at 0 vulnerabilities. |
| 3 | `strategy` and `input` referenced inside a `catch` block after being `const`-declared inside the paired `try` block (out of scope) — any inference failure threw a fresh `ReferenceError` from the error handler instead of surfacing the real error, and local-model fallback never ran. | `src/models/HybridModelStack.js` | **Fixed** — hoisted with `let` above the `try`. |
| 4 | Typo `worSourceSource` (should be `worstSource`) in a template literal, silently caught — the lead-source-underperformance adaptation suggestion was never returned when it should fire. | `src/control/OutcomeValidator.js:235` | **Fixed**. |
| 5 | Two class methods both named `checkModelHealth` (aggregate no-arg version + per-model version); the second silently shadowed the first, so the periodic heartbeat's aggregate check, failure tracking, `recoverFailedModels()`, and `storeHeartbeatMetrics()` were 100% dead code. The live heartbeat interval was actually calling the per-model checker with `modelId=undefined`. | `src/models/heartbeat.js` | **Fixed** — renamed per-model method to `checkSingleModelHealth`. |
| 6 | Once #5 was fixed and the aggregate method became reachable, it hit a second latent bug: `this.failedModels` constructed as a `Set` but used with `Map`-only methods (`.get()`, `.set()`, `forEach((count, modelId) => …)`). Would have thrown `TypeError` on every check cycle with at least one failed model. | `src/models/heartbeat.js` | **Fixed** — changed to `Map`. |
| 7 | `POST /cascade/quarantine/:eventId/release` referenced undefined `approvedBy` instead of the destructured `approved_by`; endpoint threw on every call. | `src/server.js:1055` | **Fixed**. |
| 8 | All five `/keymaker/*` admin routes (status, issue/revoke key, validate, audit, kill-switch, break-glass) referenced an undefined `keymaker` object — the full `Keymaker` class existed at `src/middleware/keymaker.js` but was never imported/instantiated in `server.js` (only the separate, simpler `SimpleKeymaker` tier-gate was wired up). | `src/server.js` | **Fixed** — imported, instantiated, and mounted `Keymaker`'s middleware alongside `SimpleKeymaker`'s. |
| 9 | 6 orphaned files under `src/` used ES module `import`/`export` syntax with no `.mjs` extension or `"type": "module"`, and were unreachable via `require()` from any live code path (`src/net/net.js`, `src/server-clean.js`, `src/services/persistence.js`, `src/db/dbRouter.js`, `src/db/local.sqlite.js`, `src/lib/supabaseClient.js`). | `src/**` | **Fixed** — archived to `archive/src-esm-orphans/` with a README explaining the reachability analysis, matching the existing archival convention. |
| 10 | `tests/unit/hydi-v3/DistributedCompute.test.js`'s `detects node timeout` and `tests/unit/hydi-v3/HeartbeatSystem.test.js`'s `detects missing heartbeat` tests were flaky — each raced a fixed `setTimeout` against the engine's own interval-based health check, both landing near the same wall-clock instant. | `tests/unit/hydi-v3/{DistributedCompute,HeartbeatSystem}.test.js` | **Fixed** — replaced the fixed sleeps with `Promise.race` against the actual event, generous 2s ceiling. |
| 11 | `npm run lint` was not wired into CI (`unit-tests.yml` only ran `npm test`), which is exactly how #1 went unnoticed for an unknown period. | `.github/workflows/unit-tests.yml` | **Fixed** — added a `Run ESLint` step before the test step. |
| 12 | 9x `no-case-declarations` (lexical `const`/`let` directly in a `switch case` without block braces) in `src/HYDISystem.js`, `pages/api/revenue/index.js`, `src/control/HeidiControlPlane.js`. | see files | **Fixed** — wrapped each case body in `{ }`. One instance in `HeidiControlPlane.js` was a real latent bug (see WORKLOG #6 for detail): two sibling cases would redeclare the same `const` name in shared scope had the author not already hand-rolled a `2`-suffix workaround; removed the workaround now that proper block scoping is in place. |
| 13 | 3x `no-prototype-builtins` — `.hasOwnProperty()` called directly on a plain object instead of `Object.prototype.hasOwnProperty.call(...)`, which throws if the target was ever created with `Object.create(null)`. | `lib/ActionParser.ts`, `lib/ModelManager.ts`, `src/enforcement/RuntimeEnforcer.js` | **Fixed**. |
| 14 | `lib/protoforge/policy-engine.js:257` had an empty `catch (_) {}` (`no-empty`) guarding per-callback failures during ProtoForge's realtime policy hot-reload. | `lib/protoforge/policy-engine.js` | **Investigated — confirmed intentional, not a bug** (isolates one bad reload callback from breaking the others). Gave it a named `err` + `console.warn` + explanatory comment so it's no longer a bare empty block. |
| 15 | `pages/index.tsx`, `pages/funding.tsx`, `pages/test-simple.tsx` used raw `<a href="/...">` for internal navigation instead of Next.js `<Link>`, forcing a full page reload instead of client-side routing (`@next/next/no-html-link-for-pages`). | `pages/*.tsx` | **Fixed** — swapped to `<Link>`. |
| 16 | 2x `react/no-unescaped-entities` — literal `"` in JSX text. | `components/song-composer/{MidiStatusBar,SongStructure}.tsx` | **Fixed** — escaped to `&quot;`. |

---

## Open / not addressed this session

| # | Issue | File(s) | Severity | Notes |
|---|-------|---------|----------|-------|
| 17 | ~150 `no-unused-vars` ESLint *warnings* across `src/`, `lib/`, `components/` (now that lint actually runs) — unused function args, unused destructured values, an unused `useEffect` import. | many, see `npm run lint` output | Low | Cosmetic/dead-parameter cleanup; large surface area, left out of this pass to keep the diff focused on correctness bugs. Good candidate for a dedicated follow-up pass, ideally file-by-file rather than a mechanical sweep since some `context`/`task` params are part of a shared handler signature contract. |
| 18 | `tests/unit/hydi-v3/WatchdogSupervisor.test.js` uses the same fixed-`setTimeout`-vs-own-interval pattern as the two tests fixed in #10, but was not observed to be flaky across several runs in this session. | `tests/unit/hydi-v3/WatchdogSupervisor.test.js` | Low | Same latent race risk as #10; left alone since it isn't currently failing and the mission favors minimal, verified diffs. Worth applying the same `Promise.race` treatment proactively in a follow-up. |

---

## Investigated, not a bug

- `lib/protoforge/policy-engine.js:257`'s empty catch — see #14 above.
- No other false positives found this session — every lint error surfaced
  during this pass corresponded to genuine broken behavior or genuinely
  dead/unreachable code.
