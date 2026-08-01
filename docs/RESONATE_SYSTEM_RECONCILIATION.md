# Resonate System Reconciliation Audit

## Objective

Prevent a fifth Resonate implementation by inventorying the four existing Resonate/Rezonate organisms, identifying their boundaries, and proposing canonical ownership before Phase 4 HYDI integration.

## Audit targets

```text
1. rezonate/                       — Python audio engine
2. protoforge-applications/rezonate/ — ProtoForge canonical application
3. apps/ursula-frontend/           — Ursula Resonate UI and DAW modules
4. protoforge/examples/resonate/   — Blueprint example
```

Additional referenced systems:

```text
pages/song-composer.tsx            — HYDI song composer UI
api/rezonate/route.js              — Vercel DAW node API
api/song-composer/generate.js      — LLM song structure generator
supabase/functions/rezonate-engine/index.ts — Deno Edge Function stubs
agents/rezonate_node/config.json   — Node capability manifest
RESONATE_MUSIC_SYSTEM_README.md    — Aspirational design doc
```

---

## 1. Python Audio Engine

**Path:** `rezonate/`

### Files

| File | Role | Production? |
|------|------|-------------|
| `generate.py` | Generates MP3 via Google Lyria 3 (`lyria-3-pro-preview` / `lyria-3-clip-preview`) | Yes — requires `GEMINI_API_KEY` + `google-genai` |
| `make-stems.py` | Splits MP3 into `vocals`, `drums`, `bass`, `other` WAV stems using Demucs `htdemucs` + `librosa` BPM/key detection | Yes — local CPU |
| `scan-samples.js` | Walks drives, builds `samples-catalog.json` | Yes — one-shot discovery |
| `samples-catalog.json` | 31,148 audio sample records with path, folder, tags, guessed BPM/key | Yes — read-only catalog |
| `stems/`, `stems_raw/`, `_work/`, `generated/` | Local output folders | Yes — generated assets |
| `heidi-rezonate.js` | Unknown integration entry point (not inspected) | Unknown |

### Capabilities

- **AI generation**: Google Lyria 3 audio generation from text prompt, optional `--clip` (30s preview), optional `--stems` auto-split.
- **Stem separation**: Demucs `htdemucs` CPU inference, outputs WAVs + `track.json`.
- **BPM/key analysis**: `librosa` + Krumhansl-Schmuckler key profile (best-effort, limited to 2 minutes).
- **Sample discovery**: filename-based BPM/key/tag heuristics.
- **Outputs**: MP3, WAV stems, JSON metadata, local folders.
- **External dependencies**: `google-genai`, `demucs`, `torch`, `librosa`, `soundfile`, `numpy`, `scipy`.

### Production readiness

- Works locally and offline after setup.
- No API, queue, or service wrapper around the scripts.
- No storage backend beyond local files.
- No auth, multi-tenancy, or billing integration.
- **Source of truth for audio DSP. Must not be duplicated or rewritten.**

### Ownership role

The Python engine is the **audio capability**. It should be called, not wrapped, by the ProtoForge application.

---

## 2. ProtoForge Resonate Application

**Path:** `protoforge-applications/rezonate/`

### Current structure

```text
src/
  adapters/
    resonate-engine.js      # wrapper around rezonate/ Python scripts
    sample-library.js       # read-only adapter for samples-catalog.json
    ownership-registry.js   # future blockchain/registry boundary
  domain/
    processing-job.js       # state machine
    audio-asset.js          # asset intelligence
    ownership-record.js     # ownership model
    rights.js               # rights/collaborator registry
  export/
    packaging.js            # WAV stem bundle + manifest
  repository.js             # in-memory persistence (project/track/asset/job/ownership/rights)
  api/router.js             # Express HTTP routes
  events/event-bus.js       # EventBus + MemoryTransport + FileTransport + ExternalAdapter
  validation.js             # input validation
  diagnostics.js            # health + engine availability
  persistence/              # memory store compatible with schema
  tests/                    # 58 unit tests, all passing
```

### Capabilities

- Project / track / asset orchestration
- Processing job lifecycle (`queued → generating → stems_processing → analyzing → completed`)
- Audio asset registration with BPM/key/ownership status
- Sample library search/filter (read-only)
- DAW export packaging (manifest + WAV bundle)
- Ownership records, rights, collaborator splits, royalty events
- Domain events for HYDI integration
- Diagnostics and health endpoint

### What it owns

- Application orchestration
- Domain models
- Event emission
- Persistence abstraction
- Audio engine adapter (calling convention)
- Sample catalog read adapter
- Export packaging

