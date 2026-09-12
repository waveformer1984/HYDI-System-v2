# HYDI Phase 7C — CASCADE Raw Ledger Localization

## Goal

Make the raw event ledger append/read operational without cloud Supabase.

## Local persistence contract

```text
data/hydi-local/protoforge/raw-ledger.json
```

Schema: array of records.

```json
[
  {
    "id": "uuid",
    "fingerprint": "sha256",
    "event_type": "string",
    "payload": { ... },
    "hash": "sha256",
    "created_at": "ISO 8601"
  }
]
```

- Append-only: new events are pushed to the end.
- Idempotent on `fingerprint`: duplicates return `Duplicate fingerprint` without mutating.
- Read by `fingerprint`.
- List with `offset`, `limit`, `since`, `fromTimestamp`, `eventType`.
- Health returns `connected: true` and `events` count.

## Files changed

- `lib/protoforge/local-ledger-store.js` — new local JSON ledger store.
- `lib/protoforge/raw-ledger.ts` — `appendEvent` and `getEventByFingerprint` now fall back to local when `supabase` is missing.
- `protoforge/cascade/src/adapters/ledger-adapter.js` — `get` and `list` fall back to `LocalLedgerStore` when no Supabase.

## Behavior

- If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and `HYDI_CASCADE_SOURCE` is not `'local'`, the ledger uses Supabase.
- Otherwise, it uses `LocalLedgerStore`.
- `raw-ledger.ts` functions accept `supabase` as optional; if `undefined` or `null`, they use local.

## Failure modes

| Scenario | Behavior |
|---|---|
| No Supabase credentials | `LedgerAdapter` uses local; `raw-ledger.ts` uses local. |
| `HYDI_CASCADE_SOURCE=local` or `HYDI_POLICY_SOURCE=local` | Force local for ledger. |
| Missing `raw-ledger.json` | Empty ledger; appends create it. |
| Corrupt `raw-ledger.json` | Log warning and start empty. |
| Duplicate fingerprint | Returns error without writing. |

## Limitations

- `protoforge/hydi-gateway/src/adapters/raw-ledger.js` and `lib/protoforge/replay-engine.ts` still require Supabase client or further integration. The core `raw-ledger.ts` is now local-capable.
