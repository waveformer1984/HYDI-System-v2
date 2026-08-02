# RC3 Go / No-Go Report

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