### What it delegates

- **DSP/AI generation** to `rezonate/generate.py`
- **Stem separation** to `rezonate/make-stems.py`
- **Sample discovery** to `rezonate/scan-samples.js` (pre-run)
- **Catalog storage** to `rezonate/samples-catalog.json`
- **NFT/blockchain** to future `ownership-registry` boundary

### Test status

```text
58/58 passing in protoforge-applications/rezonate/
```

### Production readiness

- Local-memory only. Not wired to Supabase.
- No file upload/storage service.
- No real audio file I/O integration with the Python engine yet (runner is pluggable).
- Strongest candidate for the canonical Resonate application.

---

## 3. Ursula Frontend Resonate

**Path:** `apps/ursula-frontend/`

### Components

| Component | Path | Role | Calls Python? | Calls ProtoForge? | Notes |
|-----------|------|------|---------------|-------------------|-------|
| ResonateStudio page | `src/app/resonate/page.tsx` | Algorithmic sequence UI | No | No | Calls `/api/execute` which uses local `ResonateModule` |
| ResonateModule | `src/lib/resonate/engine.ts` | Pure TypeScript algorithmic music generator | No | No | Generates `bassline` + `melody` arrays, no audio files |
| RezonateDAWModule | `src/components/modules/RezonateDAWModule.tsx` | Full DAW UI (mock) | No | No | Web Audio + MediaRecorder, no external calls |
| RezonetteModule | `src/components/modules/RezonetteModule.tsx` | DAW/NFT dashboard (mock) | No | No | Links to `github.com/waveformer1984/rezonette` |

### API routes

| Route | Path | Role | Source of truth |
|-------|------|------|-----------------|
| `POST /api/execute` | `src/app/api/execute/route.ts` | Ursula execution endpoint | `ResonateModule` (TypeScript) |
| `GET /api/executions/:id` | `src/app/api/hydi/tasks/[id]/execute/route.ts` | Task execution | `ResonateModule` |
| `/api/user/status` | unknown | Credits | Local Ursula state |
| `/api/billing/create-intent` | unknown | Billing | Ursula billing |

### Bridge

`src/lib/ursula-bridge.ts` declares `UrsulaExecuteRequest` with `type: 'resonate'` as the "Single winner module." It posts to `URSULA_BASE_URL/api/execute` with a `cost` of 2 credits. The ledger entry is local to Ursula.

### Song composer (HYDI main app)

`pages/song-composer.tsx` + `components/song-composer/*`:

- Calls `POST /api/song-composer/generate`.
- `api/song-composer/generate.js` calls `api/chat/route` with a structured prompt and returns song JSON (title, bpm, key, sections, chords, lyrics).
- Falls back to a hardcoded song if the LLM call fails.
- Persists result to Supabase `actions` table.
- No audio output. No call to `rezonate/generate.py`.

### Does it call the Python engine?

**No.** Ursula Resonate and the song composer are entirely self-contained in TypeScript. They generate data structures, not audio files, and never invoke `rezonate/generate.py` or `make-stems.py`.

### Does it generate independently?

**Yes.** Two separate generators:

1. `ResonateModule` — deterministic/random algorithmic sequences.
2. `api/song-composer/generate.js` — LLM-generated song structure JSON.

Neither produces MP3, stems, or WAV.

### Does it duplicate functionality?

It **overlaps conceptually** with the Python engine (music generation) but does not duplicate its output. It is a **completely different kind of music system**:

| Capability | Python engine | Ursula Resonate |
|------------|---------------|-----------------|
| Audio file output | MP3, WAV | None |
| AI model | Lyria 3 | None |
| Algorithmic | No | Yes |
| LLM song structure | No | Yes (song-composer) |
| Stem separation | Yes | No |
| BPM/key detection | Yes | No |
| DAW-like UI | No | Mock UI |

### Can it become the UI layer for ProtoForge Resonate?

**Partially, with migration.** The existing Ursula modules are mock or algorithmic. They would need:

1. Replace `ResonateModule` calls with calls to `protoforge-applications/rezonate` API.
2. Add file upload/download for `generate.py`/`make-stems.py` outputs.
3. Wire ownership UI to `protoforge-applications/rezonate` ownership API.
4. Convert `pages/song-composer.tsx` to consume ProtoForge Resonate processing jobs.

**Verdict:** It is the right *visual surface* but not the right *implementation* today.

---

## 4. Blueprint Example

**Path:** `protoforge/examples/resonate/`

### Status

