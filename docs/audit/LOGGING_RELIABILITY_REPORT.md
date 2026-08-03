# Logging Reliability Report

**Date:** 2026-08-02
**Scope:** `scripts/soak-test.js` live log, `soak.log` artifact, incremental evidence persistence.

## Summary

The modernized harness treats the `soak.log` file as a first-class operational artifact. It is opened once at the start of a run, every entry is written synchronously, and the OS buffer is forced to disk with `fsyncSync` after each line. This satisfies the requirement for incremental logging with immediate flushing.

## Design

### File format

`soak.log` is a JSON Lines (`.jsonl`) file where each line is a complete JSON object:

```json
{"timestamp":"2026-08-02T04:01:42.123Z","level":"INFO","message":"probe","statusCode":200,"latencyMs":3,"success":true}
```

Because each line is self-contained, a truncated log is still partially readable. JSON Lines is more resilient to crashes than a single large JSON array.

### File lifecycle

1. `SoakArtifactSet` opens `soak.log` with `fs.openSync(path, 'a')` in the constructor.
2. `appendLog(level, message, metadata)`:
   - Builds a single JSON line.
   - Writes it with `fs.writeSync(logFd, line)`.
   - Calls `fs.fsyncSync(logFd)` to flush the OS page cache.
3. `finalise()` calls `fs.fsyncSync(logFd)` a final time and then `fs.closeSync(logFd)`.

### Event coverage

The following events are written to `soak.log` during every run:

- Harness initialisation (configuration, target, duration, mode).
- Every health-endpoint probe result (status, latency, success, timestamp).
- Every operational metrics sample.
- Chaos scenario execution results (when `--chaos` is enabled).
- Uncaught exceptions and unhandled rejections caught by process hooks.
- Early-stop events (`SIGINT`, `SIGTERM`).
- Finalisation event.

### Recovery behaviour

If the process is interrupted, the `soak.log` entries already flushed are preserved. The signal handler sets `isRunning = false`, the main loop exits, and `finalise()` writes the remaining artifacts. Because `soak.log` is fsynced after every entry, the loss window is limited to the current in-flight write at the moment of a hard kill.

## Verification

- `tests/unit/soak-harness-integrity.test.js` confirms that log lines are appended and the file grows.
- Each log entry has `timestamp`, `level`, and `message` keys.
- The final run artifact is included in `SoakArtifactSet.verifyArtifacts()`; a missing `soak.log` after finalisation causes a fatal, non-zero exit.

## Risks

- `fsyncSync` blocks the Node event loop for the duration of the disk flush. On slow disks this can introduce sub-100ms jitter into the probe interval. This is acceptable for an endurance qualification and preferable to losing evidence.
- A `SIGKILL` or power failure can still lose the last, unflushed buffer. No user-level process can fully eliminate this; `fsyncSync` reduces the window to the most recent write.
