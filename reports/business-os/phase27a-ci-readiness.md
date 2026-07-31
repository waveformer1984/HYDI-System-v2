# Phase 27A.2 — Continuous Integration Integrity

**Date:** 2026-07-27
**Branch:** `phase21-scratch`
**Scope:** CI verification pipeline only. No production code changed, no test behavior changed — only what CI executes.

## 1. Objective

Phase 27A.1 established that the operational integration suite (12 Jest
suites, 62 tests, `tests/integration/**`) is deterministic, hermetic, and
platform-independent. It was never wired into CI. A build could go green on
`unit-tests.yml` while the entire operational readiness suite silently never
ran. This phase closes that verification gap without touching production
code or changing what `npm test` covers.

## 2. CI Coverage Before This Phase

| Workflow | Runs | Does not run |
| --- | --- | --- |
| `unit-tests.yml` | `npm run lint`, `npm test -- --coverage --forceExit` | Nothing under `tests/integration/**`; no typecheck |

`jest.config.js`'s `testMatch` only discovers `tests/unit/**`, `__tests__/**`,
and `tests/migrations/**` (confirmed by direct inspection — see Phase 27A.1's
`phase27a-test-integrity.md`, §7). `tests/integration/**` was reachable only
via manual `--testMatch` overrides that no CI job invoked. `npm run
typecheck:hydi-v3` and `npm run lint:hydi-v3` were also not part of any
workflow — they existed as local developer commands only.

## 3. Gap Removed

A passing `unit-tests.yml` run was evidence of unit-level code correctness
only. It was never evidence that:
- HYDI V3 typechecks (`tsconfig.typecheck.json`)
- HYDI V3's own lint scope (`eslint src/hydi-v3 ...`) is clean
- The 62-test operational integration suite — the tests that actually boot
  `OperatorSession`/`HYDIContinuousRuntime` and exercise sensor → signal →
  memory → recommendation → approval → execution → audit end to end — still
  passes

That gap is now closed: all three now run automatically on every push and
PR to `clean-main`.

## 4. Workflows Added / Changed

### 4.1 New: `.github/workflows/integration-tests.yml`

Mirrors `unit-tests.yml`'s existing structure and action versions exactly
(`actions/checkout@v7`, `actions/setup-node@v6`, Node 20, `npm ci`) so it
introduces no new CI patterns to reason about. Runs:

```bash
npm run typecheck:hydi-v3
npm run lint:hydi-v3
npm run test:integration:jest
```

Triggers on `push` to `clean-main` and on every `pull_request`, same as
`unit-tests.yml`, with the same `concurrency` cancel-in-progress group so a
new push supersedes an in-flight run rather than queuing behind it.

No `env:` block is set and no secrets are referenced — this is deliberate.
The suite must stay hermetic; if it ever needs a real credential to pass,
that would be a regression in the suite's own hermeticity, not a workflow
configuration to fix.

### 4.2 Unchanged: `.github/workflows/unit-tests.yml`

Not modified. `npm test` continues to discover exactly what it discovered
before this phase.

### 4.3 Unchanged: `jest.config.js`

Not modified. `testMatch` still excludes `tests/integration/**`. This is
intentional — see §6.

## 5. package.json

One new script, no existing script changed:

```json
"test:integration:jest": "jest --testMatch=\"<rootDir>/tests/integration/**/*.test.js\" --runInBand --forceExit"
```

This replaces the fragile inline `--testMatch` override every prior phase
(including Phase 27A.1's own verification commands) had to pass by hand on
the command line.

## 6. Why Two Workflows, Not One

`jest.config.js`'s `testMatch` was deliberately left untouched rather than
broadened to include `tests/integration/**`. Folding integration discovery
into the default `testMatch` would have:

- Silently increased every developer's local `npm test` runtime (unit tests
  run in ~132s; the integration suite adds another ~17-25s and a different
  failure surface — see the earlier note on Phase 27A.1's hardware-dependent
  timing assertions in `hydi-v3-console-integration.test.js`)
- Merged two test suites with different hermeticity guarantees and different
  purposes (fast per-module correctness vs. full-stack operational
  behavior) into one undifferentiated `npm test` run
- Made it harder, not easier, to tell from a CI failure *which* class of
  problem broke: a unit regression or an operational-integration regression

Keeping them as two workflows means a red `integration-tests.yml` is
immediately legible as "operational readiness regressed," distinct from a
red `unit-tests.yml` meaning "a module broke."

## 7. Validation

