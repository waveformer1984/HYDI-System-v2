# HYDI Performance Baseline

## Captured Metrics

The `PerformanceBaseline` module captures:

- `startup` — time to operational boot
- `federationConnect` — node join latency
- `scheduling` — task scheduling latency
- `marketplaceInstall` — capability install time
- `snapshot` — snapshot creation time
- `restore` — restore from snapshot time
- `recovery` — recovery coordination latency
- `throughput` — distributed tasks per second

## Procedure

```bash
npm run baseline-test
```

The report is stored in `data/performance-baseline.json`.

## Regression Policy

A 10% regression against the baseline is flagged by `PerformanceBaseline.compare`.

## Current Snapshot

Run `npm run baseline-test` to generate the current baseline. Initial values are
expected to be environment-specific; store the canonical baseline alongside the
release tag.
