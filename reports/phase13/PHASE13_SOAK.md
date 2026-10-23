# Phase 13 — Soak Qualification

## Plan

Use `OperationalLoop` in `SHADOW` mode for a bounded duration.

- `cycleIntervalMs`: 30,000
- `maxCycles`: 1000
- `maxActionsPerCycle`: 0

The loop observes the real runtime, produces decisions, records them, but takes no action.

## Status

The soak was not executed in this session. The harness is ready. The runtime was intentionally not exercised in order to avoid unapproved side effects.

```text
NOT QUALIFIED
```

## Evidence on Run

When executed:

```bash
node scripts/phase13-qual.js --soak
```

The harness writes:

- `reports/phase13/operational-loop-SHADOW.jsonl`
- `reports/phase13/operational-loop-SHADOW-summary.json`

The summary includes:
- total cycles
- escalations
- healthy (STABLE) cycles
- stop reason
