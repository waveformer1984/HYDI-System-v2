# Performance Regression Report

## Baseline

Baseline captured by `scripts/op-validation.js` on the `release/v0.9.0` branch. No previous historical baseline exists for comparison, so this report serves as the canonical `v0.9.0-rc.1` reference.

## Measurements

| Operation | Mean (ms) | Min (ms) | Max (ms) | Notes |
|-----------|-----------|----------|----------|-------|
| startup | 6.60 | 4.46 | 8.53 | ArchitectureGuard verify + instantiation |
| federation | 0.13 | 0.02 | 0.54 | FederationGateway contract list |
| marketplace | 0.05 | 0.02 | 0.11 | Capability sandbox register + execute |
| scheduling | 0.08 | 0.01 | 0.37 | NodeScheduler task assignment |
| recovery | 0.07 | 0.01 | 0.28 | RecoveryCoordinator strategy selection |
| snapshot | 2.68 | 2.37 | 2.98 | JSON snapshot write + read |
| throughput | 251.81 | 249.55 | 255.10 | ArchitectureGuard runs per 250 ms window |

## Full Test Suite Timing

- `npm test` (parallel): 243 suites, 2315 passed, 1 skipped, ~183 s
- `npm test -- --runInBand` (serial): 243 suites, 2315 passed, 1 skipped, ~175 s

No significant parallel slowdown; test suite is stable in both modes.

## Regression Policy

- A 10% increase in any operation mean against the stored baseline is flagged as a regression.
- This release is the first capture, so no regressions are detected.

## Storage

Baseline is saved locally to `data/op-validation.json`. This path is git-ignored; the canonical baseline for a release must be archived as an artifact.
