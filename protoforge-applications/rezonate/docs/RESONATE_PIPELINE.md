# Resonate Production Pipeline

```text
User
 |
Ursula Studio
 |
ProtoForge Resonate
 |
Rezonate Engine
 |
Audio Asset
 |
Ownership Layer
 |
Future HYDI Ledger
```

## Phase 1 — AI Generation

- Entry point: `POST /processing/jobs` with `task_type: 'generate'`
- Start: `POST /processing/jobs/:id/start`
- Adapter: `src/adapters/resonate-engine.js` delegates to `rezonate/generate.py`
- Events: `processing.started` → `song.generated` → `audio.asset.created` → `processing.completed`
- Output: MP3 file in `rezonate/generated/`
- Playback: `GET /assets/:id/file`

## Phase 2 — Stem Processing

- Entry point: `POST /processing/jobs` with `task_type: 'stems'`
- Adapter: `src/adapters/resonate-engine.js` delegates to `rezonate/make-stems.py`
- Events: `stems.processing.started` → `stems.completed`
- Output: `vocals.wav`, `drums.wav`, `bass.wav`, `other.wav`, `track.json`

## Phase 3 — Audio Analysis

- `make-stems.py` also extracts BPM and key via `librosa`
- `AudioAsset` stores `bpm`, `key`, `metadata`
- Event: `analysis.completed`

## Phase 4 — Asset Library

- `AudioAsset` is the canonical production asset
- `SampleLibraryAdapter` surfaces `rezonate/samples-catalog.json` for discovery
- Event: `audio.asset.created` / `audio.asset.updated`

## Phase 5 — DAW Export

- `POST /projects/:id/export`
- `src/export/packaging.js` builds:
  - `manifest.json`
  - copied WAV stems
  - structured `export/<project>_<id>/` folder

## Phase 6 — Ownership (future)

```text
Finished Production Asset
          |
          v
Ownership Record
          |
          v
NFT / Marketplace Layer
          |
          v
HYDI RAW LEDGER
```

The asset must exist before ownership can be meaningful. The `AudioAsset.ownershipStatus` field (`draft` → `registered` → `minted` → `listed`) is the placeholder for this boundary.

## State machine

### Processing job

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

### Asset ownership

```text
draft → registered → minted → listed
```
