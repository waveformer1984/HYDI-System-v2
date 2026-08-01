# Resonate / Resonz / Reson8 Ecosystem Audit

## Scope

Audited for every naming variant and related music/audio concept in `HYDI-System-v2`.

Search terms covered:

```text
Resonate, resonate, RESONATE
Resonz, resonz, RESONZ
Reson8, reson8, RESON8
Reso, reso
Rezonate, rezonate, Rezonette
song composer, music generation, AI music
stem, stems, stem separation, audio separation, vocal isolation
sample library, sample management, DAW, MIDI, plugin, VST, AU
audio asset, NFT, marketplace, royalty, ownership, token
```

---

## Executive Summary

There is **no single canonical Resonate implementation**. The repository contains at least **three overlapping Resonate-branded systems** plus a new ProtoForge scaffold that happens to share the name. The risk of building another Resonate without consolidation is high.

| Finding | Count |
|---------|-------|
| Distinct Resonate/Rezonate/Rezonette code locations | 5+ |
| Active database schema | 1 |
| Active API routes | 2 |
| Edge Function | 1 |
| Frontend pages/modules | 3 |
| Python generation scripts | 2 |
| Sample catalog files | 1 (31k entries) |
| NFT/royalty UI (mock) | 1 |
| ProtoForge-named scaffold | 1 |

---

## 1. Existing Implementations

### 1.1 Rezonate — Python AI generation + stem separation

| Field | Value |
|-------|-------|
| Path | `rezonate/` |
| Project Name | Rezonate |
| Technology | Python 3, `google-genai`, `demucs`, `torch`, `librosa`, `soundfile` |
| Status | Local scripts, working but not integrated into HYDI pipeline |
| Capabilities | AI song generation (Lyria 3 / Gemini), stem separation (`htdemucs`), BPM/key detection |
| Dependencies | `google-genai`, `demucs`, `torch`, `librosa`, `soundfile`, `numpy`, `scipy` |
| Tests | None |
| Documentation | In-file docstrings |
| Owner/Source | `rezonate/generate.py`, `rezonate/make-stems.py` |

Files:

- `rezonate/generate.py` — generates songs with `lyria-3-clip-preview` / `lyria-3-pro-preview`, saves to `rezonate/generated/`
- `rezonate/make-stems.py` — splits audio into `vocals`, `drums`, `bass`, `other` using Demucs `htdemucs`
- `rezonate/scan-samples.js` — scans local drives for audio samples, writes `samples-catalog.json` (31,148 samples)
- `rezonate/samples-catalog.json` — sample inventory
- `rezonate/stems/<song>/` — separated WAV stems + `track.json` metadata
- `rezonate/_work/`, `rezonate/output/` — generated sample packs

### 1.2 Rezonate — Backend API + Supabase

| Field | Value |
|-------|-------|
| Path | `api/rezonate/route.js`, `pages/api/rezonate/route.js` |
| Project Name | Rezonate DAW Node |
| Technology | Node.js, Next.js, Supabase, `@supabase/supabase-js` |
| Status | Serverless API with auth gating and DB CRUD; partially implemented |
| Capabilities | `list_projects`, `create_project`, `get_project`, `list_tracks`, `add_track`, `update_track`, `delete_track`, `node_manifest`, `dispatch_task` |
| Dependencies | `@supabase/supabase-js`, `lib/auth/requireAuth` |
| Tests | `tests/unit/rezonate.test.js` (Jest, mocked) |
| Documentation | `agents/rezonate_node/config.json` |
| Owner/Source | `api/rezonate/route.js` |

### 1.3 Rezonate — Supabase Edge Function

| Field | Value |
|-------|-------|
| Path | `supabase/functions/rezonate-engine/index.ts` |
| Project Name | rezonate-engine |
| Technology | Deno, Supabase Edge Function |
| Status | Stub handlers only |
| Capabilities | Task types: `stem_analysis`, `mix_analysis`, `audio_export`, `nft_mint`, `rights_verify`, `session_recall`, `hardware_map`, `beat_generate` — all stubs |
| Dependencies | `supabase-js`, `requireServiceRole` from `_shared/security.ts` |
| Tests | None |
| Documentation | In-file comments |
| Owner/Source | `supabase/functions/rezonate-engine/index.ts` |

### 1.4 Rezonate / Resonate — Frontend Composer (pages)

| Field | Value |
|-------|-------|
| Path | `pages/song-composer.tsx`, `components/song-composer/*` |
| Project Name | Song Composer (Rezonate UI) |
| Technology | Next.js, React, TypeScript, Web Audio API |
| Status | UI scaffold; not wired to backend audio pipeline |
| Capabilities | Composition timeline, waveform spectrum, sample library, recording studio, live set, mixdown, MIDI controller, copilot panel |
| Dependencies | React, Next.js, Tailwind, Web Audio API |
| Tests | None |
| Documentation | Component in-file docs |
| Owner/Source | `pages/song-composer.tsx` |

