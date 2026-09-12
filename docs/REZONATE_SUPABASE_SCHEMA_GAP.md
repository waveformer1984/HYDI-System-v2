# Rezonate Supabase Schema Gap

Status: open finding, documented 2026-08-13 during P1 (Rezonate Canonicalization,
`docs/REZONATE_CONSOLIDATION_PLAN.md`). Not remediated — remediation would mean
authoring a new SQL migration, which requires separate explicit authorization per
this project's constraints ("MUST NOT... migrate databases... unless explicitly
authorized afterward").

## The finding

The Rezonate domain model (`protoforge-applications/rezonate/src/persistence/store.js`
`defaultTables`) requires seven logical tables:

```
projects, tracks, assets, processing_jobs, ownership_records, rights, audit_log
```

The live Supabase migration (`supabase/migrations/20260522000001_rezonate_schema.sql`)
defines five tables, and only two of them map cleanly onto the domain model:

| Migration table | Domain table it could map to | Clean mapping? |
|---|---|---|
| `rezonate_projects` | `projects` | Yes |
| `rezonate_tracks` | `tracks` | Yes |
| `rezonate_patterns` | *(no domain equivalent)* | N/A |
| `rezonate_audio_files` | `assets` | **No — lossy** |
| `rezonate_processing_settings` | *(no domain equivalent)* | N/A |

`rezonate_audio_files` looks like a plausible home for `assets` at first glance, but
its columns (`filename`, `file_path`, `storage_bucket`, `duration_seconds`,
`sample_rate`, `bit_depth`, `file_size_bytes`) don't cover what
`src/domain/audio-asset.js` needs (`type`, `status`, `metadata` JSONB, `bpm`, `key`).
Mapping `assets` to it would mean silently dropping every asset write's `type`,
`status`, `bpm`, `key`, and `metadata` on the floor. That's a data-loss trap, not a
working adapter.

There is no migration table at all for `processing_jobs`, `ownership_records`,
`rights`, or `audit_log`.

## Why this matters

`processing_jobs` is not a peripheral table — it's the one `POST /processing/jobs`
and `POST /processing/jobs/:id/start` write to, which is the primary generate/stems
workflow (`src/api/router.js`). In Supabase persistence mode as it exists today, that
core workflow cannot function: `SupabaseStore` throws `UnsupportedOperationError`
rather than pretending to support it.

## How it's handled today (P1 #5)

`protoforge-applications/rezonate/src/persistence/supabase-store.js` implements the
`Store` interface against the two tables that do map cleanly (`projects`, `tracks`)
and throws `UnsupportedOperationError` (see `src/errors.js`) immediately, loudly, for
the other five — no silent no-ops, no lossy writes. `load()` (used only by the
read-only diagnostics/health view) is the one exception: it reports empty arrays for
the five unsupported tables rather than throwing, since a health check shouldn't hard
-fail over tables that are a known, documented gap.

This adapter is opt-in only (`persistence/index.js`, `type: 'supabase'`) — the default
remains local JSON/memory per the platform's local-first architecture decision
(root `CLAUDE.md`). It has been exercised against 19 unit tests
(`tests/supabase-store.test.js`) using a hand-written fake Supabase query-builder
client, never against a live Supabase project.

## What a real fix would require

A new migration adding tables for `processing_jobs`, `ownership_records`, `rights`,
and `audit_log`, plus a decision on `assets` — either extend `rezonate_audio_files`
with the missing columns, or add a separate `rezonate_assets` table with `type`,
`status`, `metadata` JSONB, `bpm`, `key`. Either choice needs the governance gate this
repo already has for schema changes (`hdi-governance-gate.yml`: every new `.sql`
migration needs a matching test in `tests/migrations/<version>.test.js`; state-machine
changes need `STATE_MACHINE_APPROVED` in the PR description) and, per the P0/P1
constraints this work operated under, explicit authorization before being written —
not assumed as part of "safe remediation."

## Update 2026-08-13: live-validation gate attempted, blocked

A follow-up session attempted to progress this from "documented gap" toward live
verification. It hit a network boundary before reaching the live database at all
(this working session cannot reach `127.0.0.1:54321`, the configured local Supabase
instance, from its sandbox — see `docs/SUPABASE_LIVE_CONTRACT_REPORT.md` for the
full gate log). While blocked from live access, that session did a deeper *static*
comparison and found one more concrete defect beyond what's described above:
`repository.js`'s `createProject()` never sets `rezonate_projects.user_id`, which is
a `NOT NULL` foreign key in the live schema — meaning even the two tables this
document calls "map cleanly" (`projects`, `tracks`) have a write-path defect for
`projects` that the 19 mocked `SupabaseStore` tests could not catch, since the fake
test client doesn't enforce NOT NULL/FK constraints. See
`docs/SUPABASE_LIVE_CONTRACT_REPORT.md` §2.2 for the full column-level analysis.

## Disposition

Tracked as `PENDING_DECISION` is not accurate here — this is better described as a
known, accepted architectural gap: `_canonical_path.persistence_target` in
`capability-contract.json` documents it, and `cloud_supabase_database` /
`cloud_canonical_persistence` capability entries cite this file as the source of
truth. No capability touching Supabase persistence should be marked `VERIFIED` or
`PRODUCTION` until this gap is closed and re-tested against a live project.
