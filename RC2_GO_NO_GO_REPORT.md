# RC2 Go / No-Go Report

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
- Security review low-severity item resolved.

### Incomplete

- 24-hour wall-clock operational soak.
- Full clean-machine deployment (fresh OS, fresh npm install, no copied state).

## Mandatory Corrective Actions

1. Execute `SOAK_MS=86400000 node scripts/op-validation.js` in an unattended CI or dedicated host.
2. Verify no resource growth, no unexpected failures, and stable throughput over 24 hours.
3. Perform a full clean-machine installation (`npm install`, `npm test`, `hydi architecture verify`, manifest/snapshot/rollback) on a fresh host.
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
