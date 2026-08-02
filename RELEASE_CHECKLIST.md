# Release Checklist — v0.9.0-rc.1

## Pre-Release

- [ ] Branch created: `release/v0.9.0`
- [ ] Version bumped to `0.9.0-rc.1`
- [ ] No experimental or feature commits in branch

## Build & Type

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (if available)

## Architecture

- [ ] `npm run architecture-test` passes
- [ ] `npm run invariant-test` passes
- [ ] `npm run rc1-test` passes
- [ ] `npm run rc2-test` passes
- [ ] `node scripts/hydi-cli.js architecture verify` reports 100%

## Hardening

- [ ] `npm run soak-harness-test` passes — unit test of soak-harness logic (seconds)
- [ ] `npm run resource-auditor-test` passes — unit test of the RC2 resource auditor
- [ ] `npm run resource-leak-test` passes — unit test of the resource leak detector
- [ ] `npm run determinism-test` passes
- [ ] `npm run baseline-test` passes
- [ ] `npm run validation-audit` passes — verifies the validation tooling itself is accurate

## Operational Evidence

These are long-running and are **not** covered by the unit tests above. Record the
generated report path against each.

- [ ] `npm run soak-test-24h` — 24-hour endurance run. Evidences availability,
      latency and resource trends. Does **not** evidence recovery.
- [ ] `npm run soak-test-24h:chaos` — endurance plus real failure injection.
      Required before claiming any resilience or recovery property.
- [ ] `npm run production-certification` — full operational qualification.
      Note: resilience criteria report `NOT TESTED` unless `--chaos` is passed.

## Full Test Suite

- [ ] `npm test` passes (parallel)
- [ ] `npm test -- --runInBand` passes (serial)

## CLI

- [ ] `node scripts/hydi-cli.js architecture verify` passes
- [ ] `node scripts/hydi-cli.js export-manifest` succeeds
- [ ] `node scripts/hydi-cli.js verify` succeeds
- [ ] `node scripts/hydi-cli.js snapshot` succeeds

## Documentation

- [ ] `CHANGELOG.md` updated
- [ ] `RELEASE_NOTES_RC1.md` complete
- [ ] `OPERATOR_RUNBOOK.md` complete
- [ ] `DISASTER_RECOVERY.md` complete
- [ ] `PERFORMANCE_BASELINE.md` complete
- [ ] `KNOWN_LIMITATIONS.md` complete
- [ ] `VERSION_COMPATIBILITY.md` complete
- [ ] `SECURITY_MODEL.md` complete
- [ ] `API_REFERENCE.md` complete
- [ ] `RELEASE_CHECKLIST.md` complete

## Final

- [ ] Commit tagged `v0.9.0-rc.1`
- [ ] `RELEASE_REPORT_v0.9.0.md` generated
- [ ] Human sign-off obtained
