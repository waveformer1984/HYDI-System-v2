# Rezonate Supabase Live Contract Report

**Status: LIVE_VALIDATION_BLOCKED**
**Written:** 2026-08-13, live-validation gate of the Rezonate persistence work
(`docs/REZONATE_CONSOLIDATION_PLAN.md` P1 → live-infrastructure validation phase).
**Environment:** sandboxed agent session, mounted read/write access to the
`HYDI-System-v2` working tree only. No credentials were printed at any point in
producing this report.

---

## 1. Live validation gate result: BLOCKED

The required progression (LOCAL TESTS → LIVE SUPABASE READ-ONLY VALIDATION → ...)
cannot proceed past stage 2 in this environment. This is a genuine infrastructure
boundary, not a missing-credentials problem in the usual sense — credentials exist,
but the thing they point to is unreachable from here. Details:

| Check | Result |
|---|---|
| `.env` (primary, unprefixed vars) | Supabase vars present but named `DISABLED_SUPABASE_URL`, `DISABLED_SUPABASE_KEY`, `DISABLED_SUPABASE_SERVICE_ROLE_KEY`, `DISABLED_SUPABASE_ANON_KEY` — deliberately disabled, consistent with the local-first architecture decision in root `CLAUDE.md`. |
| `.env.local` (the file that takes precedence — see `verify-supabase.sh`'s own load order) | Active `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL`. Host resolved (value only, not printed with the key) to `http://127.0.0.1:54321` — the standard Supabase CLI local-dev port, i.e. a Docker-hosted instance on the **user's own machine**. |
| Reachability of `127.0.0.1:54321` from this sandbox | **Failed** — `curl` returned exit code 7 (connection refused), `http_status=000`. This sandbox is an isolated Linux environment separate from the user's machine; `127.0.0.1` here is the sandbox's own loopback, not the user's. There is no network path from this session to the user's local Docker daemon. |
| Docker availability in this sandbox | `docker` binary not found. Even if a network path existed, this environment cannot run or reach a local Supabase stack itself. |
| Backup/alternate credentials found | `.env.bak-akbnfovjdcobifeupvbn` and `.env.local.cloud-backup` contain what appear to be an older **cloud** Supabase project's variable names (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.), including one resolving to a `*.supabase.co` host with a project ref that does **not** match the `akbnfovjdcobifeupvbn` ref documented as canonical in root `CLAUDE.md`. |

**Decision: these backup/cloud credentials were deliberately not used.** Reasons:
1. They are explicitly named as backups (`.env.bak-*`, `*.cloud-backup`), not the
   active configuration `.env.local` designates.
2. Using them would mean resurrecting a credential path the project's own
   Local-First Architecture decision (`CLAUDE.md`, dated 2026-07-10) moved away
   from, without the user re-authorizing that move here.
3. The resolved project ref differs from the one documented as canonical, so it may
   point at a stale, orphaned, or unrelated project — connecting to it blind, even
   read-only, is not a safe default action per this task's own stop conditions
   ("an active legacy consumer is discovered" / "ownership semantics are unclear"
   apply by extension: I don't know what this project actually is).
4. This task's rules are explicit: do not fabricate live validation, and do not
   bypass a documented architecture decision to force a stage forward.

No connection attempt (not even a header-less reachability probe) was made against
the `*.supabase.co` host for these reasons — the reachability check above was
performed only against the currently-designated local target.

**This is a stop condition per rule 15** ("live Supabase credentials are
unavailable"): functionally, they are unavailable *to this session*, even though
they exist in the working tree.

---

## 2. What was inspected instead (static, code/schema-only comparison)

Everything below comes from reading the migration DDL, domain models, repository,
and `SupabaseStore` directly — no live introspection. It is evidence about *what the
code assumes*, not proof of what the live database actually contains today (the live
schema could have drifted from this migration file via manual hotfixes; that
possibility is itself an open unknown, see §5).

### 2.1 Domain model → repository → Store table → migration table map

| Domain model | Repository method(s) | `Store` table key | Live migration table | Migration mapping status |
|---|---|---|---|---|
| *(plain object, no domain class)* project | `createProject`, `getProject`, `listProjects` | `projects` | `rezonate_projects` | **MISMATCH** (see §2.2) |
| *(plain object, no domain class)* track | `createTrack`, `listTracks` | `tracks` | `rezonate_tracks` | **COMPATIBLE** (see §2.2) |
| `domain/audio-asset.js` `AudioAsset` | `registerAsset`, `getAsset`, `listAssets` | `assets` | *(none — closest candidate `rezonate_audio_files` is lossy, see §2.3)* | **MISSING** |
| `domain/processing-job.js` `ProcessingJob` | `createProcessingJob`, `getProcessingJob`, `listProcessingJobs`, `startProcessingJob`, `completeProcessingJob`, `failProcessingJob` | `processing_jobs` | *(none)* | **MISSING** |
| `domain/ownership-record.js` `OwnershipRecord` | `createOwnershipRecord`, `listOwnershipRecords`, `getOwnershipRecord`, `verifyOwnershipRecord` | `ownership_records` | *(none)* | **MISSING** |
| `domain/rights.js` `Rights` | `registerRights`, `getRights`, `addCollaborator` | `rights` | *(none)* | **MISSING** |
| *(no domain model / no repository method)* | — | `audit_log` | *(none)* | **MISSING** |
| *(no domain model / no repository method)* | — | *(unused by repository)* | `rezonate_patterns` | **UNKNOWN** — live table exists, nothing in the current domain model or repository writes/reads it |
| *(no domain model / no repository method)* | — | *(unused by repository)* | `rezonate_processing_settings` | **UNKNOWN** — same as above |

`SupabaseStore`'s own `TABLE_MAP` (`{projects: 'rezonate_projects', tracks:
'rezonate_tracks'}`) and `UNSUPPORTED_TABLES` (`['assets', 'processing_jobs',
'ownership_records', 'rights', 'audit_log']`) match this table exactly — the P1 #5
implementation correctly modeled the gap as it understood it. §2.2 below adds a
**new** finding beyond what P1 #5 documented: one of the two "mapped" tables has a
write-path defect that mocked tests couldn't catch, because the fake test client
never enforced NOT NULL/FK constraints the way real Postgres does.

### 2.2 Column-level comparison: `projects` → `rezonate_projects`

`repository.js` `createProject()` builds this exact record:

```js
{ id, name, tempo, time_signature, key_signature, status, created_at, updated_at }
```

`rezonate_projects` columns: `id, user_id (NOT NULL, FK → auth.users), name, tempo,
time_signature, key_signature, description, status, created_at, updated_at`.

| Column | Repository sends it? | Live constraint | Result |
|---|---|---|---|
| `user_id` | **No — never set anywhere in `validateProject()` or `createProject()`** | `NOT NULL REFERENCES auth.users(id)` | **MISMATCH — write would fail.** Any `SupabaseStore.create('projects', ...)` call inserts a record missing a required, foreign-keyed column. This is not an RLS problem (RLS wouldn't even be reached); it's a `23502 not_null_violation` at the Postgres level, which applies even to `service_role`. |
| `description` | No | Nullable, no default required | Fine — omission is valid, just means every project gets `NULL` description. |
| Everything else | Yes, matching types | — | Compatible. |

**This mismatch was not caught by `tests/supabase-store.test.js`'s 19 passing
tests**, because the hand-written fake Supabase client (`makeFakeSupabase()` in that
file) has no concept of NOT NULL or foreign-key constraints — it accepts any object
shape. This is exactly the kind of gap `docs/REZONATE_SUPABASE_SCHEMA_GAP.md`
already warned about in general terms ("mocked tests only... never a live Supabase
project"); this report makes one specific instance of that warning concrete.

**Repository-level root cause:** `ResonateRepository` and `SupabaseStore` have no
concept of an authenticated user at all — `createRepository()` takes no user
context, and nothing upstream (the canonical API's new P1 #6 auth middleware)
threads `req.auth`'s resolved identity down into `repository.createProject()`. Auth
now gates *who may call the endpoint*, but nothing yet maps that caller to a
`user_id` value for a Supabase-mode write. Fixing this requires a repository-level
change (accepting/deriving a `user_id`), not just a `SupabaseStore` change — flagged
here rather than fixed, since a fix without live validation to confirm it would be
exactly the kind of unverified claim this gate exists to prevent.

### 2.3 Column-level comparison: `tracks` → `rezonate_tracks`

`repository.js` `createTrack()` builds:

```js
{ id, project_id, name, type, muted, solo, volume, pan, position, created_at }
```

`rezonate_tracks` columns: `id, project_id (NOT NULL, FK), name, type (CHECK IN
('audio','midi','instrument')), muted, solo, volume, pan, position, created_at`.

**Result: COMPATIBLE.** Every field the repository sends has a matching column and
type; nothing required is missing. Two live-only conditions weren't and couldn't be
checked without a real DB: (1) the `type` CHECK constraint — the repository accepts
any string for `type` client-side (`input.type || 'audio'`, no allow-list
enforcement), so a caller passing `type: 'vocal'` would be rejected by Postgres at
insert time, not by application validation; (2) whether `project_id` actually
resolves to a row created via the same (currently broken, see §2.2) `projects` path
— in practice, no track can be created in Supabase mode today because its parent
project can't be created first.

### 2.4 `rezonate_audio_files` vs. `assets` — confirmed lossy, not just missing

This was already established in `docs/REZONATE_SUPABASE_SCHEMA_GAP.md`; re-verified
here directly against `AudioAsset.toJSON()`:

`AudioAsset` fields: `id, project_id, type, source_track, file_path, bpm, key,
metadata, ownership_status, created_at, updated_at`.

`rezonate_audio_files` columns: `id, project_id, track_id, filename, file_path,
storage_bucket, duration_seconds, sample_rate, bit_depth, file_size_bytes,
created_at`.

No column exists for `type`, `bpm` (as authored — `duration_seconds`/`sample_rate`
are audio-file metrics, not the same as musical BPM), `key`, `metadata`, or
`ownership_status`. Confirmed **MISSING**, not merely PARTIAL — there is no subset
mapping that preserves the domain model without dropping fields the app actively
uses (`ownership_status` in particular drives the NFT/ownership feature area).

### 2.5 Live-only checks that remain genuinely UNKNOWN

These cannot be resolved by reading code and require actual DB access:

- Whether the live schema matches this migration file exactly (manual hotfixes,
  partially-applied migrations, or drift are all possible and unverifiable from
  here).
- Actual row counts / whether any production data exists in these tables at all.
- Whether `rezonate_patterns` and `rezonate_processing_settings` are used by any
  *other* system (e.g. the legacy Vercel API, an Edge Function) even though the
  canonical app's repository never touches them — if so, they're not "unused," just
  unused by this one consumer.
- RLS behavior in practice (policies are readable in the migration and were
  summarized in §2.2/§2.3 context, but policy *logic* was not exercised against
  real rows/sessions).
- Data compatibility for pre-existing/legacy-written rows (nullable fields, enum
  drift, serialization of `JSONB` columns like `rezonate_patterns.data`).

---

## 3. Recommended migration sequence (once live access is available)

Unchanged in spirit from `docs/REZONATE_SUPABASE_SCHEMA_GAP.md`, refined with the
new `user_id` finding:

1. Resolve the `projects.user_id` gap first — it blocks every other write in
   Supabase mode, since `tracks`, and any future `assets`/`processing_jobs` tables,
   all chain off a project. Two options, neither implemented here: (a) thread an
   authenticated user identity from the API's auth layer down into
   `repository.createProject()`, or (b) use a service-role-scoped
   system/placeholder user if Rezonate's canonical app is meant to operate without
   per-end-user Supabase auth (needs an explicit decision, not an assumption).
2. Author a new migration adding `processing_jobs`, `ownership_records`, `rights`,
   `audit_log` tables, and decide `assets`' fate (extend `rezonate_audio_files` vs.
   a new `rezonate_assets` table) — subject to this repo's governance gate
   (`hdi-governance-gate.yml`: matching test in `tests/migrations/<version>.test.js`
   required) and explicit authorization, per this project's standing constraints.
3. Only then re-attempt this live-validation gate from stage 2.

---

## 4. Blockers (genuine, not manufactured)

1. **No network path from this session to the configured local Supabase instance**
   (`127.0.0.1:54321`, Docker-hosted on the user's machine). This is an environment
   boundary, not a code defect.
2. **`projects` table has a required `user_id` FK with no corresponding write-path
   in the current repository/API layer** — newly discovered via static comparison,
   confirmed independent of the live-access blocker.
3. **No safe, currently-designated live credential path exists in this session** —
   the only alternative found (an old cloud project) was deliberately not used per
   §1.

## 5. Stages reached vs. not reached

```text
LOCAL TESTS                          ✅ done prior to this session (128/127/1)
LIVE SUPABASE READ-ONLY VALIDATION   ⛔ BLOCKED — no reachable live instance
SCHEMA COMPATIBILITY REPORT          ✅ this document (static comparison only)
ADAPTER COMPLETION                   ⏸ not attempted — would be unverified without live access
LIVE WRITE VALIDATION                ⛔ not reached
handleRezonateMessage MIGRATION      ⛔ not reached
REGRESSION VALIDATION                ⛔ not reached
LEGACY API DEPRECATION               ⛔ not reached
LEGACY API REMOVAL                   ⛔ not reached
```

No capability in `capability-contract.json` was upgraded toward `VERIFIED` or
`PRODUCTION` as a result of this session — the static findings here, if anything,
argue for keeping `cloud_canonical_persistence` at `PARTIAL` and add a concrete,
citable reason (the `user_id` mismatch) rather than a generic "not live-tested"
caveat.
