# Phase 27A.3 — CI Activation Report

**Date:** 2026-07-27
**Branch:** `phase21-scratch`
**Pull request:** https://github.com/waveformer1984/HYDI-System-v2/pull/243

## 1. Deliverables Completed

### 1.1 `CLAUDE.md` documentation

The unit/integration test split is already documented in `CLAUDE.md` under:

- **Commands** — `npm test` (unit gate) vs `npm run test:integration:jest` (operational integration suite).
- **CI / Workflows** — table of `unit-tests.yml` and `integration-tests.yml`, plus an explicit paragraph explaining *why* the two pipelines are intentionally separate.
- **Testing Layout** — directory tree showing `tests/integration/` is not discovered by the default `jest.config.js` `testMatch` and must be run explicitly.

The documentation states that both `npm test` and `npm run test:integration:jest` must pass before merging operational changes, and that `jest.config.js` and `npm test` should not be broadened to "simplify" this.

### 1.2 `package.json` script

```json
"test:integration:jest": "jest --testMatch=\"<rootDir>/tests/integration/**/*.test.js\" --runInBand --forceExit"
```

This script is present in `package.json` and was executed successfully during local validation.

### 1.3 `.github/workflows/integration-tests.yml`

Created at `.github/workflows/integration-tests.yml`:

```yaml
name: Integration Tests

on:
  push:
    branches: [clean-main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  integration-tests:
    name: HYDI V3 Operational Integration Suite
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Typecheck HYDI V3
        run: npm run typecheck:hydi-v3

      - name: Lint HYDI V3
        run: npm run lint:hydi-v3

      - name: Run operational integration suite
        run: npm run test:integration:jest
```

It mirrors `unit-tests.yml` conventions: same triggers (`clean-main` pushes and all PRs), same `actions/checkout@v7` and `actions/setup-node@v6` versions, `concurrency` group, `ubuntu-latest`, and `npm ci`.

## 2. Static Verification Performed

| Check | Method | Result |
| --- | --- | --- |
| YAML parses | Visual + structural review against `unit-tests.yml` | Pass — file is valid YAML and matches the known-good pattern |
| Actions versions match | Compare with `.github/workflows/unit-tests.yml` | Pass — `actions/checkout@v7`, `actions/setup-node@v6` |
| Referenced npm scripts exist | `npm run test:integration:jest` | Pass — executed below |
| `typecheck:hydi-v3` | `npm run typecheck:hydi-v3` | Pass |
| `lint:hydi-v3` | `npm run lint:hydi-v3` | Pass (0 errors, 19 pre-existing warnings) |
| Integration suite | `npm run test:integration:jest` | Pass — 12 suites / 62 tests |
| Unit suite | `npm test` | Pass — 203 suites / 2,046 tests |

The `lint:hydi-v3` command already includes `tests/integration/hydi-live-recovery.test.js` so the integration test file is linted by the same scoped command the workflow uses.

## 3. Evidence Collected

### 3.1 Local integration run

```bash
npm run typecheck:hydi-v3
npm run lint:hydi-v3
npm run test:integration:jest
```

Result:

```
Test Suites: 12 passed, 12 total
Tests:       62 passed, 62 total
Snapshots:   0 total
Time:        18.704 s
```

### 3.2 Full unit run

```bash
npm test
```

Result:

```
Test Suites: 203 passed, 203 total
Tests:       2046 passed, 2046 total
Snapshots:   0 total
Time:        143.993 s
```

### 3.3 Pull request opened

Branch `phase21-scratch` was pushed to origin and PR #243 was opened against `clean-main`:

- URL: https://github.com/waveformer1984/HYDI-System-v2/pull/243
- Diff: +32,517 / -233 lines across 250 files.

## 4. Issues Discovered

### 4.1 Pull request is not currently mergeable

GitHub reports:

```json
{
  "mergeable": false,
  "merge_state_status": null,
  "merge_commit_sha": null
}
```

`merge_state_status: null` indicates GitHub has not (or can not) computed a clean merge commit. No `pull_request`-triggered workflow runs have been dispatched for this branch (`gh api .../actions/runs?branch=phase21-scratch` returns an empty list, and `gh pr checks 243` reports `no checks reported`).

**Root cause:** `phase21-scratch` carries all of Phase 21–27A work and is 250 files / ~32k lines ahead of `clean-main`. The diff is large enough that GitHub is either still computing mergeability or has hit a conflict. The repository has a `pre-push` hook that runs the full `npm run lint` and `npm test` suite before accepting any push, so the local validation is already strong, but the remote CI gate is blocked until the PR becomes mergeable.

**Impact:** The first actual GitHub Actions run of `integration-tests.yml` could not be captured in this session.

### 4.2 Workflow is not yet visible in the default branch workflow list

`gh api repos/waveformer1984/HYDI-System-v2/actions/workflows` does not list `Integration Tests` because the workflow file is not on the default branch (`clean-main`) until the PR merges. This is expected; the workflow will appear and run once the PR is merged or becomes mergeable and the `pull_request` event fires.

## 5. Remaining Limitations

- **First GitHub Actions run is pending.** PR #243 must become mergeable before the `pull_request` event will dispatch `integration-tests.yml`. Once mergeable, the workflow should run `typecheck:hydi-v3`, `lint:hydi-v3`, and `test:integration:jest` and the run URL should be captured as operational evidence.
- **No runtime certification yet.** With CI not yet executing on GitHub's runners, the 24-hour soak test, failure-injection campaign, connector lifecycle validation, and production certification remain downstream work.
- **Branch size.** `phase21-scratch` is a long-lived integration branch. Future operational CI work may be easier if smaller, focused branches are opened against `clean-main` so workflows fire immediately and mergeability is easier to verify.

## 6. Conclusion

The CI activation infrastructure is in place and statically verified:

- `CLAUDE.md` documents the test split and merge expectations.
- `package.json` exposes `test:integration:jest`.
- `.github/workflows/integration-tests.yml` follows the same conventions as `unit-tests.yml`.
- Local validation of all three workflow commands passes.
- PR #243 is open.

The only unmet part of the phase is capturing the first successful GitHub Actions run, which is blocked by the PR's current `mergeable: false` state. The workflow and scripts are ready to run as soon as the mergeability issue is resolved.
