# Rezonate — Canonical State (Authoritative Baseline)

**Date:** 2026-08-13
**Supersedes:** `docs/RESONATE_EXISTING_SYSTEM_AUDIT.md`, `docs/RESONATE_SYSTEM_RECONCILIATION.md`, and the prior audit turn in this session, wherever they conflict with this document. Those documents remain useful history and were largely accurate — this file exists because they had drifted on specific, checkable facts (see `REZONATE_DOCUMENTATION_DRIFT.md`).
**Companion files:** `REZONATE_MODULE_REGISTRY.json`, `REZONATE_CAPABILITY_MATRIX.json`, `REZONATE_DOCUMENTATION_DRIFT.md`, `REZONATE_TARGET_ARCHITECTURE.md`, `REZONATE_CONSOLIDATION_PLAN.md`.

---

## Canonical Root

`protoforge-applications/rezonate/` — declared canonical in `docs/PLATFORM_NAMING_GUIDE.md` and `docs/CANONICAL_PLATFORM_COMPONENTS.md`, and independently the best-supported choice by this audit's own evidence: it is the only module with a real domain/orchestration layer, and it has the largest verified test suite (96 tests, 95 passing — re-run twice this session with identical results).

## Current Architecture

Fragmented. Rezonate/Resonate/Rezonette branding spans 9 internal code locations (8 identified previously + `api/chat/route.js handleRezonateMessage`, surfaced this session) plus 1 unverified external repository. Exactly one real, working end-to-end chain exists: Ursula Resonate Studio → canonical app API → Python audio engine → generated asset → playback. Everything else is either a disconnected island, a stub, or a mock. Full diagrams in `REZONATE_TARGET_ARCHITECTURE.md`.

## Modules Found

9 internal (see `REZONATE_MODULE_REGISTRY.json` for the full per-module breakdown: purpose, dependencies, entry points, tests, consumers, canonical/deprecated/duplicate flags) + 1 external, unverified.

## Functional Capabilities (IMPLEMENTED)

AI song generation (Lyria 3), stem separation (Demucs, proven output on disk), BPM/key detection, 31,148-entry sample catalog + search, canonical app's project/track/job/asset orchestration (tested), DAW export packaging (tested), ownership/rights domain models (tested, no chain behind them), legacy Supabase CRUD API (tested, 21/21), chat-router status queries (tested, 6/6), algorithmic (non-AI) music sequencing, LLM song-structure generation, DDJ-SB3 MIDI hot-cue mapping.

## Partial Capabilities

Web MIDI routing (Note On only — no CC/pitch-bend/aftertouch/program-change/MPE), song composer UI (real components, disconnected backend), sample browser UI (real backend adapter, UI not independently verified), session recall, recording (browser MediaRecorder, not independently re-verified this session), NFT metadata (real ownership data model, not an NFT-standard schema), asset management (real domain model, local-only persistence).

## Mock/Stub Capabilities

NFT minting, NFT marketplace, blockchain/wallet integration (0% implemented — code searched for specifically, none found; "Solidity" appears only as marketing copy in a UI tech-stack chip list), Supabase Edge Function task handlers (all 8 are stubs), mixing/mastering, plugin SDK, audio classification, mix assistant/recommendation, bot-personality learning system and marketplace.

**Flag:** `RezonetteModule.tsx` currently **displays all of the above mock/stub items as "Complete"/"Built"** to end users, due to a render-logic bug that overrides its own correctly-labeled source data (`status: 'planned'` for most items) before display. This was verified by a full file read this session. It is the single highest-priority finding in this report — see P0 in `REZONATE_CONSOLIDATION_PLAN.md`.

## Deprecated Components

Legacy Vercel API (`api/rezonate/route.js` + shim), its Supabase schema, `agents/rezonate_node/config.json`. All still present and, in the legacy API's case, still consumed (by the chat router) — deprecated means "stop extending, plan migration," not "already inert."

## Duplicate Components

`apps/ursula-frontend/.../RezonateDAWModule.tsx` duplicates the DAW-UI job already attempted by `pages/song-composer.tsx`. The legacy Vercel API duplicates the canonical app's CRUD job. Everything else previously flagged as "duplicate" (the Python engine vs. the algorithmic `engine.ts`, for instance) turned out on functional inspection to be different capabilities sharing a name, not true duplicates — see `REZONATE_CONSOLIDATION_PLAN.md` Phase 6 for the full per-module reasoning.

## Current Test Status

```text
protoforge-applications/rezonate/  (node --test, re-run twice this session)
  Total:    96
  Passing:  95
  Failing:  1   (EPERM unlinking a temp file — confirmed to be this audit
                 sandbox's mounted-filesystem artifact, not application logic;
                 identical result both runs, so not randomly flaky)
  Skipped:  0
  Coverage: not measured (no coverage tool run this session)

tests/unit/rezonate.test.js  (legacy API, npx jest, mocked Supabase)
  21/21 passing

tests/unit/chat-route-rezonate.test.js  (chat router, npx jest)
  6/6 passing
```

