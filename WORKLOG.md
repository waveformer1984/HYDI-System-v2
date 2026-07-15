# WORKLOG

Running log of autonomous production-readiness work. Newest entries first.

---

## 2026-07-15 — Production-readiness sweep: lint gate repair + real bug fixes

Branch: `claude/protoforge-production-readiness-t4wdn4`

Started from a clean `npm install` (0 vulnerabilities) and ran the full
verification triad (`typecheck`, `lint`, `test`) to find real, fixable
problems rather than speculative refactors.

### Found and fixed

1. **`npm run lint` was silently broken for nearly the entire Next.js app**
   (`pages/`, `components/`, most of `lib/`). Root cause:
   `.eslintrc.json` (added in the HYDI V3 Reliability & Autonomy PR,
   commit `2fd36cc`) set `"extends": ["eslint:recommended"]` with no
   Next.js/TypeScript parser, so every `.ts`/`.tsx` file and every ESM
   `.js` file failed to parse (`'import' and 'export' may appear only
   with 'sourceType: module'`). This wasn't caught before because CI's
   `unit-tests.yml` doesn't run lint, and a prior local check of the lint
   output was truncated (`| tail -100`) so the failures were invisible.
   Fixed with a scoped `overrides` block that applies `next/core-web-vitals`
   to `pages/`, `components/`, `lib/`, and `hooks/`.

2. **That fix immediately crashed with `TypeError: expand is not a
   function`** inside `@eslint/eslintrc`'s bundled `minimatch@3.1.5`.
   Root cause: `package.json`'s `overrides` field force-pinned
   `brace-expansion` globally to `>=5.0.6` (to patch
   GHSA-jxxr-4gwj-5jf2, a ReDoS bug scoped to brace-expansion
   5.0.0–5.0.5). But `brace-expansion@5.x` is a breaking rewrite with a
   different export shape than the `1.x` line every `minimatch@3.x`
   consumer (essentially the whole ESLint toolchain) expects, so the
   blanket override silently broke every one of them. `brace-expansion`
   1.x was never in the vulnerable 5.0.0–5.0.5 range, so the fix was to
   remove the blanket override entirely and let each consumer resolve its
   own compatible major version — `minimatch@3.x` → `brace-expansion@1.1.16`
   (safe, correct API), `minimatch@10.x` (from `@typescript-eslint`) →
   `brace-expansion@5.0.6+` (safe, correct API). Verified with
   `npm audit` (0 vulnerabilities before and after) and `npm ls
   brace-expansion`.

