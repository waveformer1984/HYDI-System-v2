# HYDI Phase 7C — CASCADE Raw Ledger Readiness

## Summary

The raw event ledger now supports local-first append and read operations when Supabase is unavailable.

## What was migrated

- `lib/protoforge/local-ledger-store.js` — new local JSON ledger store.
- `lib/protoforge/raw-ledger.ts` — `appendEvent` and `getEventByFingerprint` now accept an optional `supabase` and fall back to local.
- `protoforge/cascade/src/adapters/ledger-adapter.js` — `get` and `list` fall back to `LocalLedgerStore` when no Supabase.
- `docs/HYDI_PHASE7C_CASCADE_LEDGER_AUDIT.md`
- `docs/HYDI_PHASE7C_CASCADE_LEDGER_LOCALIZATION.md`
- `tests/unit/cascade-ledger-local.test.js` — 6/6 PASS.

## Verification

```text
npm run typecheck                                              PASS
npm run build                                                  PASS
npm run validate:rezonate-contract                             PASS
npx jest tests/unit/cascade-ledger-local.test.js              6/6 PASS
```

## Behavior

- Appends are idempotent by `fingerprint`.
- Reads by `fingerprint` and paged `list` work.
- `eventType`, `since`, and `fromTimestamp` filters work.
- Local ledger file recovers from missing or corrupt state.

## Limitations

- `protoforge/hydi-gateway/src/adapters/raw-ledger.js` still requires a client or further integration.
- `lib/protoforge/replay-engine.ts` still passes a Supabase client; it can be pointed to a local client in a future phase.

## Verdict

**CASCADE raw ledger: GO** for local-first append and read.