Components:

- `components/song-composer/ArrangementTimeline.tsx`
- `components/song-composer/CopilotPanel.tsx`
- `components/song-composer/DescriptionInput.tsx`
- `components/song-composer/LiveSetPanel.tsx`
- `components/song-composer/MidiControllerInterface.ts`
- `components/song-composer/MidiStatusBar.tsx`
- `components/song-composer/MixdownEngine.ts`
- `components/song-composer/MixdownPanel.tsx`
- `components/song-composer/RecordingStudio.tsx`
- `components/song-composer/SampleLibrary.tsx`
- `components/song-composer/SongStructure.tsx`
- `components/song-composer/WaveformSpectrum.tsx`

### 1.5 Ursula Resonate Algorithmic Engine

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/lib/resonate/engine.ts`, `apps/ursula-frontend/src/app/resonate/page.tsx` |
| Project Name | Resonate Audio Engine |
| Technology | TypeScript, Next.js App Router |
| Status | Client-side algorithmic music generator (no AI, no audio files) |
| Capabilities | Generates quantized note sequences for bassline and melody; styles `electronic`, `ambient`, `techno`, `lofi` |
| Dependencies | None (pure TS) |
| Tests | None |
| Documentation | Type interfaces only |
| Owner/Source | `apps/ursula-frontend/src/lib/resonate/engine.ts` |

### 1.6 Ursula Rezonate DAW Module

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/components/modules/RezonateDAWModule.tsx` |
| Project Name | Rezonate DAW |
| Technology | React, TypeScript, Web Audio API, MediaRecorder |
| Status | UI-only DAW module in Ursula dashboard |
| Capabilities | Multi-track state, play/stop/record, track mixer, MIDI/audio tracks, waveform preview stub, AI/bot toggles (mock) |
| Dependencies | `lucide-react` |
| Tests | None |
| Documentation | In-file header |
| Owner/Source | `apps/ursula-frontend/src/components/modules/RezonateDAWModule.tsx` |

### 1.7 Rezonette — DAW + NFT Marketplace Dashboard

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` |
| Project Name | Rezonette |
| Technology | React, TypeScript |
| Status | Mock dashboard; external repo `github.com/waveformer1984/rezonette` |
| Capabilities | DAW component roadmap, AI, blockchain rights, NFT minting/marketplace (all mock status) |
| Dependencies | `lucide-react`, `@/lib/mode-context` |
| Tests | None |
| Documentation | In-file mock component list |
| Owner/Source | `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` |

### 1.8 Rezonate Agent Node

| Field | Value |
|-------|-------|
| Path | `agents/rezonate_node/` |
| Project Name | Rezonate DAW Node |
| Technology | Python agent node + JSON config |
| Status | Config-driven node manifest |
| Capabilities | `audio_processing`, `model_tracking`, `mixing_mastering`, `hardware_control`, `rights_monetization`, `nft_minting`, `gig_management`, `beat_academy`, `stem_separation=false`, `live_performance` |
| Dependencies | HYDI agent framework |
| Tests | None |
| Documentation | `agents/rezonate_node/config.json` |
| Owner/Source | `agents/rezonate_node/config.json`, `agents/rezonate_node/adapter.py` |

### 1.9 Sample Packs + Audio Assets

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/audio_samples/`, `apps/ursula-frontend/samples/`, `apps/ursula-frontend/output/sample_pack_001/`, `apps/ursula-frontend/ready_to_sell/` |
| Project Name | Sample Pack Pipeline |
| Technology | WAV assets, JSON manifest |
| Status | Static assets, no dynamic pipeline confirmed |
| Capabilities | Kick, snare, hat, melody, bass one-shots; sample pack `experienced` |
| Dependencies | None |
| Tests | None |
| Documentation | `apps/ursula-frontend/output/sample_pack_001/manifest.json` |
| Owner/Source | `apps/ursula-frontend/` audio folders |

### 1.10 Spec / Design Doc

| Field | Value |
|-------|-------|
| Path | `RESONATE_MUSIC_SYSTEM_README.md` |
| Project Name | Resonate Music Making System |
| Technology | Markdown spec |
| Status | Design document; aspirational architecture |
| Capabilities | Full DAW, collaboration, AI, analytics, mobile apps, NFT/rights, DAW integrations |
| Dependencies | None |
| Tests | None |
| Documentation | This file |
| Owner/Source | `RESONATE_MUSIC_SYSTEM_README.md` |

