# RC3 Go / No-Go Report

## Recommendation

**Option C — Block release of `v0.9.0`.**

`v0.9.0-rc.3` passes all engineering and regression gates, but the two operational evidence gates required for a stable release have not been completed.

## Candidate

- Commit: `de9cbc1`
- Tag: `v0.9.0-rc.3`
- Branch: `release/v0.9.0`

## Gate 1 — 24-Hour Wall-Clock Soak

Status: **NOT EXECUTED**

Evidence: `FINAL_24H_SOAK_RESULTS.md`

Required command:

```bash
SOAK_MS=86400000 SOAK_ITERS=99999999 node scripts/op-validation.js
```

## Gate 2 — Clean Machine Deployment

Status: **NOT EXECUTED**

Evidence: `FINAL_CLEAN_DEPLOYMENT_RESULTS.md`

Required command:

```bash
git checkout v0.9.0-rc.3
npm ci
npm test
```

## Gate 3 — Final Regression Confirmation

Status: **PASS**

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run architecture-test` | PASS |
| `npm run invariant-test` | PASS |
| `npm run rc1-test` | PASS |
| `npm run rc2-test` | PASS |
| `npm run soak-test` | PASS |
| `npm run leak-test` | PASS |
| `npm run determinism-test` | PASS |
| `npm run baseline-test` | PASS |
| `npm test` (parallel) | PASS — 244 suites, 2320 passed, 1 skipped |
| `npm test -- --runInBand` | PASS — 244 suites, 2320 passed, 1 skipped |
| `hydi architecture verify` | PASS — 100% |

## Security State

- `SignatureVerifier` now performs real Ed25519 signing/verification.
- `computeDigest()` now recursively binds nested permission objects.
- No high, medium or low severity findings remain at the source level.

## Known Limitations

- 24-hour wall-clock operational validation not yet completed.
- True clean-machine deployment not yet completed.
- OS-level plugin containerization is a deployment responsibility.

## Decision

Do not promote `v0.9.0-rc.3` to `v0.9.0`.

Complete Gate 1 and Gate 2 in a dedicated environment, then re-evaluate. If either gate produces operational or reproducibility failures, create `v0.9.0-rc.4` with the fix and re-run the affected gate.
