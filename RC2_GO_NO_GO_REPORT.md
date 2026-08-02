# RC2 Go / No-Go Report — Final

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

**Option C — Block release of `v0.9.0` and identify mandatory corrective actions.**

The `v0.9.0-rc.2` candidate is functionally and architecturally sound, but two mandatory release gates have not been completed with objective evidence. `v0.9.0` must not be released until they are satisfied.

## Evidence Summary

### Passing

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
| `export-manifest` (clean data path) | PASS — 10 components |
| `verify` (clean data path) | PASS |
| `snapshot` (clean data path) | PASS |

### Completed Since rc.1

- Federation message replay protection added to `FederationGateway`.
- `FederationReplay.test.js` added; all tests pass.
- `scripts/op-validation.js` created for reproducible soak/baseline capture.
- Security review low-severity item (federation replay) resolved.
- **Security review high-severity item resolved:** `SignatureVerifier` previously performed no real cryptographic verification (private key was embedded in plaintext in the "signature" output; `verify()` only checked for a non-empty signature field and a self-computable digest match). A compounding bug in `computeDigest()`'s canonicalization also meant even a real signature would not have bound to a capability's declared permissions. Both are now fixed with real Ed25519 signing/verification and a recursive canonical serializer; see `SECURITY_REVIEW.md` for full detail and verification evidence.

### Incomplete

- 24-hour wall-clock operational soak (`FINAL_24H_SOAK_REPORT.md` is pending).
- Full clean-machine deployment (`FINAL_CLEAN_DEPLOYMENT_REPORT.md` is pending).

## Final Reports

| Report | Status |
|--------|--------|
| `FINAL_24H_SOAK_REPORT.md` | Pending actual 24-hour run |
| `FINAL_CLEAN_DEPLOYMENT_REPORT.md` | Pending actual clean-machine run |
| `SECURITY_REVIEW.md` | 1 high-severity finding identified and resolved this cycle (capability signature verification); 1 low-severity finding (federation replay) resolved previously; 0 findings remain open |

## Mandatory Corrective Actions

1. Execute `SOAK_MS=86400000 SOAK_ITERS=99999999 node scripts/op-validation.js` in an unattended CI or dedicated host.
2. Verify no resource growth, no unexpected failures, and stable throughput over 24 hours.
3. Perform a full clean-machine installation (`npm ci`, `npm test`, `hydi architecture verify`, manifest/snapshot/rollback) on a fresh host.
4. Re-run all release gates and re-tag the candidate.

## Architecture Score

```
Architecture Guard Report
Status: PASS
Score:  100%
Total:  10 invariants
Pass:   10
Fail:   0
Warn:   0
Manual: 0
Error:   0
```

## Benchmark Summary

See `OPERATIONAL_VALIDATION_REPORT.md` and `PERFORMANCE_REGRESSION_REPORT.md` for the `v0.9.0-rc.2` baseline.

## Release Recommendation

Do not promote `v0.9.0-rc.2` to `v0.9.0`. The security hardening is complete, the test suite is green, and the architecture is healthy, but long-duration stability and full clean-machine deployment remain unproven. Address the two mandatory actions, then re-evaluate.