### 1.11 ProtoForge Application Scaffold (Not the music system)

| Field | Value |
|-------|-------|
| Path | `protoforge/examples/sample-app/` |
| Project Name | Resonate (ProtoForge example) |
| Technology | Node.js, Express (generic application blueprint) |
| Status | Empty organism generated from `protoforge/blueprints/application/` |
| Capabilities | Generic `Record` CRUD, event bus, persistence, API skeleton. No music logic. |
| Dependencies | `express`, `bcryptjs`, `cors` |
| Tests | `tests/resonate.test.js` (3/3 passing) |
| Documentation | `README.md`, `docs/ARCHITECTURE.md`, `docs/EVENTS.md`, `docs/GETTING_STARTED.md` |
| Owner/Source | ProtoForge blueprint |

---

## 2. Capability Mapping

### 2.1 AI Song Pipeline

| Capability | Exists | Where | Status |
|------------|--------|-------|--------|
| AI-generated song ingestion | ✅ | `rezonate/generate.py` (Lyria 3 / Gemini) | Working locally |
| Generated audio storage | ✅ | `rezonate/generated/` | Local files |
| Song metadata | ⚠️ | `track.json` after stem split | Manual |
| Generation prompts | ✅ | CLI argument to `generate.py` | Working |
| Model outputs | ✅ | MP3 from Lyria 3 | Working locally |

### 2.2 Stem Separation / Reverse Engineering

| Capability | Exists | Where | Status |
|------------|--------|-------|--------|
| Vocal isolation | ✅ | `rezonate/make-stems.py` (Demucs) | Working locally |
| Drums extraction | ✅ | `rezonate/make-stems.py` | Working locally |
| Bass extraction | ✅ | `rezonate/make-stems.py` | Working locally |
| Other instruments | ✅ | `rezonate/make-stems.py` | Working locally |
| Multi-stem export | ✅ | `rezonate/stems/<song>/` | Working locally |
| Model | `htdemucs` | `demucs` | Local CPU |
| API | None | N/A | Scripts only |
| Cloud | No | N/A | N/A |
| File formats | WAV | `*.wav` | Local |

### 2.3 Sample Library System

| Capability | Exists | Where | Status |
|------------|--------|-------|--------|
| Sample database | ✅ | `rezonate/samples-catalog.json` (31,148 entries) | Generated |
| Tagging | ✅ | Filename/path heuristic | Generated |
| Search | ⚠️ | JSON file only | No runtime search |
| Categorization | ⚠️ | Tags from path | Heuristic |
| Waveform previews | ❌ | N/A | N/A |
| Metadata | ⚠️ | BPM/key guessed from filename | Best effort |
| Licensing | ❌ | N/A | N/A |

### 2.4 DAW Integration

| Capability | Exists | Where | Status |
|------------|--------|-------|--------|
| Ableton workflows | ⚠️ | `make-stems.py` output is drag-and-drop WAV | Manual |
| MPC workflows | ❌ | N/A | N/A |
| MIDI export | ❌ | N/A | N/A |
| Stems export | ✅ | `rezonate/stems/<song>/` | Manual |
| WAV export | ✅ | `make-stems.py` | Working |
| Project packaging | ⚠️ | `apps/ursula-frontend/output/sample_pack_001/` | Static example |
| Plugin integration | ❌ | N/A | N/A |
| Sample dragging/export | ⚠️ | `ready_to_sell/` sample packs | Static example |

### 2.5 NFT / Ownership Layer

| Capability | Exists | Where | Status |
|------------|--------|-------|--------|
| Blockchain integration | ⚠️ | `RezonetteModule.tsx` mock | UI only |
| NFT minting | ⚠️ | `RezonetteModule.tsx`, `supabase/functions/rezonate-engine/index.ts` `nft_mint` | Stub |
| Ownership records | ⚠️ | `RezonetteModule.tsx` mock | UI only |
| Royalty tracking | ⚠️ | `RezonetteModule.tsx` mock | UI only |
| Marketplace components | ⚠️ | `RezonetteModule.tsx` | UI only |
| Licensing contracts | ❌ | N/A | N/A |

---

## 3. Database Schema

`supabase/migrations/20260522000001_rezonate_schema.sql` defines:

- `rezonate_projects`
- `rezonate_tracks`
- `rezonate_patterns`
- `rezonate_audio_files`
- `rezonate_processing_settings`

RLS enabled. Service-role and authenticated policies in place. This is the **only production-grade persistence layer** for any Resonate-branded system.

---

## 4. Missing Capabilities

