# Soak Report

## Executive Summary

- **1-hour soak:** Not started.
- **24-hour soak:** Not started.
- **Reason:** Blocked by the failed operational qualification.

## Operational Qualification Outcome

The `npm run operational-qualification` run completed but the qualification **failed**:

- Workload success rate: 33.3% (target >= 99%).
- Resource leak: detected in the harness process (9.23 MB/hr).
- Failure injection: not tested.

## Soak Decision

The project mandate is to not proceed to long-duration soak tests until the shorter qualification passes. Running a 1-hour or 24-hour soak with a 66% workload failure rate and a resource leak would not produce meaningful certification evidence.

## Commands Not Executed

```text
npm run soak-test-1h
npm run soak-test-24h
```

## Conclusion

**NOT RUN.** Soak testing is gated by the operational qualification. Re-run `npm run operational-qualification` after the workload and resource-leak issues are resolved, then execute `npm run soak-test-1h` and, if stable, `npm run soak-test-24h`.
