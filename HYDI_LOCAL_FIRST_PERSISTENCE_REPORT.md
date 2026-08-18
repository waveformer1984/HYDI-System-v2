# HYDI Local-First Persistence Report

**Generated:** 2026-08-18T03:50:00Z
**Canonical repository:** `C:\Users\Owner\HYDI-System-v2`
**Branch:** `clean-main`
**Commit:** `0599500`

## Local-First Configuration

| Variable | Value | Source |
|----------|-------|--------|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | present (server-side only) | `.env.local` |
| `STRIPE_SECRET_KEY` | not set (Stripe disabled) | cleared for qualification |
| Strategy | LOCAL_FIRST | `gate-state.json` |

## Persistence Verification

### Supabase (local)

| Check | Result |
|-------|--------|
| REST API reachable | PASS (HTTP 200) |
| Service-role insert | PASS (leads table, correct schema) |
| Service-role read | PASS (read back verified) |
| Service-role delete | PASS (cleanup succeeded) |

### Rezonate JSON File Persistence

| Check | Result |
|-------|--------|
| Create project | PASS |
| Read project back | PASS |
| File persisted to disk | PASS |
| File contains project | PASS (array-based structure: `projects: [...]`) |

### LocalLedgerStore (CASCADE raw ledger)

| Test | Result |
|------|--------|
| Read missing event as null | PASS |
| Append and read without Supabase | PASS |
| Append is idempotent (duplicate fingerprint) | PASS |
| List local events with pagination | PASS |
| Filter by eventType | PASS |
| Health check | PASS (ok, connected, events count) |
| Persistence survives restart (fresh instance) | PASS |

## Observed Facts

- Local Supabase at `127.0.0.1:54321` is the database backend.
- Rezonate uses JSON file persistence (`createStore({ type: 'json', filePath })`).
- `LocalLedgerStore` provides local-first CASCADE raw event ledger (append-only, immutable, hashed).
- All persistence tests pass including restart recovery.

## Inferences

- The system can operate without cloud Supabase for Rezonate and ledger operations.
- Database CRUD requires local Supabase to be running (Docker/CLI).

## Known Limitations

- Integration tests (`npm run test:integration`) not run (require live adversarial Supabase setup).
- Rezonate JSON file persistence is single-process (no concurrent writer protection beyond atomic rename).