```text
README: "Resonate is currently a healthy empty organism generated from protoforge/blueprints/application/"
package.json name: "resonate"
```

### Contents

- Standard ProtoForge blueprint app skeleton.
- `src/api/`, `src/repository.js`, `src/events/`, `src/persistence/`
- `tests/resonate.test.js` (3 tests)
- No Resonate domain logic.
- No references in production code.
- Referenced only in `docs/RESONATE_EXISTING_SYSTEM_AUDIT.md` and `protoforge/docs/BLUEPRINT_EXTRACTION.md`.

### Recommendation

Rename to `protoforge/examples/sample-app/` to remove the collision. The name `resonate` should be reserved for `protoforge-applications/rezonate/`.

---

## 5. Current Architecture Map

```text
Ursula Frontend (apps/ursula-frontend/)
  ├─ ResonateStudio page ────────► /api/execute ────────► ResonateModule (TypeScript)
  ├─ RezonateDAWModule (mock UI)
  ├─ RezonetteModule (mock NFT dashboard)
  └─ UrsulaBridge ───────────────► Ursula billing (credits, ledger)

HYDI Main App (pages/song-composer.tsx)
  └─ /api/song-composer/generate ──► /api/chat ──► LLM song JSON
                                    └─ Supabase actions table

Legacy Vercel DAW API (api/rezonate/route.js)
  └─ Supabase rezonate_* tables (projects, tracks, audio_files)

Supabase Edge Function (supabase/functions/rezonate-engine/index.ts)
  └─ Stub handlers for stem/mix/export/nft/rights/beat tasks

Rezonate Agent (agents/rezonate_node/config.json)
  └─ Capability manifest (audio_processing, nft_minting, etc.)

ProtoForge Resonate (protoforge-applications/rezonate/)
  ├─ ResonateEngineAdapter ────────► rezonate/generate.py
  ├─ ResonateEngineAdapter ────────► rezonate/make-stems.py
  ├─ SampleLibraryAdapter ─────────► rezonate/samples-catalog.json
  └─ HTTP API + domain models + events

Rezonate Python Engine (rezonate/)
  ├─ generate.py  ─────────────────► MP3 (Lyria 3)
  ├─ make-stems.py ────────────────► WAV stems + track.json
  ├─ scan-samples.js ──────────────► samples-catalog.json
  └─ stems/, generated/, _work/    ▼
                                      Audio Assets

UNKNOWN / UNWIRED:
  [?] Does api/rezonate/route.js call rezonate/ scripts?            — No
  [?] Does supabase/functions/rezonate-engine call rezonate/ scripts? — No (stubs)
  [?] Does heidi-rezonate.js call rezonate/ scripts?                — Unknown, not inspected
  [?] Does Ursula frontend connect to ProtoForge Resonate API?       — No
  [?] Does song-composer use ProtoForge Resonate API?                — No
```

---

## 6. Capability Matrix

| Capability | Location | Status | Notes |
|------------|----------|--------|-------|
| AI generation (audio) | `rezonate/generate.py` | Working | Lyria 3, local, requires API key |
| AI song structure (JSON) | `api/song-composer/generate.js` | Working | LLM, no audio |
| Stem separation | `rezonate/make-stems.py` | Working | Demucs CPU |
| BPM/key analysis | `rezonate/make-stems.py` | Working | librosa |
| Sample catalog | `rezonate/samples-catalog.json` | Generated | 31,148 samples, read-only |
| Sample search | `protoforge-applications/rezonate/src/adapters/sample-library.js` | Implemented | In-memory adapter |
| DAW export | `protoforge-applications/rezonate/src/export/packaging.js` | Implemented | Manifest + WAV bundle |
| Algorithmic sequence | `apps/ursula-frontend/src/lib/resonate/engine.ts` | Working | TypeScript, no audio |
| DAW UI | `apps/ursula-frontend/src/components/modules/RezonateDAWModule.tsx` | Mock | No audio engine connection |
| NFT dashboard UI | `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` | Mock | External repo link |
| Ownership records | `protoforge-applications/rezonate/src/domain/ownership-record.js` | Implemented | Domain model |
| Rights/collaborators | `protoforge-applications/rezonate/src/domain/rights.js` | Implemented | Split validation |
| NFT minting | `supabase/functions/rezonate-engine/index.ts` | Stub only | No on-chain logic |
| Marketplace | `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` | Mock | Not functional |
| Production persistence | `supabase/migrations/20260522000001_rezonate_schema.sql` | Schema only | Not wired to ProtoForge app |

---

## 7. Canonical Ownership Boundaries