No test failures were found to be flaky in the sense of inconsistent results — the one failure reproduced identically on both runs.

## Backend

**Supabase**, exclusively. No Firebase footprint anywhere in the repository — re-confirmed this session (same conclusion as the prior audit; nothing changed). Do not introduce Firebase; see `REZONATE_TARGET_ARCHITECTURE.md` Phase 8, item 12.

## Audio

Real and working (generation + stem separation + BPM/key detection), local-machine-only, no managed service wrapper, no cloud storage for output. Full detail in `REZONATE_CAPABILITY_MATRIX.json` → Audio.

## MIDI

One real, narrow capability: Web MIDI Note On routing with a hardcoded Pioneer DDJ-SB3 hot-cue map and a learning mode for remapping. No CC, pitch bend, aftertouch, program change, MPE, or file-based import/export exist anywhere in the tree.

## AI

Three genuinely separate, correctly-separated AI paths (cloud audio generation, cloud/internal LLM song structure, offline algorithmic sequencing) plus one adapter (`local-model-runtime.js`) whose implementation was not read line-by-line this session and is honestly marked `UNKNOWN` rather than guessed at.

## Rezonette

Currently a UI concept, not a working product: `RezonetteModule.tsx` is a dashboard whose own data says most features are unbuilt, but whose rendering code hides that and shows 100% completion. The real backend it claims to connect to in "LIVE mode" is an external GitHub repo this audit could not reach. **Rezonette should not be treated as a second product to build in parallel with Resonate** — at most it's the ownership/marketplace branding layer for the same system, pending the external-repo question being resolved.

## NFT

0% implemented beyond a tested-but-chain-free ownership/rights data model. No wallet, no chain SDK, no minting code, anywhere.

## Security

No exposed secrets found (re-confirmed: multiple `.env*` files exist at repo root, all covered by `.gitignore` patterns; git-tracked status genuinely could not be checked this session — `git status`/`git ls-files` timed out twice against this large repo's mounted filesystem; recommend the user verify locally). The deprecated legacy API remains reachable and auth-gated, not a critical risk but not zero either. The `RezonetteModule.tsx` status bug is a product-trust issue more than a security one, but is flagged at the same priority given it concerns ownership/NFT claims.

## Documentation Drift

Five specific, cited discrepancies found — full detail in `REZONATE_DOCUMENTATION_DRIFT.md`. Two corrected in this session's remediation pass (stale test count, stale `stem_separation` flag); three left as open items requiring a product/architecture decision rather than a fact correction (naming-guide collision claim, "Production" deployment claim, and the `RezonetteModule.tsx` code bug).

## External Repository Status

```text
EXTERNAL REPOSITORY NOT VERIFIED
```

Two independent access attempts failed (GitHub MCP connector — no token configured; generic web fetch to github.com and api.github.com — no usable content returned). No findings about this repository are asserted anywhere in this report.

## Overall Readiness

**Not production-ready as a consolidated product.** The audio core is genuinely solid and should be trusted as-is. The orchestration layer around it is well-tested but not fully wired to persistence, auth, storage, or a single frontend. The ownership/NFT/marketplace layer is close to entirely aspirational, and the one UI that represents it to users is currently misleading about that fact. This is a good foundation with clear, addressable gaps — not a broken system, and not a system that needs a rewrite.

---

## RECOMMENDED NEXT BUILD PHASE

```text
P0 (do first, in this order):
  1. Fix RezonetteModule.tsx's status-override render bug
  2. Get access to github.com/waveformer1984/rezonette
  3. Confirm or refute the canonical app's "Production" deployment claim
  4. Decide: implement or archive supabase/functions/rezonate-engine/index.ts

P1 (production-usable Rezonate):
  5. Wire canonical app persistence to the real rezonate_* Supabase schema
  6. Add auth to the canonical app's API (reuse lib/auth/requireAuth)
  7. Migrate the chat router off the legacy schema once #5 lands
  8. Move generated audio to Supabase Storage
  9. Consolidate to one frontend (song-composer vs. Ursula DAW modules)

P2 (capability expansion):
  10. MIDI: CC, pitch bend, aftertouch, general hardware-profile registry
  11. Real chain/wallet integration behind the existing ownership/rights models
  12. Audio classification / mix assistance / semantic sample search
  13. Real Edge Function task handlers (if #4 keeps the module)

P3 (experimental/future):
  14. MIDI file import/export
  15. Ableton/VST/AU integration
  16. Real-time collaboration
  17. Cloud stem-separation service
  18. Bot-personality marketplace
```

Do not begin P1+ work until P0.1 and P0.2 are resolved — both are trust/evidence gaps, not engineering tasks, and both could change what "canonical" even means here.
