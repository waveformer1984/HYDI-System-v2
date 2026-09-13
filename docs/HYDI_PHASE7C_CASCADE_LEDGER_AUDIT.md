# HYDI Phase 7C — CASCADE Raw Ledger Audit

## Data flow

```
Event source
      ↓
LedgerAdapter / RawLedgerAdapter / raw-ledger.ts
      ↓
Supabase `raw_event_ledger` table
      OR
LocalLedgerStore → data/hydi-local/protoforge/raw-ledger.json
      ↓
ReplayEngine / EventProcessor
```

## Supabase usage

| File | Operation | Table | Purpose |
|---|---|---|---|
| `lib/protoforge/raw-ledger.ts` | insert | `raw_event_ledger` | Append raw event |
| `lib/protoforge/raw-ledger.ts` | select | `raw_event_ledger` | Get event by fingerprint |
| `lib/protoforge/replay-engine.ts` | select | `raw_event_ledger` | Replay events |
| `protoforge/cascade/src/adapters/ledger-adapter.js` | select | `raw_event_ledger` | CASCADE reads |
| `protoforge/hydi-gateway/src/adapters/raw-ledger.js` | insert/select | `raw_event_ledger` | Gateway append/read |

## Data classification

| Datum | Class | Notes |
|---|---|---|
| Raw event records | B. local persistent state | Append-only immutable source of truth |
| Fingerprints | B. local persistent state | Idempotency key, derived from source/eventId/eventType |
| Hashes | B. local persistent state | SHA-256 of fingerprint, event_type, payload |

The raw ledger is the single source of truth. Local-first is appropriate.
