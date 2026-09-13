# Rezonate — Consolidation Plan

Nothing in this document has been executed. No files were deleted, merged, or renamed. Decisions are based on functional comparison, not filename similarity, per instructions.

---

## Phase 6 — Per-Module Disposition

| Module | Path | Decision | Rationale |
|---|---|---|---|
| Audio engine | `rezonate/generate.py`, `rezonate/make-stems.py` | **KEEP** | Only working audio DSP/generation in the tree. Proven output. Explicitly "must not be duplicated or rewritten" per the platform's own prior audit — this session's re-verification agrees. |
| CLI copilot | `rezonate/heidi-rezonate.js` | **KEEP** | Small, real, useful local tool; not competing with anything else — it's a convenience wrapper around the audio engine, not a duplicate orchestration layer. |
| Canonical app | `protoforge-applications/rezonate/` | **KEEP** (as the consolidation target) | Most tested (96 tests), only real domain/orchestration layer, already declared canonical in governance docs. |
| Legacy Vercel API + schema | `api/rezonate/route.js`, `pages/api/rezonate/route.js`, `supabase/migrations/20260522000001_rezonate_schema.sql` | **DEPRECATE** (not delete) | Real, tested (21/21), and still has live consumers (the chat router reads the same schema). Deprecating means: stop extending it, migrate callers to the canonical app over time, then archive once nothing calls it — matches the pattern this repo already uses for `archive/dead-vercel-config/` etc. **Do not delete or archive yet** — the chat router still depends on its schema. |
| Chat router consumer | `api/chat/route.js` `handleRezonateMessage` | **KEEP, migrate later** | Legitimate, tested (6/6) feature (chat answers about project/track/revenue status). Currently reads the deprecated schema directly; should be repointed at the canonical app's API once that app has real Supabase persistence (see Consolidation Plan P1 below), not before. |
| Supabase Edge Function | `supabase/functions/rezonate-engine/index.ts` | **ARCHIVE candidate, pending decision** | All 8 handlers are stubs with no callers found. Two options: (a) implement it as real glue between async triggers and the canonical app, or (b) archive it and let the canonical app's own synchronous API cover these use cases. This audit does not have enough evidence to choose — flagged as **UNKNOWN**, needs a product decision, not an engineering one. |
| Agent node manifest | `agents/rezonate_node/config.json`, `adapter.py` | **DEPRECATE** | No consumer was found anywhere in the tree that loads this config (searched, not traced to any registry loader). Combined with the fact that most of its capability flags are false/aspirational (see Documentation Drift), this looks like an early scaffold that was never wired up. Recommend confirming zero real consumers before archiving. |
| Song composer UI | `pages/song-composer.tsx`, `components/song-composer/*` | **KEEP, needs backend rewiring** | Real UI work (12 components including a genuinely functional MIDI controller). Currently produces LLM text, not audio — should be rewired to submit jobs to the canonical app rather than rebuilt. |
| Ursula `engine.ts` (algorithmic) | `apps/ursula-frontend/src/lib/resonate/engine.ts` | **KEEP** | Different capability (algorithmic sequencing, no AI, no audio files) from the Python pipeline — not a true duplicate. Useful as a fast, offline preview/fallback path. |
| Ursula `RezonateDAWModule.tsx` | same | **MERGE candidate** | Overlaps conceptually with `pages/song-composer.tsx` as a second DAW-style UI shell for the same underlying product. Recommend picking one UI home (per the prior reconciliation doc's own recommendation, Ursula) and merging the other's useful parts into it, rather than maintaining two DAW UIs in parallel. |
| Ursula `RezonetteModule.tsx` | same | **KEEP, fix urgently first** | Contains a real, verified bug: it displays "Complete"/"Built" for every listed feature regardless of actual build status, including NFT minting and marketplace — features confirmed not to exist anywhere in the codebase. This must be fixed (stop overriding status, show real source data) before this module is used as a canonical dashboard for anyone, including internally. This is **not** a documentation fix (it's application code) and is called out as a P0 item below, separate from the doc corrections applied in Phase 11. |
| External `rezonette` repo | `github.com/waveformer1984/rezonette` | **UNKNOWN** | Cannot be evaluated — no access this session. Do not assume it should be merged, archived, or ignored until it has actually been inspected. |

---

## Phase 10 — Prioritized Implementation Roadmap

### P0 — blocking, before this can be called a trustworthy canonical platform

1. ~~**Fix `RezonetteModule.tsx`'s status-override bug**~~ **DONE 2026-08-13.** Lines 112-116 no longer force every component to `'complete'`/`'Built'`; the component renders its own real `status` field. Verified: `tsc --noEmit` clean, canonical test suite re-run unchanged (96/95/1) around the edit.
2. **Get access to `github.com/waveformer1984/rezonette`** (GitHub connector auth, or a local clone shared into this workspace) — a consolidation decision that ignores this repo could be wrong in either direction (missing real work, or duplicating work that already exists there). **Still open.**
3. **Confirm or refute the "Production" deployment claim** in `docs/CANONICAL_PLATFORM_COMPONENTS.md` for the canonical app — don't build further integration on an assumption. **Still open.** Under `docs/REZONATE_CAPABILITY_CONTRACT.md`'s enum rules (added 2026-08-13), this entry is capped at `VERIFIED` until someone attaches a citable deployment check — a README/governance-doc assertion is explicitly not sufficient evidence.
4. **Decide the disposition of `supabase/functions/rezonate-engine/index.ts`** (implement for real vs. archive) — right now it's dead weight that could mislead a future engineer into thinking async task handling exists. **Still open.**

### P0.5 — before any P1 persistence/auth/storage work begins

Added 2026-08-13 at the user's direction, after the P0.1 fix and the Capability Contract seed
(`docs/REZONATE_CAPABILITY_CONTRACT.md`, `protoforge-applications/rezonate/capability-contract.json`)
landed. The contract currently exists but is not yet load-bearing — `RezonetteModule.tsx` reads its
own local `COMPONENTS` array (now honest, since the override is gone) rather than the contract file.
That gap, plus the lack of any guard against it recurring, plus the still-unresolved "which frontend/
API/persistence is canonical" question, are judged more urgent than starting P1 infrastructure work.

1. ~~**Make the Capability Contract authoritative.**~~ **DONE 2026-08-13.**
   `RezonetteModule.tsx` now imports `protoforge-applications/rezonate/capability-contract.json`
   directly (via the existing `@repo/*` tsconfig alias) and derives every contract-backed
   component's display status from `contractStateToDisplayStatus()` at render time — 9 of 15
   dashboard items are now contract-sourced; the remaining 6 (no matching contract capability found)
   correctly fall back to `'planned'` rather than an invented status. `tsc --noEmit` clean; canonical
   test suite unaffected (96/95/1, re-run around the change).
2. ~~**Add the CI integrity guard**~~ **DONE 2026-08-13.** `scripts/validate-rezonate-capability-contract.js`
   (`npm run validate:rezonate-contract`) validates the seven-state enum, required fields, that every
   `VERIFIED`/`PRODUCTION` entry has non-empty `evidence`, id uniqueness, and scans
   `RezonetteModule.tsx` for hardcoded status literals on contract-backed entries other than the
   sanctioned `'planned'` fallback. **Self-test performed:** injected the exact original bug
   (`status: 'complete'` on a contract-backed line) into a scratch copy — the guard failed with a
   precise file:line error naming the bug class; reverted, re-ran against the real repo, clean pass.
   Not yet wired into `.github/workflows/` — that's a follow-up, not done this pass.
3. ~~**Define the canonical frontend/API/data path**~~ **DONE 2026-08-13.** `docs/REZONATE_CANONICAL_PATH.md`
   declares: frontend = `apps/ursula-frontend` (Ursula, `RezonetteModule.tsx` as the dashboard),
   API = `protoforge-applications/rezonate/src/api/router.js`, persistence target = the real
   `rezonate_*` Supabase schema (not yet wired — that's P1 #5). All 8 legacy paths are explicitly
   dispositioned as `DEPRECATED`, `RETAINED`, `RETAINED_FOR_COMPATIBILITY`, or `PENDING_DECISION`
   in `capability-contract.json → _legacy_paths`, validated by the same guard script. Two items
   remain `PENDING_DECISION` (the Edge Function stub's fate, and the external `rezonette` repo) —
   this document fixes the target, it does not resolve P0.2 or P0.4.
4. **P1 is now unblocked** (not started). P0.5.1–3 are complete; P0.2 (external repo access) and
   P0.4 (Edge Function fate) remain open but no longer gate P1, since the canonical-path question
   they were blocking is answered. Starting P1 persistence/auth/storage work is a separate
   authorization, not implied by finishing P0.5.

### P1 — required for a usable production Rezonate

**Status note (2026-08-13, user-set boundary):** P0 as a whole is **not** closed — only the
P0.5 implementation sub-tasks (1-3 above) are done. P0.2 (external `rezonette` repo access),
P0.3 (verify the "Production" deployment claim), and P0.4 (Edge Function stub fate) remain
open evidence/decision gaps and are deliberately deferred, not resolved. P1 is unblocked
because the canonical-path question they used to gate is answered — not because they were
answered themselves.

**Scope boundary:** P1 must not become "build everything." It follows the canonical path
declared in `docs/REZONATE_CANONICAL_PATH.md`:

```text
Ursula Frontend → Canonical Rezonate API → Supabase → rezonate_* schema → Audio/orchestration services
```

In this order:

5. **Real Supabase persistence** — ✅ **DONE (partial by design)**. `SupabaseStore` (`protoforge-applications/rezonate/src/persistence/supabase-store.js`) implements the `Store` interface against the real `rezonate_*` schema for the 2 of 7 domain tables it actually supports (`projects`, `tracks`); the other 5 throw `UnsupportedOperationError` loud rather than silently dropping data. 19 passing tests against a mocked client, never a live project. Opt-in only (`persistence/index.js`, `type: 'supabase'`) — local JSON/memory remains the default, per CLAUDE.md's local-first decision. See `docs/REZONATE_SUPABASE_SCHEMA_GAP.md` for the full gap and what a real fix requires (a new migration, out of scope here).
6. **Authentication** — ✅ **DONE**. `protoforge-applications/rezonate/src/api/router.js` now reuses `lib/auth/requireAuth` + the existing `rezonate:manage` permission, on by default, `/health` exempted, opt-out via `config.enableAuth: false`. New tests prove both the 401-without-token and the /health-without-token paths, not just the happy path.
7. **Storage** for audio/stems/assets — ⚠️ **PARTIAL, deliberately not fully wired**. `protoforge-applications/rezonate/src/storage/` provides `LocalStorageProvider` (formalizes the existing fs-based behavior, no change) and `SupabaseStorageProvider` (tested only against a fake Storage client). Neither is wired into `router.js`'s asset endpoints, which still call `fs` directly — cutting over an already-working path without live verification was judged out of scope for the same reason as #9/#10 below.
8. **API ownership boundaries** — ✅ **DONE**. `docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md` documents all four surfaces that touch Rezonate data (canonical API, legacy API, `handleRezonateMessage`'s direct Supabase queries, the Edge Function), what each owns, and the RBAC gap (no read-only `rezonate:*` permission exists today).
9. **Migration of the remaining canonical CRUD** — ⏸️ **DEFERRED**. `api/chat/route.js handleRezonateMessage` still reads `rezonate_projects`/`rezonate_tracks` directly. Not migrated: it's live, currently-relied-upon behavior with no local reproduction of production Supabase data available in this sandbox, so a cutover isn't safely verifiable here. See `docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md`.
10. **Removal/deprecation of conflicting persistence paths** — ⏸️ **DEFERRED**, blocked on #9 by design (the plan's own stated order: #10 happens "once #9's migration is confirmed working"). The legacy Vercel API remains `RETAINED_FOR_COMPATIBILITY`.
11. **CI enforcement of the capability contract** — ✅ **DONE**. `.github/workflows/rezonate-capability-contract.yml` runs `npm run validate:rezonate-contract` as a blocking gate on PRs/pushes touching Rezonate paths, plus (informationally, `continue-on-error: true`) the canonical app's own `node --test` suite — which was not wired into any CI workflow before this, since root Jest's `testMatch` only covers `tests/unit/**` and this app uses `node:test`.

NFT, marketplace, advanced MIDI, Ableton/VST, real-time collaboration, and mobile/mesh work
(P2/P3 below) stay downstream of this foundation — do not pull any of it forward into P1.

**Test-result integrity note:** the canonical app's original 96/95/1 result is a truth marker
that was preserved, not cosmetically fixed, through every change in this P1 pass. The suite
now stands at 128/127/1 (30 new tests added: 19 for `SupabaseStore`, 10 for the storage
adapters, 3 for the new auth-rejection paths — minus the 2 pre-existing tests that gained
`await`/auth-header updates rather than new counts). The one failure is the exact same
`EPERM` temp-file cleanup issue, reproduced identically after every single change made during
this session, still deliberately unfixed.

### P2 — major capability expansion

10. Extend `MidiControllerInterface.ts` beyond Note On: add CC handling, then pitch bend/aftertouch, then a general hardware-profile registry instead of the single hardcoded DDJ-SB3 map.
11. Build real NFT/ownership chain integration behind the existing (real, tested) `ownership-record.js`/`rights.js` domain models — today there is a solid bookkeeping layer and nothing behind it.
12. Real audio classification / mix assistance / semantic sample search — currently 100% absent, listed only as "planned" in UI mockups.
13. Implement the Edge Function task handlers for real (if P0.4 decides to keep the module) — stem_analysis, mix_analysis, audio_export, rights_verify, session_recall, hardware_map, beat_generate.

### P3 — experimental / future

14. MIDI file import/export (not just live hardware control).
15. Ableton/VST/AU integration.
16. Real-time multi-user collaboration.
17. Cloud-hosted stem separation service (today it's local-CPU-only via Demucs).
18. Bot-personality marketplace / community extensions (per `RezonetteModule.tsx`'s own milestone M7 roadmap — currently 0% built despite the UI's current, buggy "Complete" display).

**Sequencing note:** prioritize wiring the existing, working code (audio engine ↔ canonical app ↔ one frontend ↔ real Supabase persistence) over any new capability. Every P2/P3 item assumes P0/P1 is done first — building MIDI CC support or NFT minting on top of today's disconnected, partially-fictional-status foundation would just add more surface area to the same problem this audit exists to fix.
