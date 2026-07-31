# Final Release Decision

## Release Candidate

- **Version:** `v0.9.0-rc.3`
- **Commit:** `de9cbc1`
- **Branch:** `release/v0.9.0`

## Pre-Validation State

| Check | Result |
|-------|--------|
| `git rev-parse HEAD` | `3417fed2ec3688b3534742cd91606c6247043b9a` |
| `git describe --tags` | `v0.9.0-rc.3-1-g3417fed` |
| `git status --short` | clean |

## Engineering Validation

| Gate | Result |
|------|--------|
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

## Operational Evidence

| Gate | Status | Evidence |
|------|--------|----------|
| 24-hour wall-clock soak | **PENDING** | `FINAL_24H_OPERATIONAL_EVIDENCE.md` |
| True clean-machine deployment | **PENDING** | `FINAL_CLEAN_MACHINE_EVIDENCE.md` |

## Security Status

- `SignatureVerifier` now uses real Ed25519 signing/verification.
- `computeDigest()` now binds to nested permission objects.
- No high, medium or low severity findings in source review.

## Recommendation

**Option C — Continue blocking release of `v0.9.0`.**

The engineering and security gates are satisfied, but the two required operational proofs have not been collected. `v0.9.0` must not be approved until both `FINAL_24H_OPERATIONAL_EVIDENCE.md` and `FINAL_CLEAN_MACHINE_EVIDENCE.md` demonstrate a passing result.

## Required Next Steps

1. Execute the 24-hour soak on a dedicated host against `v0.9.0-rc.3`.
2. Execute the clean-machine deployment on a fresh VM or unused machine.
3. Update the evidence files with actual data.
4. Then select either **Option A** (approve `v0.9.0`) or **Option B** (create `v0.9.0-rc.4`) based on the evidence.

## Stable Promotion is Blocked

No `v0.9.0` tag has been created. No `v0.9.0-rc.4` tag has been created.
