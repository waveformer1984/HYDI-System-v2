# Rezonate — Canonical Frontend / API / Data Path

**Declared:** 2026-08-13, P0.5.3 (`docs/REZONATE_CONSOLIDATION_PLAN.md`).
**Machine-readable copy:** `protoforge-applications/rezonate/capability-contract.json` → `_canonical_path` and `_legacy_paths`, validated by `npm run validate:rezonate-contract`.

This is a decision record, not a completed migration. Declaring a path doesn't move code — it gives every future change a single answer to "does this belong in the canonical system or a legacy one," which the repo did not have before this document.

---

## The declaration

| Layer | Canonical | Current state |
|---|---|---|
| **Frontend** | `apps/ursula-frontend` (Ursula), with `RezonetteModule.tsx` as the canonical capability dashboard | Wired to the Capability Contract (P0.5.1, 2026-08-13). Still needs `pages/song-composer.tsx`'s MIDI controller migrated in and `RezonateDAWModule.tsx` merged/retired. |
| **API** | `protoforge-applications/rezonate/src/api/router.js` | Real, tested (95/96), already declared canonical in `docs/PLATFORM_NAMING_GUIDE.md` before this document — this section confirms rather than changes that part. |
| **Persistence** | Supabase, `rezonate_*` schema (`supabase/migrations/20260522000001_rezonate_schema.sql`) | **Not yet wired.** The canonical API currently persists to local JSON/memory (`protoforge-applications/rezonate/src/persistence/`). Wiring it to the real schema is P1 item #5 — this declaration fixes the *target*, not the current behavior. |

## Why Ursula and not `pages/song-composer.tsx`

Both are real, both have genuine work in them. The deciding factors:

- Ursula already has the working end-to-end chain (Studio → canonical API → Python engine → playback) per the platform's own prior integration note, which this session's re-verification did not contradict.
- Ursula is where the Capability Contract just landed and is now load-bearing — moving the canonical designation elsewhere would mean rewiring that work immediately.
- `pages/song-composer.tsx` owns one real, non-duplicated asset: `MidiControllerInterface.ts`, the only working MIDI hardware integration in the repo. That gets migrated in, not left behind — see the `RETAINED_FOR_COMPATIBILITY` disposition below, not `DEPRECATED`.

This matches the disposition already reached independently in `docs/RESONATE_SYSTEM_RECONCILIATION.md` §8 ("Option A — Ursula frontend becomes the UI layer"), re-confirmed here rather than re-litigated.

## Every legacy path, explicitly dispositioned

Mirrors `capability-contract.json → _legacy_paths`, which `npm run validate:rezonate-contract` checks has a value from `{DEPRECATED, RETAINED, RETAINED_FOR_COMPATIBILITY, PENDING_DECISION}` for every entry — nothing is allowed to sit undeclared.

| Path | Disposition | Why |
|---|---|---|
| `api/rezonate/route.js`, `pages/api/rezonate/route.js` | **RETAINED_FOR_COMPATIBILITY** | Live consumer exists (`api/chat/route.js handleRezonateMessage`). Marked deprecated in-code (2026-08-13); do not extend; migrate the consumer before archiving. |
| `supabase/migrations/20260522000001_rezonate_schema.sql` | **RETAINED** | Not legacy at all — this *is* the persistence target above. It's unwired, not obsolete. |
| `agents/rezonate_node/config.json`, `adapter.py` | **DEPRECATED** | Zero consumers found anywhere in the tree. Capability flags corrected 2026-08-13; still a candidate for archival once that's reconfirmed. |
| `supabase/functions/rezonate-engine/index.ts` | **PENDING_DECISION** | P0.4 is still open (implement for real vs. archive). Explicitly not defaulted to either disposition — that would be guessing. |
| `pages/song-composer.tsx`, `components/song-composer/*` | **RETAINED_FOR_COMPATIBILITY** | Owns the only real MIDI hardware integration. Retained until migrated into Ursula; becomes `DEPRECATED` once that happens. |
| `apps/ursula-frontend/.../RezonateDAWModule.tsx` | **DEPRECATED** | Duplicates the DAW-UI job now owned by `RezonetteModule.tsx`. Merge anything useful, then remove. |
| `apps/ursula-frontend/src/lib/resonate/engine.ts` | **RETAINED_FOR_COMPATIBILITY** | Different capability (offline algorithmic sequencing), not a duplicate — kept as a network-free fallback path. |
| `github.com/waveformer1984/rezonette` | **PENDING_DECISION** | Still `EXTERNAL REPOSITORY NOT VERIFIED` (P0.2). Cannot be dispositioned blind. |

## What this does and doesn't authorize

This document fixes the *target*. It does not, by itself, migrate `MidiControllerInterface.ts` into Ursula, merge `RezonateDAWModule.tsx`, wire Supabase persistence, or resolve the two `PENDING_DECISION` items. Those are P1/P0.4/P0.2 work, tracked in `docs/REZONATE_CONSOLIDATION_PLAN.md`, not completed here.
