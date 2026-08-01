# CASCADE Architecture

## Role

CASCADE is the canonical event-processing layer between the HYDI Event Gateway and all future ProtoForge intelligence systems. It does not perform business logic, make recommendations, or take actions. It only transforms events.

## Layers

```text
[1] RAW EVENT LEDGER        ← single source of truth, append-only, immutable
[2] LedgerAdapter           ← reads only
[3] ReplayEngine            ← replays events from any point
[4] EventProcessor          ← validates, verifies, normalizes
[5] DerivedStore            ← derived event storage
[6] LineageGraph            ← parent/child/ancestor/descendant queries
[7] Consumers               ← KILO, Proto YI, Forge Finder, Build a Mind
```

## Constraints

- CASCADE never writes to the RAW EVENT LEDGER.
- CASCADE never reads application databases directly.
- CASCADE does not call LLMs or make policy decisions.
- CASCADE does not store duplicates of derived events.

## Components

### LedgerAdapter

- Reads from `raw_event_ledger` via Supabase.
- Supports listing with `since`, `eventType`, `offset`, `limit`.
- Supports single-event lookup by `fingerprint`.
- Computes `fingerprint` and `hash` for verification.

### ReplayEngine

- Replays from `beginning`, a `fingerprint`, a `timestamp`, or by `eventType`.
- For each raw event, calls `EventProcessor.process()`.
- Adds the derived event to `DerivedStore`.
- Updates `Metrics` with counts and latency.

### EventProcessor

- Validates the canonical envelope.
- Verifies `fingerprint` and `hash` against recomputed SHA-256 values.
- Applies version adapters to normalize payloads.
- Preserves the original payload.
- Generates a derived event ID: `cascade:{fingerprint}`.

### DerivedStore

- File-based persistent store for derived events.
- Atomic write and load.
- Deduplicates by `fingerprint`.
- Updates child references when a parent is present.

### LineageGraph

- `children` — immediate children
- `descendants` — all descendants (BFS, cycle-safe)
- `ancestors` — all ancestors (cycle-safe)

### Metrics

- `eventsProcessed`
- `processingLatencyMs`
- `averageLatencyMs`
- `replayProgress`
- `replayDurationMs`
- `duplicatesIgnored`
- `validationFailures`
- `lastReplayAt`
