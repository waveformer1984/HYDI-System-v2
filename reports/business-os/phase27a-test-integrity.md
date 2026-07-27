# Phase 27A.1 — Operational Test Integrity Report

**Date:** 2026-07-27
**Branch:** `phase21-scratch`
**Scope:** HYDI System v3 operational and integration test suite

## 1. Scope of Review

- All `tests/integration/**/*.test.js` Jest suites (12 suites, 62 tests).
- `tests/hdi-adversarial.test.js` (Node script invoked by `npm run test:integration`).
- `jest.config.js` test discovery rules.
- `.github/workflows/unit-tests.yml` CI configuration.
- `package.json` test scripts.

Validation commands executed:

```bash
npm run typecheck:hydi-v3
npm run lint:hydi-v3
npm test
npx jest --testMatch="<rootDir>/tests/integration/**/*.test.js" --runInBand
```

## 2. Validation Results

| Command | Result |
| --- | --- |
| `npm run typecheck:hydi-v3` | Pass |
| `npm run lint:hydi-v3` | Pass (0 errors, 19 pre-existing warnings) |
| `npm test` (unit gate) | 203 suites passed, 2,046 tests passed |
| `npx jest tests/integration/**/*.test.js` | 12 suites passed, 62 tests passed |

## 3. Production Defects Found

None. Every failure traced to a test-side assumption, not production behavior.

## 4. Test Defects Found and Fixed

### 4.1 `tests/integration/hydi-live-recovery.test.js` — non-hermetic credential test

- **Category:** Test bug
- **Symptom:** `missing credentials leave tier 2 connectors not_configured` failed because ambient environment variables (`STRIPE_SECRET_KEY`, and potentially `GITHUB_TOKEN` or email/Google credentials) caused the tier 2 connectors to report `configured` instead of `not_configured`.
- **Fix:** Added a `beforeEach`/`afterEach` pair that snapshots and removes the relevant credential keys from `process.env`, then restores them after each test.
- **File changed:** `tests/integration/hydi-live-recovery.test.js`

### 4.2 `tests/integration/hydi-live-recovery.test.js` — timing assumption in filesystem recovery

- **Category:** Test bug
- **Symptom:** `filesystem connector recovers after root is restored` expected the runtime to be `DEGRADED` after a 1.2 s sleep. The runtime's `healthIntervalMs` defaulted to 10 s, so the health loop had not evaluated connector health yet.
- **Fix:** Injected `healthIntervalMs: 100` in the test's `HYDIContinuousRuntime` constructor. The 1.2 s wait now covers many health evaluations and is deterministic.
- **File changed:** `tests/integration/hydi-live-recovery.test.js`

### 4.3 `tests/integration/hydi-live-recovery.test.js` — cleanup gaps

- **Category:** Improvement opportunity
- **Observation:** `dataPath` and `runtime` were not reset between tests, and `process.env` was not isolated.
- **Fix:** Reset `dataPath` and `runtime` to `null` in `afterEach` and added the credential snapshot/restore logic described in 4.1.
- **File changed:** `tests/integration/hydi-live-recovery.test.js`

## 5. Audit of Other Integration Tests

All remaining integration test suites were reviewed for the requested failure modes:

- `hydi-live-operation-failures.test.js`
- `hydi-morning-executive-simulation.test.js`
- `hydi-operational-demo.test.js`
- `hydi-operational-failure-modes.test.js`
- `hydi-operator-approval-flow.test.js`
- `hydi-operator-mistakes.test.js`
- `hydi-production-failure-modes.test.js`
- `hydi-recovery.test.js`
- `hydi-trust-integrity.test.js`
- `hydi-v3-console-integration.test.js`
- `hydi-v3-integration.test.js`

None were found to depend on real API keys, cloud services, live accounts, ambient credentials, or the state of the local repository. All use isolated temporary directories and clean up in `afterEach`. No additional code changes were required.

## 6. Operational Risks (Documented, Not Fixed)

### 6.1 Machine-dependent performance thresholds in `hydi-v3-console-integration.test.js`

The `performance` test asserts `startupMs < 2000`, `briefingMs < 500`, and `refreshMs < 250` using real `Date.now()` deltas. These thresholds are machine-dependent. They passed on this hardware but may flake on slower CI runners or under load.

**Recommendation:** Move absolute timing assertions to a dedicated performance job or measure against an earlier baseline within the same run.

### 6.2 `FaultyConnector` retry duration in `hydi-live-recovery.test.js`

`FaultyConnector` intentionally triggers `ConnectorLifecycle.withRetry`, which waits through `baseDelayMs` backoffs. The `faulty connector degrades but does not crash startup` test therefore takes ~3 s. This is correct production behavior and was not changed.

## 7. Jest Discovery Analysis

`jest.config.js` `testMatch` includes:

- `tests/unit/**/*.test.{js,ts}`
- `__tests__/**/*.test.js`
- `tests/migrations/**/*.test.js`

It explicitly excludes `tests/integration/**/*.test.js`.

`package.json` defines:

- `"test": "jest"` — uses `jest.config.js`; does not discover integration tests.
- `"test:integration": "node tests/hdi-adversarial.test.js"` — runs the Supabase-dependent adversarial Node script only.
- `"test:integration:hydi-v3": "jest tests/integration/hydi-v3-integration.test.js --testMatch=\"**/*.test.js\" --runInBand --forceExit"` — runs a single integration file via a glob override.

**Verdict:** The exclusion is accidental. No documentation or workflow intentionally skips the full Jest integration suite. The PR template references `npm run test:integration`, which does not cover the 12 Jest integration suites that now pass.

## 8. CI Recommendations

1. Add a dedicated workflow (for example `.github/workflows/integration-tests.yml`) that runs the hermetic Jest integration suite:

   ```bash
   npx jest --testMatch="<rootDir>/tests/integration/**/*.test.js" --runInBand --forceExit
   ```

   This suite requires no cloud credentials and can run on every PR.

2. Keep `npm test` as the fast unit gate. Do not silently modify `jest.config.js` `testMatch`; that would fold integration tests into the default unit run and change repository-wide behavior without explicit notice.

3. Add an explicit npm script to avoid fragile `--testMatch` overrides:

   ```json
   "test:integration:jest": "npx jest --testMatch=\"<rootDir>/tests/integration/**/*.test.js\" --runInBand --forceExit"
   ```

4. Update the PR template testing checklist to distinguish:
   - `npm test` — unit/migration tests
   - `npm run test:integration` — live-env Supabase adversarial tests
   - `npm run test:integration:jest` — hermetic Jest integration suite

## 9. Remaining Risks

- Performance timing assertions in `hydi-v3-console-integration.test.js` may flake on slower hardware.
- `FaultyConnector` registration in `ConnectorRegistry` is global and persists for the test process. It does not conflict with current tests but could collide with a future `faulty` connector name.
- `tests/hdi-adversarial.test.js` still requires live `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which is appropriate for its role but means it cannot run in a cold environment.

## 10. Conclusion

The Jest integration suite is now hermetic and deterministic. The two red tests in `hydi-live-recovery.test.js` were caused by test-side environment leakage and timing assumptions; no production code was modified to make them pass. The outstanding gap is CI coverage: the integration suite passes locally but is not discovered by `npm test` and is not executed in the existing `unit-tests.yml` workflow.
