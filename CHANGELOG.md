# HYDI Changelog

## [0.9.0-rc.5] — Release Candidate 5

### Fixed

- `.npmignore` now excludes `node_modules/`, `.next/`, `apps/`, `heidi-core/`, `*.bundle`, and runtime artifacts, reducing the npm tarball from ~170 MB to ~2.7 MB.
- `database.js` no longer logs the `SUPABASE_SERVICE_ROLE_KEY` prefix at boot.

### Changed

- Package version bumped to `0.9.0-rc.5`.

## [Unreleased]

### Fixed

- `tests/unit/hydi-v3/HardwareDiscovery.test.js`'s Windows-fallback test asserted
  behavior specific to `os.platform() === 'win32'` without mocking `platform()`,
  so on any non-Windows CI runner (`unit-tests.yml` runs on `ubuntu-latest`) it
  exercised the Linux `lspci` fallback path instead and always failed. Latent
  since the test was added; now mocks `os.platform()` so the assertion is
  deterministic on every host.
- `tests/unit/hydi-v3/{HeartbeatSystem,DistributedCompute,WatchdogSupervisor}.test.js`'s
  timer-driven tests raced a fixed sleep against each engine's own internal
  interval timer, flaking under full-suite parallel load. Now await the real
  `EventEmitter` event instead.

### Security

- Patched `ip-address` (SSRF/trust-boundary bypass advisories, a transitive
  dependency of the production `express-rate-limit` package used across every
  rate-limited route) and `undici` via `npm audit fix`. `package.json` version
  ranges unchanged; only lockfile resolutions moved. The remaining
  `brace-expansion` advisory (transitive via `@typescript-eslint/*`, dev
  tooling only) is left unresolved — forcing it via an `overrides` pin
  previously broke `next lint` (`ISSUES_FOUND.md` #2) and npm has no
  non-breaking resolution path for it yet.

## [0.9.0-rc.1] — Release Candidate

### Added

- ArchitectureGuard with 10 executable invariants (100% score)
- ServiceContract coverage across all public subsystems
- Automated plugin permission verification
- SoakHarness for long-duration stability testing
- ResourceAuditor for memory, handle and listener leak detection
- PerformanceBaseline capture and regression comparison
- DeterminismGuard for output stability validation
- Release documentation: operator runbook, disaster recovery, performance baseline, known limitations

### Changed

- `CapabilityBroker` and `FederationGateway` now expose versioned service contracts
- `InvariantRegistry` includes runtime `CapabilitySandbox` permission validation
- Package version moved to `0.9.0-rc.1`

## [0.9.0-rc.2] — Release Candidate 2

### Added

- `scripts/op-validation.js` for reproducible soak and performance baseline capture
- `FederationReplay` tests for duplicate/expired message handling
- RC2 validation reports: `RC2_24H_SOAK_REPORT.md`, `CLEAN_DEPLOYMENT_REPORT.md`, `RC2_GO_NO_GO_REPORT.md`

### Security

- `FederationGateway` now enforces message `id`, `timestamp`, `expiresAt` and a replay window
- Duplicate federation messages are rejected and audited
- Expired federation messages are rejected and audited

### Changed

- `SECURITY_REVIEW.md` updated to reflect resolved replay hardening
- Package version moved to `0.9.0-rc.2`

### Release Candidate Freeze

- All new feature phases are suspended for this release line
- Only bug fixes, security, reliability and documentation changes permitted

## [0.9.0-rc.3] — Release Candidate 3

### Security

- `SignatureVerifier` now performs real Ed25519 signing/verification against publisher public keys
- `computeDigest()` uses recursive canonical serialization so digests bind to nested `requiredPermissions` and `dependencies`
- Forged signatures and altered post-signing capabilities are rejected

### Changed

- `scripts/phase40-acceptance.js` generates and registers a real publisher keypair
- `SECURITY_REVIEW.md` and `RC2_GO_NO_GO_REPORT.md` corrected to document the finding and resolution
- Package version moved to `0.9.0-rc.3`

### Notes

- `v0.9.0-rc.3` supersedes `v0.9.0-rc.2` because `c8aaaaa` adds a security fix not present at the `v0.9.0-rc.2` tag
- 24-hour soak and clean-machine deployment must be re-run against this release candidate

## [0.9.0-rc.4] — Release Candidate 4

### Security

- Merged the `v0.9.0-rc.4` critical security remediation line (`dac88cd`) into `release/v0.9.0`: hardened revenue API, guarded simulated KMS key custody, fixed HEIDI auth (`b86956f`), with new unit tests `kms-key-custody.test.js` and `revenue-api.test.js`
- `src/database.js` no longer logs a partial `SUPABASE_SERVICE_ROLE_KEY` prefix at boot

### Fixed

- `src/database.js` now loads `.env.local` and `.env` via `path.resolve`, so `npm run server` boots from file config without shell-exported variables
- Dependency vulnerabilities resolved via `npm audit fix` (postcss, undici)

### Changed

- Added `.npmignore`: release package reduced from 171 MB to under 5 MB by excluding runtime state (`data/`, `artifacts/`, `coverage/`, `_diag/`), Rezonate audio masters/stems, audit paperwork, and tool config directories
- `README.md` points environment setup at `CLAUDE.md` and clarifies `setup.sh` as Termux-only
- Package version moved to `0.9.0-rc.4` (`package.json`, `VERSION`)

### Notes

- The pre-existing `v0.9.0-rc.4` tag (`dac88cd`) predates this merge and version bump; the release tag must be re-cut (or superseded by `v0.9.0-rc.5`) after validation re-runs
- Phase 1–12 release audit deliverables recorded in `docs/audit/` and the report set accompanying `Executive_Summary.md`
