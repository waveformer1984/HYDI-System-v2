# Rezonate — Target Architecture

## Phase 7 — External Repository Status

```text
EXTERNAL REPOSITORY NOT VERIFIED
```

`github.com/waveformer1984/rezonette` could not be inspected this session. Two independent attempts:

1. GitHub MCP connector (`list_repos`) — failed: *"GitHub token missing... set GITHUB_TOKEN or GH_TOKEN"*
2. Generic web fetch to `https://github.com/waveformer1984/rezonette` and `https://api.github.com/repos/waveformer1984/rezonette` — both returned no usable content (indistinguishable from a fetch failure; not treated as evidence of the repo's non-existence, privacy, or contents)

No claims about newness, completeness, canonicity, NFT implementation, audio functionality, or duplication versus this repo are made anywhere in this report. This is a genuine blind spot, not an assumption. **Recommendation: connect a GitHub credential before any consolidation decision that assumes this repo is empty, ahead, or behind.**

---

## Phase 8 — Architectural Decision

Answered from verified evidence only:

1. **Canonical root:** `protoforge-applications/rezonate/` — already the most tested (96 tests), already declared canonical in `docs/PLATFORM_NAMING_GUIDE.md`, and the only module with a real domain/orchestration layer (jobs, assets, ownership, rights, event bus).
2. **Canonical frontend:** None exists yet. Three UI surfaces compete (`pages/song-composer.tsx`, `apps/ursula-frontend/.../RezonateDAWModule.tsx`, `apps/ursula-frontend/.../RezonetteModule.tsx`) and none is fully wired to the canonical backend. Per the platform's own prior reconciliation doc, Ursula is the best-developed UX surface and the natural place to consolidate — but that decision predates this session's discovery that `RezonetteModule.tsx` currently misrepresents build status to users, which should be fixed before promoting it to canonical.
3. **Canonical audio engine:** `rezonate/generate.py` + `rezonate/make-stems.py` — verified working, proven output, explicitly "must not be duplicated or rewritten" per the platform's own prior audit, a judgment this session's re-verification supports.
4. **Canonical backend:** `protoforge-applications/rezonate/src/api/router.js` (Express) for orchestration, backed by Supabase for persistence — see item 12 for why Supabase, not Firebase.
5. **Canonical AI layer:** Split by job — `rezonate/generate.py` (Lyria 3) for audio generation, `api/song-composer/generate.js` (LLM router) for song-structure text, `apps/ursula-frontend/src/lib/resonate/engine.ts` for algorithmic/offline fallback. These are three different jobs, not competing implementations of the same job, and should stay separate rather than be forced into one "AI layer."
6. **What is Rezonette:** Today, a UI concept (`RezonetteModule.tsx`) for an NFT/DAW dashboard, referencing an external repo (`github.com/waveformer1984/rezonette`) that could not be verified this session. It is not currently a working system — it is a mockup with a bug that overstates its own completeness. Until the external repo is inspected, Rezonette should be treated as **aspirational branding for the ownership/marketplace layer of Resonate**, not a separate product.
7. **Legacy Vercel implementation (`api/rezonate/route.js` + its Supabase schema):** Keep running (it's real, tested, 21/21 passing, and something may still call it via the chat router's schema queries) but freeze further investment. Do not extend it. Migrate its callers to the canonical app's API over time, then archive it the same way this repo already archives other retired code (see `archive/` directory precedent).
8. **The seven/eight duplicate locations:** See `REZONATE_CONSOLIDATION_PLAN.md` for a per-module KEEP/MERGE/ARCHIVE/DEPRECATE decision. Headline: nothing should be deleted yet; several are genuinely different capabilities wearing the same name rather than true duplicates.
9. **HYDI integration:** Via the `ExternalAdapter` pattern already implemented in `protoforge-applications/rezonate/src/events/event-bus.js`, emitting to the HYDI Event Gateway — this pattern is real, tested in-process, and is the correct integration seam. Whether it's live in production is unconfirmed (see Documentation Drift §4) and should be verified before being relied upon.
10. **ProtoForge integration:** Already correct in principle — `protoforge-applications/rezonate/` lives under `protoforge-applications/`, following the same pattern as `protoforge-applications/proto-yi/`. No architectural change needed here; execution (actually wiring persistence, deploying, confirming the Gateway connection) is the gap, not the integration pattern.
11. **MIDI/hardware integration evolution:** Keep `MidiControllerInterface.ts` as the base (it's real, working Web MIDI code) and extend it incrementally: add CC message handling, then pitch bend/aftertouch, then a generic hardware-profile system instead of the single hardcoded DDJ-SB3 map, before considering file-based MIDI import/export as a separate, larger feature.
12. **Is Firebase needed at all?** **No.** No repository evidence anywhere — this session or the prior one — shows Firebase in use, configured, or referenced as an active dependency. The entire platform, including every Rezonate-related persistence path, is built on Supabase (Postgres + RLS + Edge Functions). Introducing Firebase would mean standing up a second, redundant backend for no capability Supabase doesn't already provide here. This report does not recommend Firebase, per the explicit instruction not to reintroduce it merely because an old design document once mentioned it.

---

## Phase 9 — Architecture Diagrams

### CURRENT

```text
                         REZONATE (fragmented, 8+ locations)

  AUDIO ENGINE (real)          CANONICAL APP (real, tested)        3 UI SURFACES (disconnected/mock)
  rezonate/generate.py    ◄──  protoforge-applications/rezonate/   song-composer.tsx (LLM JSON only)
  rezonate/make-stems.py  ◄──  src/api/router.js (Express)         RezonateDAWModule.tsx (mock DAW)
  (subprocess calls)           src/domain/* (jobs/assets/rights)   RezonetteModule.tsx (mock NFT,
                                src/events/event-bus.js               MISREPORTS status to users)
                                  → HYDI Gateway (unconfirmed live)
                                96 tests / 95 passing (verified)
                                persistence: LOCAL JSON/MEMORY ONLY

  LEGACY, DEPRECATED, STILL LIVE                    STUBS
  api/rezonate/route.js (274 lines, 21/21 tests)     supabase/functions/rezonate-engine/index.ts
    └─ rezonate_* Supabase schema (real, RLS)          (8 task types, all stub handlers)
  api/chat/route.js handleRezonateMessage
    └─ reads same rezonate_* schema                  agents/rezonate_node/config.json
                                                         (capability manifest, mostly aspirational)

  EXTERNAL, UNKNOWN
  github.com/waveformer1984/rezonette (not verified)
```

### TARGET

```text
                         RESONATE (one canonical system)

                        ┌─────────────────────────────────┐
                        │   Resonate Frontend (single)     │
                        │   — consolidated from song-       │
                        │     composer + Ursula modules,    │
                        │     with RezonetteModule's status- │
                        │     override bug fixed first       │
                        └───────────────┬───────────────────┘
                                        │ HTTP
                                        ▼
                        ┌─────────────────────────────────┐
                        │  Resonate API (canonical)         │
                        │  protoforge-applications/rezonate/│
                        │  src/api/router.js                │
                        │  — auth added (currently missing) │
                        └───────┬───────────────┬───────────┘
                                │                │
                 spawns/calls   │                │  reads/writes
                                ▼                ▼
                ┌───────────────────────┐   ┌─────────────────────────┐
                │ Audio Engine (Python)  │   │ Supabase                │
                │ generate.py            │   │  — rezonate_* schema,   │
                │ make-stems.py          │   │    migrated to be the   │
                │ (unchanged — do not     │   │    canonical app's real │
                │  rewrite, per existing  │   │    persistence, not just│
                │  platform judgment)     │   │    the legacy API's     │
                └───────────────────────┘   │  — Storage for generated │
                                              │    audio (currently local│
                                              │    files only)           │
                                              │  — Auth for the canonical│
                                              │    API (currently none)  │
                                              └─────────────────────────┘
                                        │
                                        │ domain events
                                        ▼
                        ┌─────────────────────────────────┐
                        │  HYDI Event Gateway               │
                        │  (confirm live, don't assume)     │
                        └─────────────────────────────────┘

  Ownership/Rights/NFT layer (protoforge-applications/rezonate/src/domain/)
  stays as the real bookkeeping model. Chain/wallet integration is a genuinely
  new build (P2/P3), not a wiring fix — nothing to connect to yet.

  Legacy Vercel API + its schema: frozen, then archived once callers migrate.
  Edge Function stubs: replaced with real calls into the canonical API, or removed.
  agents/rezonate_node/config.json: rewritten to match verified capabilities only.
  External rezonette repo: inspected once access exists; folded in or explicitly
  ruled out — no assumption either way until then.
```

### Data flow (target)

```
User → Resonate Frontend → Resonate API (auth-gated) → {
    generate job  → rezonate/generate.py            → audio file → Supabase Storage → AudioAsset row
    stems job     → rezonate/make-stems.py           → stem files → Supabase Storage → AudioAsset rows
    ownership op  → domain/ownership-record.js, rights.js → Supabase rezonate_* tables
} → domain event → EventBus → HYDI Event Gateway → RAW LEDGER
```

### MIDI flow (target)

```
Hardware device → Web MIDI API → MidiControllerInterface (extended: Note On/Off, CC,
pitch bend, program change) → per-device profile registry (generalizing today's single
hardcoded DDJ-SB3 map) → Resonate Frontend actions
```

### AI flow (target, unchanged in shape from current — already correctly separated)

```
Audio generation:      Resonate API → generate.py → Lyria 3 (Gemini API)
Song structure text:   Resonate Frontend → api/song-composer/generate.js → internal LLM router
Offline/algorithmic:   Resonate Frontend → engine.ts (client-side, no network)
Local inference:       protoforge-applications/rezonate/src/adapters/local-model-runtime.js
                        (status UNKNOWN — verify before relying on this path)
```

### Authentication (target)

Add auth to the canonical API (`protoforge-applications/rezonate/src/api/router.js`), reusing `lib/auth/requireAuth` from the legacy API rather than inventing a second auth mechanism — this is the one piece of the legacy module worth keeping past the migration, since it's already tested (21/21).

### Storage (target)

Move from local-filesystem-only output to Supabase Storage for generated audio/stems, with the existing `rezonate_audio_files` schema table as the metadata index. This is a P1 item — it does not require touching the audio engine itself.

### Deployment (target)

No deployment changes are recommended by this audit. Confirm whether `protoforge-applications/rezonate/` is actually reachable at the `localhost:3001` address referenced in governance docs, or what its real production URL is, before treating "Production" status as fact (see Documentation Drift §4).
