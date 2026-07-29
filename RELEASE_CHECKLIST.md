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
- [ ] `hydi architecture verify` reports 100%

## Hardening

- [ ] `npm run soak-test` passes
- [ ] `npm run leak-test` passes
- [ ] `npm run determinism-test` passes
- [ ] `npm run baseline-test` passes

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