- Real-time audio pipeline from generation → stems → sample library
- Audio storage backend beyond local files (Supabase Storage not fully wired)
- MIDI export / DAW-ready project files
- Cloud stem separation service (only local Python)
- Sample search and waveform preview
- NFT minting on-chain
- Royalty/ownership smart contracts
- Plugin (VST/AU) integration
- Real-time collaboration / WebSocket sessions
- Audio analysis as a service (BPM/key via API)
- Consolidated single project identity

---

## 5. Duplicate Risk

### 5.1 Naming Collisions

| Name | Meaning | Location |
|------|---------|----------|
| Resonate | Original ProtoForge example app | `protoforge/examples/sample-app/` |
| Resonate | Algorithmic music generator in Ursula | `apps/ursula-frontend/src/lib/resonate/` |
| RESONATE | Aspirational music system spec | `RESONATE_MUSIC_SYSTEM_README.md` |
| Rezonate | Python generation + stems | `rezonate/` |
| Rezonate | Backend DAW node API | `api/rezonate/`, `agents/rezonate_node/` |
| Rezonette | NFT/DAW dashboard | `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` |
| Resonz | Not found | N/A |
| Reson8 | Not found | N/A |
| Reso | Not found | N/A |

### 5.2 Path Drift

- `InventoryModule.tsx` lists `rezonate_core/` and `daw_build/` as paths, but these directories do not exist. Actual code is in `rezonate/` and `apps/ursula-frontend/...`.

### 5.3 Conclusion

There are at least **four distinct Resonate/Rezonate code identities**. Adding a new `protoforge/examples/sample-app` music app would create a fifth unless it replaces or consolidates one of the existing systems.

---

## 6. Recommended Consolidation

### Canonical system

The **Rezonate Python pipeline** (`rezonate/generate.py` + `make-stems.py`) is the only end-to-end working implementation. It should be the foundation.

### Recommended architecture

```text
AI Song Generation (Lyria 3 / Gemini)
        |
        v
Rezonate Intelligence Layer (metadata, prompt tracking)
        |
        v
Stem Separation Engine (Demucs / htdemucs)
        |
        v
Sample Reconstruction Library (catalog + tagging)
        |
        v
DAW Export Pipeline (WAV stems + MIDI + project package)
        |
        v
Finished Track Package
        |
        v
Ownership / Marketplace Layer (NFT + royalty)
        |
        v
ProtoForge Ecosystem (HYDI events, billing)
```

### Steps

1. **Rename or remove** the ProtoForge `protoforge/examples/sample-app/` if it is intended for music; if it is a generic application factory example, rename it to a neutral name to avoid collision.
2. **Promote** `rezonate/` as the canonical `rezonate-core`.
3. **Move** the Supabase-backed DAW API (`api/rezonate/`, `supabase/migrations/..._rezonate_schema.sql`) to a new repository or package: `rezonate-core` or `protoforge-applications/rezonate`.
4. **Merge** Ursula DAW modules (`RezonateDAWModule`, `RezonetteModule`) into a single frontend package.
5. **Replace stub Edge Function** (`supabase/functions/rezonate-engine/index.ts`) with real task handlers that call the Python pipeline.
6. **Do not create a new `protoforge/examples/sample-app` music app** until the above consolidation is complete.

---

## 7. Final Architecture Recommendation

The target is **not another music app**. The target is a pipeline that turns an AI-generated composition into an owned, tradable musical artifact.

```text
AI-generated composition
        ↓
separated musical components
        ↓
human-quality sample reconstruction
        ↓
DAW-ready production assets
        ↓
owned, tradable musical artifact
```

The **only existing implementation that covers the first three stages** is `rezonate/generate.py` + `rezonate/make-stems.py`. The **only existing production database** is the `rezonate_*` Supabase schema. The **only existing NFT/ownership UI** is `RezonetteModule.tsx` (currently mock).

A ProtoForge-native Resonate should be built by:

1. Wrapping the Python pipeline in a service.
2. Moving the Supabase schema and API into the `protoforge-applications/rezonate` package.
3. Replacing the mock `RezonetteModule` with real ownership/NFT integration.
4. Feeding all state changes into the HYDI RAW LEDGER via the EventBus pattern proven in Switchboard.

No new Resonate application should be scaffolded until this consolidation is decided.

---

## 8. Action Items

- [ ] Resolve naming: keep `Resonate`, `Rezonate`, or `Rezonette`?
- [ ] Remove or rename `protoforge/examples/sample-app/` to avoid collision.
- [ ] Decide whether the ProtoForge music app becomes the new canonical `rezonate` or a migration of `rezonate/`.
- [ ] Fix `InventoryModule.tsx` paths (`rezonate_core/`, `daw_build/`) to match actual directories.
- [ ] Implement real `supabase/functions/rezonate-engine/index.ts` handlers.
- [ ] Do not create `protoforge/examples/sample-app` music product until this audit is accepted.
