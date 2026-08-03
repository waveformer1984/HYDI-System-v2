# Soak Harness Modernization Audit

**Date:** 2026-01-15 (session date)
**Scope:** `scripts/soak-test.js`, `scripts/lib/soak-metrics.js`, `lib/structured-logger.js`, `package.json` soak scripts, and the operational evidence they produce.

## Summary

The existing `scripts/soak-test.js` harness was recently corrected to stop reporting fabricated failure injection and to scope its claims honestly. It is now a truthful endurance harness, but it is not yet a *durable* evidence generator. Before it can be trusted for long (24h) production qualifications, the harness must be modernized so that evidence is written incrementally, flushed immediately, and recoverable after interruption.

## Evidence Paths Examined

| Path | Current Behaviour | Risk |
|------|-------------------|------|
| `scripts/soak-test.js` | Runs for a configured `durationMs` polling a health endpoint and collecting operational metrics. | Duration is hard-coded to 24h unless a numeric millisecond value is supplied. It does not accept `1h`, `30m`, etc. |
| `events.jsonl` | Appended synchronously for each probe and chaos event. | Not flushed to disk with `fsync`; relies on OS page cache. Still not named `soak.log` and not a required deliverable. |
| `metrics.jsonl` | Appended synchronously for each metrics sample. | Same flush risk; there is no `metrics.json` deliverable and no summary if the process is killed. |
| `report.json` | Written once at the very end of the run. | If the harness is interrupted, no final report, summary, or human-readable markdown is produced. |
| Console output | Printed live to `stdout`/`stderr` via `lib/structured-logger` and `console.log`. | Console text is not a durable artifact and may be lost if the terminal is closed or the shell is not captured. |
| `this.metrics.samples` | Held in memory in `OperationalMetrics`. | Lost on process exit. Only the `metrics.jsonl` file (unflushed) preserves raw samples. |
| `this.latencies` | Held in memory. | Lost on process exit; the latency statistics are computed from the in-memory array. |
| `failureSamples` | Held in memory, capped at 200. | Lost on process exit. |

## Findings

1. **No configurable human duration.** The `package.json` scripts pass numeric milliseconds (`3600000`), and the CLI parser does not understand `1h`, `30m`, `5m`, etc. Users must convert manually, which is error-prone.
2. **Artifacts do not match the required package.** A run currently creates `events.jsonl`, `metrics.jsonl`, and `report.json` under `reports/soak/<timestamp>`. The directive requires `soak.log`, `metrics.json`, `summary.json`, `report.md`, `system-info.json`, and `configuration.json` under `artifacts/soak/<timestamp>`.
3. **Writes are not durably flushed.** All evidence is written with `fs.appendFileSync` / `fs.writeFileSync`, but no `fs.fsyncSync` is called. A crash can lose the most recent seconds of data.
4. **No incremental `metrics.json` or `summary.json`.** `report.json` is the only final machine-readable artifact and is only emitted if the run reaches the end of the loop.
5. **No graceful recovery after interruption.** The signal handler sets `isRunning = false`, but there is no explicit final-artifact flush and no `metrics.json` constructed from the `metrics.jsonl` already on disk.
6. **Required artifact failures do not stop the qualification.** If the artifact directory cannot be created or a file cannot be written, the harness does not exit non-zero.
7. **`package.json` still contains the ambiguous legacy `soak-test` and `leak-test` names? No.** The previous cleanup removed them, but `soak-test-1h` still passes `3600000` instead of the human form.
8. **Operational metrics are missing `uptimeSeconds`.** The `OperationalMetrics.sample()` object does not include process uptime.

## Recommended Remediation

1. Implement `parseDuration()` supporting `5m`, `15m`, `30m`, `1h`, `6h`, `12h`, `24h` with a 24h default.
2. Create a dedicated artifact directory `artifacts/soak/<timestamp>` and write the six required files.
3. Use file-descriptor based logging with `fs.fsyncSync` after each log entry for `soak.log`.
4. Maintain a `metrics.json` array in memory and rewrite it atomically after each sample; also keep a `metrics.jsonl` line-by-line backup.
5. On `SIGINT`/`SIGTERM` and before normal exit, explicitly flush and finalise all artifacts.
6. Treat any artifact I/O failure as fatal: stop, explain, and exit non-zero.
7. Add `uptimeSeconds` to the metrics sample.
8. Update `package.json` `soak-test-1h` to use `--duration 1h` and add regression tests for duration parsing and artifact durability.

## Evidence-Loss Verdict

A successful run today preserves probe events and metric samples only if the process exits cleanly and the OS flushes its buffers in time. A killed or crashed run can lose the final report, summary, and any unflushed `jsonl` entries. This is not acceptable for a qualification harness.
