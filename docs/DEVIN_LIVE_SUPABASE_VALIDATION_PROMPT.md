> **Superseded 2026-08-14.** The project direction shifted to local-only — no
> Supabase, no external platforms. This Supabase live-validation prompt no longer
> reflects the intended work. Use
> `docs/DEVIN_HEIDI_REZONATE_INTEGRATION_PROMPT.md` instead. Left in place for
> historical record of the schema findings (the `rezonate_projects.user_id`
> NOT NULL mismatch, the 5-table gap) — those are still accurate facts about the
> unused Supabase schema, just no longer the active plan.

# Prompt for Devin: Rezonate Live Supabase Validation → Legacy Migration Gate (SUPERSEDED)

Copy everything below the line into Devin as a single task.

---

You're picking up the Rezonate persistence work in the `HYDI-System-v2` repo
(also called Heidi / ProtoForge). A prior engineering session (Claude, working in a
sandboxed environment with no Docker and no network path to this project's local
Supabase instance) completed all the code-level work — async repository, an opt-in
`SupabaseStore` adapter, auth middleware, storage adapters, CI guards — and then hit
a hard wall: it could not reach any live Supabase instance to validate against. You
have something that session didn't: an environment where you can actually run
`supabase start` and get a real live database. Your job is to pick up exactly where
it stopped and carry the work forward through live validation, using **your own
fresh local instance built from the checked-in migrations** — not the user's actual
running Docker instance, and not any cloud project. Full reasoning for that choice
is in "Environment strategy" below.

## Read first, in this order

1. `docs/SUPABASE_LIVE_CONTRACT_REPORT.md` — the exact gate this continues from,
   including a concrete finding you need to verify or refute: `repository.js`'s
   `createProject()` never sets `rezonate_projects.user_id`, which is a `NOT NULL`
   foreign key in the live schema per the migration file. That was found by reading
   code, not by testing against a real database — confirming it live is your first
   real task.
2. `docs/REZONATE_SUPABASE_SCHEMA_GAP.md` — the domain model needs 7 tables, the
   migration only defines 5, and only 2 of those 5 map cleanly onto the domain
   model without dropping data.
3. `docs/REZONATE_CONSOLIDATION_PLAN.md` — read the P1 section for full history and
   the explicit scope boundary: **do not let this become "build everything."**
4. `docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md` — four separate surfaces touch
   Rezonate data today (canonical API, legacy API, `api/chat/route.js`'s
   `handleRezonateMessage`, and a Supabase Edge Function). Know which is which
   before you touch anything.
5. `protoforge-applications/rezonate/capability-contract.json` — the single source
   of truth for what's actually proven vs. merely implemented. State enum:
   `PLANNED, SCAFFOLD, PARTIAL, FUNCTIONAL, VERIFIED, PRODUCTION, DEPRECATED`.
   **A capability may only be marked `VERIFIED` or `PRODUCTION` if you have citable
   evidence — a passing test run, a specific validation you actually performed, with
   a date. Never upgrade a status because code merely exists.** There's a CI script,
   `scripts/validate-rezonate-capability-contract.js` (`npm run
   validate:rezonate-contract`), that checks this contract for internal consistency
   and scans `RezonetteModule.tsx` for hardcoded status drift — this exists because
   of a real prior bug where the UI displayed "Complete" for features that were
   0% built. Do not reintroduce that failure mode.
6. `protoforge-applications/rezonate/src/persistence/supabase-store.js`,
   `src/repository.js`, `src/persistence/store.js` (`defaultTables`),
   `src/domain/*.js`, `src/api/router.js`, and
   `supabase/migrations/20260522000001_rezonate_schema.sql` — the actual code and
   the actual live schema definition. Don't take the docs' word for any of this;
   re-derive the domain-model → repository-method → table → column map yourself
   from these files before changing anything.
7. Root `CLAUDE.md` — in particular the "Local-First Architecture" section. This
   project deliberately moved off cloud Supabase. Respect that decision.

## Environment strategy — read this before touching any database

There are two different "local Supabase" instances in play and they are **not** the
same thing:

- The user's own machine has a Docker-hosted Supabase instance
  (`http://127.0.0.1:54321` per `.env.local`) with whatever real data currently
  lives in it. The prior session correctly refused to touch this — it had no path
  to it anyway.
- You, running in your own environment, can run `supabase start` (Supabase CLI)
  yourself, which applies every migration under `supabase/migrations/` to a
  **brand-new, empty, disposable** local Postgres instance that only you control.

**Use the second one. Do not attempt to reach or connect to the user's actual
instance, and do not use either of the old/backup cloud credential sets found in
`.env.bak-akbnfovjdcobifeupvbn` or `.env.local.cloud-backup` — those are explicitly
disabled/deprecated per `CLAUDE.md`'s local-first decision, and the prior session
declined to use them for that reason. That reasoning still holds. If you cannot get
`supabase start` working in your environment, stop and report that as the blocker —
do not fall back to a real project.**

This gives you everything the validation gate actually needs — real Postgres
enforcing real `NOT NULL`/FK/CHECK constraints, real RLS policy evaluation — without
any risk to production data, without needing real credentials, and without
resurrecting a deprecated architecture decision. It is a legitimate stand-in for
"live validation" in every way that matters for schema/adapter correctness. It is
**not** a stand-in for validating against real production row shapes (legacy
records, actual user data drift) — call that out explicitly as still-open in your
final report rather than implying it's covered.

## Required progression — do not skip stages