| System | Owner | Role | Future |
|--------|-------|------|--------|
| `rezonate/` | Audio engine | Source of audio truth | Keep unchanged; callable only |
| `protoforge-applications/rezonate/` | ProtoForge app | Canonical orchestration | Production backbone |
| `apps/ursula-frontend/src/lib/resonate/engine.ts` | Ursula | Algorithmic demo | Deprecate or migrate to ProtoForge adapter |
| `apps/ursula-frontend/src/components/modules/RezonateDAWModule.tsx` | Ursula | DAW UI concept | Rebuild against ProtoForge API |
| `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` | Ursula | NFT dashboard concept | Rebuild against ProtoForge ownership API |
| `apps/ursula-frontend/src/app/resonate/page.tsx` | Ursula | Resonate studio entry | Consume ProtoForge Resonate endpoints |
| `pages/song-composer.tsx` + `components/song-composer/*` | HYDI main app | LLM song composer | Consume ProtoForge Resonate processing jobs |
| `api/song-composer/generate.js` | HYDI main app | LLM structure generator | Optional: keep as alternative input to ProtoForge |
| `api/rezonate/route.js` | HYDI main app | Legacy Supabase DAW API | Replace with ProtoForge API or deprecate |
| `supabase/functions/rezonate-engine/index.ts` | HYDI Edge | Async task stubs | Move logic to ProtoForge adapter + real engine calls |
| `agents/rezonate_node/config.json` | Agent config | Capability manifest | Update to reflect real capabilities |
| `protoforge/examples/resonate/` | ProtoForge | Blueprint example | Rename to `sample-app` |

---

## 8. Recommendations

### Recommended option: Option A — Ursula frontend becomes the UI layer

**Rationale:**

1. The ProtoForge application has the only end-to-end model that does not duplicate the Python engine.
2. Ursula has the best-developed UI surfaces (`ResonateStudio`, `RezonateDAWModule`, `RezonetteModule`, `song-composer`).
3. HYDI already routes execution through Ursula (`ursula-bridge.ts`), making Ursula the natural UX boundary.
4. The Python engine remains untouched and delegated.

**Migration plan:**

1. Ursula `ResonateStudio` calls `protoforge-applications/rezonate` API instead of `/api/execute`.
2. `ResonateModule` (`src/lib/resonate/engine.ts`) becomes a client-side preview/fallback; real generation goes through ProtoForge.
3. `RezonateDAWModule` displays ProtoForge audio assets and triggers processing jobs.
4. `RezonetteModule` displays ProtoForge ownership records.
5. `song-composer` LLM output is submitted to ProtoForge Resonate as a `generate` processing job.
6. `api/rezonate/route.js` is deprecated in favor of ProtoForge endpoints.
7. `supabase/functions/rezonate-engine/index.ts` is replaced with real calls into the ProtoForge Resonate task queue.

### Naming cleanup

- Rename `protoforge/examples/resonate/` → `protoforge/examples/sample-app/`.
- Reserve `resonate` / `rezonate` namespace for:
  - `rezonate/` (Python engine)
  - `protoforge-applications/rezonate/` (canonical ProtoForge app)

### Next integration step

1. Run a wiring spike: have ProtoForge Resonate `POST /processing/jobs` with `task_type: 'generate'` call `rezonate/generate.py` and store the resulting MP3 as an `AudioAsset`.
2. Expose that asset through `GET /assets/:id`.
3. Update Ursula `ResonateStudio` to call the ProtoForge API and play the returned MP3.
4. Emit `audio.asset.created` from ProtoForge and route it through the HYDI Event Gateway to the RAW LEDGER.

---

## 9. Acceptance Checklist

- [x] All Resonate variants inventoried
- [x] Song-composer relationship understood (LLM JSON, no audio, no Python)
- [x] Duplicate functionality identified (Ursula algorithmic vs. Python audio are different; song-composer JSON vs. ProtoForge jobs are different)
- [x] Canonical ownership boundaries proposed
- [x] No code modified
- [x] Next integration step recommended

---

## 10. Key Unknowns

1. `rezonate/heidi-rezonate.js` — not inspected. May be a Node/HYDI integration attempt.
2. `rezonate/rezonate-library.html` and `rezonate-samples.html` — large HTML files; may be UI or reports.
3. Whether `api/rezonate/route.js` has active callers in production.
4. Whether `supabase/functions/rezonate-engine/index.ts` is deployed and invoked.
5. Whether `apps/ursula-frontend` is deployed and serving users today.

These unknowns should be resolved before any rename or deletion.
