# HYDI Changelog

## [Unreleased]

### Security

- Fixed 7 high-severity `brace-expansion` DoS advisories (GHSA-mh99-v99m-4gvg)
  across nested `eslint`/`glob`/`@typescript-eslint` toolchain dependencies
  (devDependencies only — `npm audit --omit=dev` was already 0 findings).
  Scoped each fix to the specific vulnerable parent version
  (`minimatch@3.1.5`, `minimatch@9.0.9`, `minimatch@10.2.5`) with a
  same-major patch bump (1.1.16→1.1.18, 2.1.2→2.1.4, 5.0.7→5.0.9) via
  targeted `package.json` `overrides`, rather than a blanket version pin —
  the latter is exactly what caused a real breakage documented in
  `ISSUES_FOUND.md` #2 (forcing every `brace-expansion` consumer onto an
  incompatible major version crashed `next lint`). Verified with a full
  `npm audit` (0 vulnerabilities), lint, typecheck, unit + integration
  test suites, and a real `npm run build`, all clean.

### Fixed

- `tests/unit/hydi-v3/HardwareDiscovery.test.js`'s OS-enumeration fallback
  test hardcoded a Windows-only mock (`powershell`/`AdapterRAM`) but
  `HardwareDiscovery.detectOsGpus()` dispatches by the *host* OS at runtime
  — on Linux (every `ubuntu-latest` CI runner, and any Linux/container
  deployment) it silently exercised the "unexpected command" branch and
  asserted a GPU count the mock never actually produced. The suite was
  failing on this branch's CI (`Unit Tests` red as of 2026-07-31/08-01,
  masked by an unrelated GitHub Actions runner outage — see `ROADMAP.md`).
  Pinned `os.platform()` to `win32` for the existing test and added
  dedicated coverage for the previously-untested `detectLinuxGpus()`
  (`lspci`) parsing path, which had zero coverage despite being the one
  actually exercised by CI's own Linux runners.

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
