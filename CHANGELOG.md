# HYDI Changelog

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