All commands run directly in this session, in order, on the current
`phase21-scratch` HEAD:

| Command | Result | Wall time |
| --- | --- | --- |
| `npm run typecheck:hydi-v3` | Pass | ~4.8s |
| `npm run lint:hydi-v3` | Pass — 0 errors, 19 pre-existing warnings (unchanged baseline; none in files touched this phase) | ~10.2s |
| `npm test` | **203 suites / 2,046 tests passed** | ~132.4s (2m16s) |
| `npm run test:integration:jest` | **12 suites / 62 tests passed** | ~16.6s (21.4s wall, includes Jest startup) |

The new `integration-tests.yml` workflow was validated **statically**, not
by an actual GitHub Actions run (no `act`/local runner or `actionlint`
binary was available in this environment):

- Parsed with `js-yaml` (already a project dependency) — valid YAML,
  correct nested structure (`on`/`jobs`/`steps`).
- Diffed structurally against the known-good, already-running
  `unit-tests.yml`: identical `on.push.branches`/`on.pull_request` shape,
  identical `concurrency` block, identical `checkout`/`setup-node` action
  versions and `with:` parameters. It reuses `unit-tests.yml`'s exact
  boilerplate rather than inventing new syntax, which is the practical
  limit of confidence achievable without actually dispatching a workflow
  run on GitHub.
- Every `run:` step invokes an npm script that was independently confirmed
  to pass in this same environment (table above) — the workflow does not
  introduce any command that hasn't already been verified to succeed.

**This is a real limitation, not a formality**: the workflow's correctness
on GitHub's actual `ubuntu-latest` runner (network conditions, `npm ci`
against the real lockfile, actions marketplace resolution) is not something
this local session can observe. It should be watched on its first real run
after this commit merges.

## 8. Remaining Limitations

- **First real CI run unverified.** As above — static validation and local
  command verification give high confidence, but the workflow has not
  actually executed on GitHub's infrastructure yet.
- **`hydi-v3-console-integration.test.js`'s hardware-dependent performance
  assertions** (`startupMs < 2000`, `briefingMs < 500`, `refreshMs < 250`,
  documented in Phase 27A.1's report) now run in CI for the first time via
  `integration-tests.yml`. They passed locally; GitHub-hosted runners are
  frequently slower or noisier than local hardware, so this is the most
  likely source of a first-run flake. If it flakes, the fix is to relax or
  relocate those specific assertions — not to disable the workflow.
- **`tests/hdi-adversarial.test.js` / `tests/hdi-everything-wrong.test.js`**
  remain outside both CI workflows, as documented in `CLAUDE.md`'s Testing
  Layout section. They require live `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  and were explicitly out of scope for a hermetic CI gate — this is a
  pre-existing, intentional gap, not one introduced or hidden by this phase.
- **`FaultyConnector`'s ~3s retry backoff** (documented in Phase 27A.1) is
  now part of the CI-timed path via `hydi-live-recovery.test.js`. It is
  correct production behavior, not a defect, but it is the single slowest
  test in the integration suite.

## 9. Recommendations

1. After this commit reaches `clean-main`, confirm the first real
   `integration-tests.yml` run on GitHub Actions succeeds before treating
   this gap as fully closed — static validation is not a substitute for one
   real run.
2. If GitHub-hosted-runner variance causes the performance assertions in
   `hydi-v3-console-integration.test.js` to flake, move those specific
   assertions to a separate, non-blocking job rather than loosening them
   silently or removing them from the blocking path entirely.
3. Consider adding branch protection requiring `integration-tests.yml` to
   pass on `clean-main`, matching whatever protection `unit-tests.yml`
   already has — a workflow that exists but isn't required doesn't close
   the verification gap, it just makes the gap visible.
4. No changes recommended to `tests/hdi-adversarial.test.js` /
   `tests/hdi-everything-wrong.test.js` — their live-Supabase dependency is
   a legitimate reason to keep them out of both CI workflows described here.

## 10. Success Criteria — Status

- [x] Unit tests continue to run exactly as before — `unit-tests.yml` and
      `jest.config.js` both unmodified.
- [x] Integration tests have their own first-class CI workflow —
      `integration-tests.yml`.
- [x] Operational readiness is automatically verified on every relevant
      change — pending the first real CI run (§8).
- [x] CI status will now reflect both code correctness (`unit-tests.yml`)
      and operational correctness (`integration-tests.yml`) as two
      separately legible signals.
- [x] No production behavior changes — only `package.json` (one new
      script), a new workflow file, and documentation were touched.
