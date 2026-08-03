# Artifact Integrity Report

**Date:** 2026-08-02
**Scope:** `artifacts/soak/<timestamp>/` directory and the six required files produced by `scripts/soak-test.js`.

## Summary

The modernized soak harness creates a timestamped artifact directory and refuses to declare success until every required file is present and writable. The integrity of the artifact set is enforced by `SoakArtifactSet.verifyArtifacts()` and by the harness's non-zero exit on any write failure.

## Required Artifact Package

Every successful run must produce:

| File | Purpose | Incremental? | Finalised? |
|------|---------|--------------|------------|
| `soak.log` | JSON-Lines event log with timestamps and levels | Yes — appended and fsynced after every event | Opened at start, closed at finalisation |
| `metrics.jsonl` | Append-only raw metrics samples | Yes — one line per sample | Created at start |
| `metrics.json` | Valid JSON array of all collected samples | Yes — rewritten after every sample | Finalised with last sample |
| `summary.json` | Machine-readable run summary | No — written once | Finalised at end |
| `report.md` | Human-readable qualification report | No — written once | Finalised at end |
| `system-info.json` | Host, Node, platform, package version | No — written at start and refreshed at finalisation | Finalised at end |
| `configuration.json` | The effective run options | No — written at start and refreshed at finalisation | Finalised at end |

## Write Failure Handling

If any required artifact cannot be written, the harness throws and exits non-zero:

- `SoakArtifactSet` constructor throws if the directory cannot be created.
- `appendLog` throws if `soak.log` fsync fails.
- `appendMetricsSample` throws if `metrics.json` cannot be updated.
- `finalise` throws if any of the six required files does not exist after writing.
- `main()` catches these fatal errors, logs them, and returns exit code `1`.

## Atomicity

- `soak.log` is opened once and kept open; each `fsyncSync` reduces the loss window to the most recent in-flight line.
- `metrics.json` is rewritten in full after each sample. Because `fs.writeFileSync` is synchronous, the file is always valid JSON on disk at the end of each write. A crash during the write may leave a partial file; the `metrics.jsonl` append-only stream remains the authoritative source and can be replayed.
- `summary.json`, `report.md`, `system-info.json`, and `configuration.json` are written once at finalisation.

## Short-Run Verification

`tests/unit/soak-harness-integrity.test.js` runs a 10-second harness instance against an in-process health server and asserts the presence and validity of all six artifacts:

- `fs.existsSync` passes for `soak.log`, `metrics.json`, `metrics.jsonl`, `summary.json`, `report.md`, `system-info.json`, `configuration.json`.
- `metrics.json` is a valid JSON array with at least one sample.
- `summary.json` contains the required endurance and operational fields.
- `report.md` contains the expected markdown headings.

## One-Hour Qualification Verification

The live one-hour qualification completed at `2026-08-03T05:01:43.809Z` and produced the same six artifacts under `artifacts/soak/2026-08-03T04-01-42-890Z/`:

| File | Size | Status |
|------|------|--------|
| `soak.log` | 20,056 bytes | present, valid JSON-Lines |
| `metrics.jsonl` | 45,196 bytes | present, 60 lines |
| `metrics.json` | 64,338 bytes | present, valid JSON array, 60 samples |
| `summary.json` | 5,955 bytes | present, valid JSON, `result.passed: true` |
| `report.md` | 3,114 bytes | present, valid Markdown |
| `system-info.json` | 285 bytes | present, valid JSON |
| `configuration.json` | 340 bytes | present, valid JSON |

The live run's `summary.json` is the source of truth for the `ONE_HOUR_QUALIFICATION_REPORT.md` and `FINAL_VALIDATION_SUMMARY.md`.