```
LOCAL TESTS (already passing: 128 total, 127 pass, 1 known pre-existing EPERM
             failure — tracked, not a regression, do not "fix" it)
   ↓
LIVE SCHEMA INSPECTION (against your own fresh `supabase start` instance)
   ↓
SCHEMA COMPATIBILITY REPORT (update docs/SUPABASE_LIVE_CONTRACT_REPORT.md with a
             new dated section — do not overwrite the prior findings, append)
   ↓
ADAPTER COMPLETION (only for tables/columns you've now proven compatible)
   ↓
LIVE WRITE VALIDATION (create/read/update/delete against your disposable instance
             only, full cleanup, never against anything else)
   ↓
handleRezonateMessage MIGRATION (only once persistence is proven live-compatible;
             keep the legacy implementation in place, add a compatibility path)
   ↓
REGRESSION VALIDATION (npm test, typecheck, the rezonate node:test suite, the
             capability-contract guard — all of them, every stage)
   ↓
LEGACY API DEPRECATION (produce docs/LEGACY_API_CONSUMER_REPORT.md — search the
             whole repo, classify every consumer: ACTIVE / TEST_ONLY / DEAD_CODE /
             MIGRATED / UNKNOWN)
   ↓
LEGACY API REMOVAL (only if zero ACTIVE consumers remain, and only after everything
             above passes — this is a real production API with a real, currently
             live consumer (handleRezonateMessage) as of the last audit; verify
             that's actually changed before touching it)
```

If you cannot safely complete a stage, stop exactly there, document why in
`docs/SUPABASE_LIVE_CONTRACT_REPORT.md`, and do not proceed further. Do not
manufacture certainty to make the report look more complete than the evidence
supports.

## Specific things to verify or fix

1. **The `user_id` finding.** Confirm it live: attempt an insert into
   `rezonate_projects` via `SupabaseStore` exactly as `repository.createProject()`
   builds it today, and confirm it fails with a `not_null_violation`. Then decide
   (don't assume) how to fix it — either thread an authenticated user identity from
   the canonical API's auth layer (`lib/auth/requireAuth`, wired in P1 #6) down into
   `repository.createProject()`, or use an explicit service-role/system placeholder
   user if this app is meant to operate without per-end-user Supabase auth. If you
   pick the placeholder route, say so explicitly in the contract evidence — it's a
   real architectural choice, not a neutral default.
2. **`rezonate_tracks.type` CHECK constraint** (`'audio' | 'midi' | 'instrument'`) —
   currently unenforced client-side. Decide whether to add application-level
   validation matching the constraint, or leave it to fail loud at the DB. Either is
   defensible; document which you chose and why.
3. **The 5-table gap** (`assets`, `processing_jobs`, `ownership_records`, `rights`,
   `audit_log` have no matching live tables; `rezonate_audio_files` cannot losslessly
   hold `AudioAsset` because it's missing `type`/`bpm`/`key`/`metadata`/
   `ownership_status`). If closing this gap requires a new migration, remember this
   repo's own governance gate (`hdi-governance-gate.yml`): every new `.sql`
   migration needs a matching test in `tests/migrations/<version>.test.js`, and
   state-machine changes need `STATE_MACHINE_APPROVED` in the PR description. Write
   the migration if the evidence supports it, but do not merge/apply it against
   anything but your own disposable instance without flagging it for human review —
   this repo's standing rule is that database migrations need explicit
   authorization, and that rule survives this handoff.
4. **`rezonate_patterns` and `rezonate_processing_settings`** — live tables with no
   current domain-model/repository consumer. Confirm whether anything else in the
   repo (legacy API, Edge Functions) actually uses them before concluding they're
   simply unused.

## Hard constraints — do not violate these

- Never print, log, or commit a service-role key, access token, password, or any
  URL containing embedded credentials.
- Never connect to the user's actual running local instance or the old cloud
  project. Your own `supabase start` instance only.
- Never run destructive SQL/writes against anything except your own disposable
  instance, and always clean up what you create there.
- Never disable authentication, weaken an ownership check, or bypass RLS to make a
  test pass.
- Never remove the legacy API (`api/rezonate/route.js`, `pages/api/rezonate/route.js`)
  while any consumer is classified `ACTIVE`.
- Never silently fall back from a failed Supabase write to some other storage —
  fail loud, matching the existing `UnsupportedOperationError` pattern in
  `src/errors.js`.
- Preserve the one known pre-existing EPERM test failure exactly as-is (it's an
  environment/filesystem-timing artifact in `tests/api.test.js`, not a logic bug —
  documented in `docs/REZONATE_CONSOLIDATION_PLAN.md`). If that failure count or
  identity ever changes, stop and classify it as a possible regression before
  calling anything complete.
- Don't expand scope into P2/P3 items (MIDI, NFTs, mixing, collaboration, etc.) —
  those are explicitly downstream of this foundation per the consolidation plan.
- Work on a branch and open a PR; don't push directly to `clean-main`.

## What to deliver

- An updated `docs/SUPABASE_LIVE_CONTRACT_REPORT.md` (append a new dated section,
  don't erase the prior blocked-gate findings — they're still historically accurate
  for that session).
- Any `SupabaseStore` table mappings you can now prove compatible, each with new
  tests and updated `capability-contract.json` evidence (with real dates and what
  was actually validated).
- If you reach that stage: `docs/LEGACY_API_CONSUMER_REPORT.md`.
- A final structured report in the same shape as the prior session used: Live
  Validation / SupabaseStore / handleRezonateMessage / Legacy API / Tests (exact
  numbers) / Capability Contract changes / Blockers / Recommended Next Gate. State
  plainly which stage you reached and stopped at if you don't make it to the end —
  that's the expected, honest outcome if a real blocker shows up, not a failure.
