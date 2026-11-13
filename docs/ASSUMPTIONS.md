# Assumptions (mobile-ops phases 0–10)

| ID | Assumption | If wrong |
|----|------------|----------|
| A1 | `clean-main` is the integration branch; never push directly | Retarget PR base |
| A2 | `.ports.json` remains the runtime source; `config/ports.json` is canonical doc copy kept in sync | Run `node scripts/sync-ports-registry.js` |
| A3 | Cloud agent has no Frank PM2/Supabase — verification here is unit tests + contract tests only | Jordan runs `hydi-verify` on Frank |
| A4 | `HEIDI_ALLOW_EXEC` stays false until Jordan explicitly enables on Frank | No autonomous executes |
| A5 | Embedding backfill blocked until 1536 vs 768 decision (see `DISCREPANCIES.md`) | Skip `backfill-embeddings` |
| A6 | Proto-yi workspace salvage may be open on PR #519 — not merged in this branch | Phase 8 uses template only |
| A7 | dotenvx optional: `npx dotenvx run --` documented; repo still loads `.env.local` via dotenv in scripts | No behavior change required |
| A8 | Phase tests skipped only when env lacks Supabase — recorded in CI as SKIP, not hidden | See workflow notes |
| A9 | 10 division seeds (not 9) — matches consolidation inventory slugs | Trim one slug if Jordan says 9 |
