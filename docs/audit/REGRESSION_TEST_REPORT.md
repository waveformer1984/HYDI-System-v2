# Regression Test Report — Soak Harness Modernization

**Date:** 2026-08-02
**Scope:** `scripts/soak-test.js`, `scripts/lib/soak-metrics.js`, `package.json`, `tests/unit/soak-harness-integrity.test.js`

## Summary

The modernized soak harness is protected by a dedicated Jest suite that verifies every new durability, configuration, and reporting behavior. The existing `validation-tooling-integrity.test.js` suite remains green, confirming that earlier fixes (duplicate script keys, opt-in chaos, honest metrics) were not regressed.

## Test Results

| Suite | File | Result | Notes |
|-------|------|--------|-------|
| Soak harness modernization integrity | `tests/unit/soak-harness-integrity.test.js` | **PASS** | 22/22 tests passed |
| Validation tooling integrity | `tests/unit/validation-tooling-integrity.test.js` | **PASS** | 49/49 tests passed |
| TypeScript type-check | `npm run typecheck` | **PASS** | No errors, `tsc --noEmit` clean |
| ESLint (changed files) | `npx eslint` on modified scripts/tests | **PASS** | No lint errors |

## New Regression Coverage

### Duration parsing

- Default is 24 hours.
- `5m`, `15m`, `30m`, `1h`, `6h`, `12h`, `24h` all parse correctly.
- Plain numeric milliseconds still accepted.
- `ms` unit accepted for millisecond values.
- Invalid and negative values fall back to the 24h default.
- `--duration=1h` and `--duration 1h` argument forms are both supported.

### Durable artifact set

- `SoakArtifactSet` creates the expected directory and the six required artifact paths.
- Each log entry is appended with an ISO-8601 timestamp and the file grows predictably.
- Metrics samples appear in both `metrics.jsonl` (append-only) and `metrics.json` (live array snapshot).
- The artifact writer fails immediately if the destination directory cannot be created (e.g., a file exists at the path).

### End-to-end short run

- A 10-second run against an in-test health server produced all six required artifacts.
- The `summary.json` passed and contained the required operational fields:
  - `endurance.requests`
  - `endurance.successRatePercent`
  - `operational.uptimeSeconds`
  - `operational.restartCount`
  - `operational.exceptionCount`
  - `operational.unhandledRejectionCount`
- The `report.md` contained the expected sections: `# HYDI Soak Qualification Report`, `## Endurance`, `## Operational Metrics`.

### Package.json

- No duplicate script names remain.
- `soak-test-1h` invokes `node scripts/soak-test.js --duration 1h`.
- `soak-test-24h` invokes the harness without overriding the default 24h.

## Method

Tests executed in-band to avoid cross-test interference:

```bash
npx jest tests/unit/soak-harness-integrity.test.js --runInBand
npx jest tests/unit/validation-tooling-integrity.test.js --runInBand
npm run typecheck
npx eslint scripts/soak-test.js scripts/lib/soak-metrics.js tests/unit/soak-harness-integrity.test.js tests/unit/validation-tooling-integrity.test.js
```

## Conclusion

The modernization is regression-protected. The new suite will fail if any of the following are reintroduced: ambiguous duration parsing, missing artifacts, non-durable logging, or missing operational fields in the report.
