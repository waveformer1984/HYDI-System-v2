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

### Release Candidate Freeze

- All new feature phases are suspended for this release line
- Only bug fixes, security, reliability and documentation changes permitted
