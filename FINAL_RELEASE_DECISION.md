# Final Release Decision

> ## ERRATUM — 2026-08-02 (Validation Tooling Audit)
>
> **Two gate entries in this report are inaccurate. They are corrected here; the original text below is preserved unaltered for audit purposes.**
>
> When this report was produced, `package.json` defined the script keys `soak-test` and `leak-test` **twice each**. JSON parsing keeps only the last occurrence, so the commands recorded below did not run the tools their names imply:
>
> | Entry in this report | What actually executed |
> |---|---|
> | `npm run soak-test` — PASS | `jest tests/unit/hydi-v3/RC2Hardening.test.js -t "Soak harness"` — a ~280 ms unit test of soak-harness *logic*. The endurance script `scripts/soak-test.js` did **not** run. |
> | `npm run leak-test` — PASS | `jest tests/unit/hydi-v3/RC2Hardening.test.js -t "Resource auditor"` — **not** the `ProductionReliability` "Resource leak detector" test the name implies. |
>
> **Corrected classification for both entries: VERIFIED (unit test only).** Neither is operational soak or leak evidence. Sustained endurance and resource-leak behaviour were **NOT TESTED** as of this report.
>
> The duplicate keys were removed on 2026-08-02. Each command now has exactly one implementation: `soak-test-24h` (endurance script) vs `soak-harness-test` (unit test), and `resource-leak-test` vs `resource-auditor-test`. See `docs/audit/VALIDATION_TOOL_AUDIT_REPORT.md`.

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
