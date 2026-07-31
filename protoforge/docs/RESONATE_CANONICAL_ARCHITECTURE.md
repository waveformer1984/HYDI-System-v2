# Resonate Canonical ProtoForge Architecture

## Principle

Resonate is the first real-world ProtoForge application built by wrapping an existing, working audio pipeline inside the ProtoForge application boundary. We do not rewrite the audio engine. We organize it.

```text
AI Music Generation
        |
        v
Resonate Intelligence Engine
        |
        +----------------+
        |                |
   Stem Processing   Audio Analysis
        |                |
        v                v
Sample Library      Metadata Pipeline
        |
        v
DAW Asset Export
        |
        v
Ownership Layer
        |
        v
HYDI Event Integration (future)
```

## Existing components

### Audio Intelligence Engine

- **Path**: `HYDI-System-v2/rezonate/`
- **Technology**: Python, Google `lyria-3` via `google-genai`, Demucs `htdemucs`, librosa
- **Capabilities**:
  - `generate.py` — AI song generation from text prompt
  - `make-stems.py` — stem separation (vocals, drums, bass, other)
  - BPM and key detection
  - local sample scanning (`scan-samples.js`)
- **Status**: Working, local, un-orchestrated.
- **Boundary**: The engine is owned by `rezonate/`. The ProtoForge adapter calls it, not copies it.

### Data Layer

- **Path**: `HYDI-System-v2/supabase/migrations/20260522000001_rezonate_schema.sql`
- **Tables**:
  - `rezonate_projects`
  - `rezonate_tracks`
  - `rezonate_patterns`
  - `rezonate_audio_files`
  - `rezonate_processing_settings`
- **Status**: Existing schema baseline. The ProtoForge repository mirrors this shape in the local persistence layer and stays compatible for future Supabase wiring.

### Existing Frontends

Legacy and experimental interfaces that remain untouched during this task:

- `pages/song-composer.tsx` and `components/song-composer/*`
- `apps/ursula-frontend/src/app/resonate/page.tsx`
- `apps/ursula-frontend/src/components/modules/RezonateDAWModule.tsx`
- `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx`

These are not merged. They are the user-experience layer that can later consume the ProtoForge backend.

## ProtoForge application wrapper

The new application lives in:

```text
protoforge-applications/rezonate/
```

It uses patterns from `protoforge/blueprints/application/`.

### Ownership boundaries

| System | Owner | ProtoForge Role |
|--------|-------|-----------------|
| `rezonate/` Python pipeline | Existing local engine | Adapter target |
| `supabase/migrations/..._rezonate_schema.sql` | Existing data layer | Schema compatibility target |
| `protoforge-applications/rezonate/` | ProtoForge | Orchestration, repository, events, validation, diagnostics |
| Frontends | Ursula / song-composer | Future consumers |

## Domain events

Resonate domain events emitted through the ProtoForge EventBus:

- `song.generated`
- `stem.processing.started`
- `stem.processing.completed`
- `audio.asset.created`
- `sample.library.updated`
- `track.exported`
- `ownership.created`

## Audio engine adapter

`src/adapters/resonate-engine.js` provides the boundary:

```javascript
{
  generateSong(),
  createStems(),
  analyzeAudio(),
  getProcessingStatus()
}
```

The adapter does not contain DSP logic. It coordinates the existing Python scripts and translates their output into ProtoForge domain events.

## Target architecture

```text
Existing Resonate Engine
          |
          v
   Resonate Adapter
          |
          v
ProtoForge Resonate Application
          |
          +------------+
          |            |
       Events       Ownership
          |
          v
      HYDI (future)
```

## Processing job lifecycle

```text
queued
  ↓
generating
  ↓
stems_processing
  ↓
analyzing
  ↓
completed

or any → failed
```

Implemented in `protoforge-applications/rezonate/src/domain/processing-job.js`. Every transition emits a domain event.

## Audio asset model

`AudioAsset` in `protoforge-applications/rezonate/src/domain/audio-asset.js` represents production assets:

- `id`, `project_id`
- `type` — `stem`, `sample`, `vocal`, `instrument`, `mix`
- `file_path`
- `bpm`, `key`
- `metadata`
- `ownership_status` — `draft`, `registered`, `minted`, `listed`

## Sample library adapter

`SampleLibraryAdapter` in `protoforge-applications/rezonate/src/adapters/sample-library.js` reads `rezonate/samples-catalog.json` and provides:

- `searchSamples()`
- `getSample()`
- `filterByInstrument()`
- `filterByBPM()`
- `filterByKey()`

## DAW export foundation

`src/export/packaging.js` packages project assets with a manifest and WAV stem bundle. No DAW-specific plugins yet.

## New domain events

- `processing.job.created`
- `processing.started`
- `stems.processing.started`
- `analysis.started`
- `stems.completed`
- `analysis.completed`
- `processing.completed`
- `processing.failed`
- `audio.asset.updated`
- `ownership.status_changed`