3. **With lint actually working, it surfaced real runtime bugs that had
   been invisible:**
   - `src/models/HybridModelStack.js` — `strategy` and `input` were
     `const`-declared inside a `try` block and referenced again inside
     the paired `catch` block (out of scope). Any failure during
     `execute()` or `executeLocal()` threw a *new*, unrelated
     `ReferenceError` from inside the error handler instead of the real
     error, and local-model fallback never actually ran. Fixed by
     hoisting the declarations above the `try` with `let`.
   - `src/control/OutcomeValidator.js:235` — typo `worSourceSource`
     instead of `worstSource` in a template literal. Silently threw
     inside a caught block, so the "lead source underperformance"
     adaptation suggestion was never returned whenever the interesting
     case (best source beats worst by 2x+) actually triggered.
   - `src/models/heartbeat.js` — two methods both named
     `checkModelHealth` (one aggregate/no-arg, one per-model). The
     second silently shadowed the first in the class body, so the
     periodic heartbeat (`start()`'s `setInterval`) actually called the
     per-model checker with `modelId=undefined` every 30s, and the real
     aggregate logic — failure-count tracking, `recoverFailedModels()`,
     `storeHeartbeatMetrics()`, the `heartbeat_check` event — was 100%
     dead code. Renamed the per-model method to
     `checkSingleModelHealth` and repointed `checkAllModels()` at it.
     Fixing this then exposed a second, previously-inert bug in the same
     method: `this.failedModels` was constructed as a `Set` but used
     with `Map`-only methods (`.get()`/`.set()`, and a `forEach((count,
     modelId) => …)` callback shape). Changed it to a `Map`.
   - `src/server.js` — `/cascade/quarantine/:eventId/release` referenced
     `approvedBy` (undefined) instead of the destructured `approved_by`
     from `req.body`; the endpoint threw on every call. Also, all five
     `/keymaker/*` admin routes (`status`, `keys` issue/revoke, `validate`,
     `audit`, kill-switch, break-glass) referenced a `keymaker` object
     that was never imported or instantiated — only the unrelated
     `SimpleKeymaker` (a separate, simpler tier-based gate) was wired up.
     The full `Keymaker` class already existed at
     `src/middleware/keymaker.js` with exactly the methods these routes
     call (`getStats`, `issueKey`, `revokeKey`, `validateKey`) and its
     own `middleware()` that populates `req.keymaker`. Imported,
     instantiated, and mounted it alongside `simpleKeymaker`.

4. **Archived 6 orphaned ESM-syntax files** under `src/` that were
   unreachable in practice (confirmed via repo-wide grep) and would have
   thrown `SyntaxError: Cannot use import statement outside a module` if
   anything had ever actually tried to load them via `require()`:
   `src/net/net.js`, `src/server-clean.js`, `src/services/persistence.js`,
   `src/db/dbRouter.js`, `src/db/local.sqlite.js`,
   `src/lib/supabaseClient.js`. Moved to
   `archive/src-esm-orphans/` following the existing archival convention
   (see `archive/heidi-v2-dormant-pipeline/README.md` and
   `archive/agents-specialized-orphans/README.md` for precedent); a
   README documents why each was safe to move. This also resolved the
   remaining ESLint parsing errors that weren't fixed by the
   `next/core-web-vitals` override (those files sit outside `pages/`,
   `components/`, `lib/`, `hooks/`).

5. **Fixed two flaky/racy tests** with the same root shape:
   `tests/unit/hydi-v3/DistributedCompute.test.js`'s `detects node
   timeout` and `tests/unit/hydi-v3/HeartbeatSystem.test.js`'s `detects
   missing heartbeat` each raced a fixed `setTimeout` against the
   engine's own internal interval tick landing at approximately the same
   wall-clock time, so the assertion could run before the tick that
   flips state. Replaced both fixed sleeps with `Promise.race` between
   the actual event and a generous 2s timeout.
   `WatchdogSupervisor.test.js` uses the same fixed-sleep pattern but
   wasn't observed to be flaky in several runs; left alone (see
   `ISSUES_FOUND.md`).

6. **Fixed the remaining 20 real ESLint errors** that the newly-working
   lint gate (item 1) surfaced across the wider codebase, so that `npm
   run lint` — now wired into CI (see below) — actually passes instead of
   immediately turning CI red:
   - `no-case-declarations` (9x, `src/HYDISystem.js`,
     `pages/api/revenue/index.js`, `src/control/HeidiControlPlane.js`) —
     lexical `const`/`let` directly in a `switch case` without block
     braces. One instance in `HeidiControlPlane.js` was a real latent
     bug: two sibling cases would have redeclared the same `const` name
     in the same scope (a `SyntaxError`) had the author not already
     worked around it by manually suffixing the second case's variables
     (`currentWeight2`, `newWeight2`). Wrapped each case body in `{ }`
     and removed the suffix hack.
   - `no-prototype-builtins` (3x, `lib/ActionParser.ts`,
     `lib/ModelManager.ts`, `src/enforcement/RuntimeEnforcer.js`) —
     `obj.hasOwnProperty(x)` called directly instead of
     `Object.prototype.hasOwnProperty.call(obj, x)` (would throw if
     `obj` were ever `Object.create(null)`).
   - `react/no-unescaped-entities` (2x, `MidiStatusBar.tsx`,
     `SongStructure.tsx`) — literal `"` in JSX text, escaped to `&quot;`.
   - `@next/next/no-html-link-for-pages` (4x, `pages/index.tsx`,
     `pages/funding.tsx`, `pages/test-simple.tsx`) — raw `<a href="/...">`
     for in-app navigation forces a full page reload; swapped for
     Next.js `<Link>`.
   - `no-empty` (1x, `lib/protoforge/policy-engine.js`) — an empty
     `catch (_) {}` guarding per-callback failures during ProtoForge's
     realtime policy hot-reload. Confirmed intentional (isolates one bad
     reload callback from breaking the others), not a bug; gave it a
     named `err` and a `console.warn` plus a comment instead of leaving
     it silently empty.

7. **Wired `npm run lint` into CI** (`unit-tests.yml`), now that it's
   actually meaningful and passing, so a regression like item 1 can't
   land silently again.

8. **Found `.githooks/pre-push` was never actually executable.** The
   file was committed to git with mode `100644` instead of `100755`, so
   it has silently no-op'd on every push in every clone since it was
   added — CLAUDE.md describes it as load-bearing precisely because
   GitHub Actions once sat stuck `queued` for 24+ hours, but the local
   fallback it documents was never actually running. Confirmed directly:
   this session's own `git push` printed "the hook was ignored because
   it's not set as executable." Fixed with `chmod +x` (git tracks the
   mode change), and added a `lint` step to the hook itself (it only ran
   typecheck + test before) so local pushes match the CI gate.

### Verification

- `npm install` — 0 vulnerabilities, before and after.
- `npm run typecheck` — clean.
- `npm run lint` — went from silently non-functional (parsing errors on
  ~60 files, one hard crash) to `exit 0`, 0 errors, warnings only
  (pre-existing `no-unused-vars` style items, out of scope for this pass).
- `npm run lint:hydi-v3` — unaffected, still clean.
- `npm test` — 129/129 suites, 1344/1344 tests passing, stable across 3
  consecutive full runs (was 128/129, 1343/1344 before the flaky-test
  fixes).

### Not done in this pass (see ISSUES_FOUND.md / ROADMAP.md)

- The remaining ESLint *warnings* (unused vars/args across `src/`) are
  numerous but low-severity; left alone to keep this diff focused on
  correctness bugs and the broken lint gate itself.
- Did not add `lint` to CI (`unit-tests.yml`) in this pass — recommend
  doing so now that it's actually meaningful, as a follow-up.
